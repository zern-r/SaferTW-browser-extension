
// IndexedDB + BroadcastChannel 整合類別
class CrossTabFileManager {
    constructor(options = {}) {
        this.channelName = options.channelName || 'file-sharing';
        this.dbName = options.dbName || 'CrossTabFileStorage';
        this.storeName = options.storeName || 'files';
        this.metaStoreName = this.storeName + '_meta';
        this.version = options.version || 1;
        this.maxRetries = options.maxRetries || 3;
        this.cleanupInterval = options.cleanupInterval || 10 * 60 * 1000; // 10分鐘
        
        this.db = null;
        this.channel = null;
        this.listeners = new Map();
        this.pendingOperations = new Map();
        this.isInitialized = false;
        
        this.onDataStored = null;
        this.onDataDeleted = null;
        this.onProgress = null;
    }

    async init() {
        try {
            this.db = await this.openDatabase();
            this.channel = new BroadcastChannel(this.channelName);
            this.setupChannelListener();
            this.startCleanupTimer();
            this.isInitialized = true;
            console.log('CrossTabFileManager 初始化完成');
            return true;
        } catch (error) {
            console.error('初始化失敗:', error);
            throw error;
        }
    }

    async openDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);
            
            request.onerror = () => reject(new Error(`資料庫開啟失敗: ${request.error}`));
            request.onsuccess = () => resolve(request.result);
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // 創建主要存儲
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                    store.createIndex('type', 'type', { unique: false });
                }
                
                // 創建元數據存儲
                if (!db.objectStoreNames.contains(this.metaStoreName)) {
                    const metaStore = db.createObjectStore(this.metaStoreName, { keyPath: 'id' });
                    metaStore.createIndex('expiry', 'expiry', { unique: false });
                    metaStore.createIndex('type', 'type', { unique: false });
                }
            };
        });
    }

    setupChannelListener() {
        this.channel.addEventListener('message', async (event) => {
            const { type, ...data } = event.data;
            
            try {
                switch (type) {
                    case 'data-stored':
                        if (this.onDataStored) {
                            this.onDataStored(data);
                        }
                        break;
                    case 'data-deleted':
                        if (this.onDataDeleted) {
                            this.onDataDeleted(data);
                        }
                        break;
                    case 'data-request':
                        await this.handleDataRequest(data);
                        break;
                    case 'data-response':
                        await this.handleDataResponse(data);
                        break;
                    case 'ping':
                        await this.handlePing(data);
                        break;
                }
            } catch (error) {
                console.error('處理訊息失敗:', error);
            }
        });
    }

    async storeFile(file, options = {}) {
        const id = options.id || this.generateId();
        const expiry = options.expiry || (Date.now() + 24 * 60 * 60 * 1000); // 預設24小時過期
        
        const metadata = {
            id,
            type: 'file',
            filename: file.name,
            fileType: file.type,
            size: file.size,
            lastModified: file.lastModified,
            timestamp: Date.now(),
            expiry,
            source: options.source || 'upload',
            ...options.metadata
        };

        try {
            // 存儲主資料
            await this.putData(this.storeName, {
                id,
                data: file,
                metadata
            });

            // 存儲元數據
            await this.putData(this.metaStoreName, metadata);

            // 通知其他分頁
            this.channel.postMessage({
                type: 'data-stored',
                id,
                metadata
            });

            console.log(`檔案已存儲: ${file.name}, ID: ${id}`);
            return id;
        } catch (error) {
            console.error('存儲檔案失敗:', error);
            throw error;
        }
    }

    async retrieveFile(id) {
        try {
            const result = await this.getData(this.storeName, id);
            if (result) {
                // 檢查是否過期
                if (result.metadata.expiry && result.metadata.expiry < Date.now()) {
                    await this.deleteFile(id);
                    return null;
                }
                return result.data;
            }
            return null;
        } catch (error) {
            console.error('檢索檔案失敗:', error);
            throw error;
        }
    }

    async deleteFile(id) {
        try {
            await this.deleteFromStore(this.storeName, id);
            await this.deleteFromStore(this.metaStoreName, id);
            
            this.channel.postMessage({
                type: 'data-deleted',
                id
            });
            
            console.log(`檔案已刪除: ${id}`);
        } catch (error) {
            console.error('刪除檔案失敗:', error);
            throw error;
        }
    }

    async listFiles(filter = {}) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.metaStoreName], 'readonly');
            const store = transaction.objectStore(this.metaStoreName);
            const request = store.getAll();
            
            request.onsuccess = () => {
                let results = request.result;
                
                // 過濾過期檔案
                const now = Date.now();
                results = results.filter(item => !item.expiry || item.expiry > now);
                
                // 應用其他過濾器
                if (filter.type) {
                    results = results.filter(item => item.fileType?.includes(filter.type));
                }
                if (filter.source) {
                    results = results.filter(item => item.source === filter.source);
                }
                
                // 按時間排序（最新的在前）
                results.sort((a, b) => b.timestamp - a.timestamp);
                
                resolve(results);
            };
            
            request.onerror = () => reject(request.error);
        });
    }

    async getStorageStats() {
        const files = await this.listFiles();
        const stats = {
            totalFiles: files.length,
            totalSize: files.reduce((sum, file) => sum + (file.size || 0), 0),
            byType: {},
            bySource: {},
            oldestFile: null,
            newestFile: null
        };

        files.forEach(file => {
            // 按類型統計
            const type = file.fileType || 'unknown';
            if (!stats.byType[type]) {
                stats.byType[type] = { count: 0, size: 0 };
            }
            stats.byType[type].count++;
            stats.byType[type].size += file.size || 0;

            // 按來源統計
            const source = file.source || 'unknown';
            if (!stats.bySource[source]) {
                stats.bySource[source] = { count: 0, size: 0 };
            }
            stats.bySource[source].count++;
            stats.bySource[source].size += file.size || 0;

            // 最舊和最新檔案
            if (!stats.oldestFile || file.timestamp < stats.oldestFile.timestamp) {
                stats.oldestFile = file;
            }
            if (!stats.newestFile || file.timestamp > stats.newestFile.timestamp) {
                stats.newestFile = file;
            }
        });

        return stats;
    }

    async cleanupExpiredFiles() {
        const now = Date.now();
        const transaction = this.db.transaction([this.metaStoreName], 'readonly');
        const store = transaction.objectStore(this.metaStoreName);
        const index = store.index('expiry');
        const request = index.openCursor(IDBKeyRange.upperBound(now));
        
        const expiredIds = [];
        
        return new Promise((resolve, reject) => {
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    expiredIds.push(cursor.value.id);
                    cursor.continue();
                } else {
                    Promise.all(expiredIds.map(id => this.deleteFile(id)))
                        .then(() => {
                            console.log(`清理了 ${expiredIds.length} 個過期檔案`);
                            resolve(expiredIds.length);
                        })
                        .catch(reject);
                }
            };
            
            request.onerror = () => reject(request.error);
        });
    }

    async checkSyncStatus() {
        const pingId = this.generateId();
        const responses = [];
        
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                resolve({
                    activeTabs: responses.length + 1, // +1 for current tab
                    responses
                });
            }, 1000);

            const listener = (event) => {
                if (event.data.type === 'pong' && event.data.pingId === pingId) {
                    responses.push({
                        channel: event.data.channel,
                        timestamp: event.data.timestamp
                    });
                }
            };

            this.channel.addEventListener('message', listener);
            
            this.channel.postMessage({
                type: 'ping',
                pingId,
                timestamp: Date.now()
            });

            setTimeout(() => {
                this.channel.removeEventListener('message', listener);
                clearTimeout(timeout);
                resolve({
                    activeTabs: responses.length + 1,
                    responses
                });
            }, 1000);
        });
    }

    async handlePing(data) {
        this.channel.postMessage({
            type: 'pong',
            pingId: data.pingId,
            channel: this.channelName,
            timestamp: Date.now()
        });
    }

    startCleanupTimer() {
        setInterval(async () => {
            try {
                if (document.getElementById('autoCleanup')?.checked) {
                    await this.cleanupExpiredFiles();
                }
            } catch (error) {
                console.error('自動清理失敗:', error);
            }
        }, this.cleanupInterval);
    }

    // 基礎資料庫操作
    async putData(storeName, data) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(data);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getData(storeName, id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(id);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async deleteFromStore(storeName, id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(id);
            
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async clearAllData() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName, this.metaStoreName], 'readwrite');
            
            const clearMain = transaction.objectStore(this.storeName).clear();
            const clearMeta = transaction.objectStore(this.metaStoreName).clear();
            
            let completed = 0;
            const checkComplete = () => {
                completed++;
                if (completed === 2) {
                    resolve();
                }
            };
            
            clearMain.onsuccess = checkComplete;
            clearMeta.onsuccess = checkComplete;
            
            clearMain.onerror = reject;
            clearMeta.onerror = reject;
        });
    }

    // 工具方法
    generateId() {
        return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

                getFileIcon(fileType) {
        if (!fileType) return '📄';
        
        if (fileType.startsWith('image/')) return '🖼️';
        if (fileType.startsWith('video/')) return '🎥';
        if (fileType.startsWith('audio/')) return '🎵';
        if (fileType.includes('pdf')) return '📕';
        if (fileType.includes('word') || fileType.includes('document')) return '📘';
        if (fileType.includes('excel') || fileType.includes('spreadsheet')) return '📗';
        if (fileType.includes('powerpoint') || fileType.includes('presentation')) return '📙';
        if (fileType.includes('zip') || fileType.includes('rar') || fileType.includes('7z')) return '📦';
        if (fileType.includes('text')) return '📝';
        
        return '📄';
    }

    close() {
        if (this.channel) {
            this.channel.close();
        }
        if (this.db) {
            this.db.close();
        }
    }
}

// 全域變數
let fileManager;
let currentTab = 'upload';

// 初始化應用程式
async function initApp() {
    try {
        showStatus('正在初始化...', 'info');
        
        fileManager = new CrossTabFileManager({
            channelName: 'file-sharing-demo',
            cleanupInterval: 5 * 60 * 1000 // 5分鐘清理一次
        });

        await fileManager.init();

        // 設置事件處理器
        fileManager.onDataStored = handleNewFile;
        fileManager.onDataDeleted = handleFileDeleted;

        // 設置拖拽功能
        setupDragAndDrop();

        // 設置檔案輸入
        setupFileInput();

        // 載入現有檔案
        await refreshFileList();

        // 更新統計資訊
        await updateStats();

        // 檢查同步狀態
        await updateSyncStatus();

        showStatus('初始化完成！', 'success');
        
        // 定期更新同步狀態
        setInterval(updateSyncStatus, 10000); // 每10秒更新一次
        
    } catch (error) {
        console.error('初始化失敗:', error);
        showStatus('初始化失敗: ' + error.message, 'error');
    }
}

// 設置拖拽功能
function setupDragAndDrop() {
    const uploadArea = document.getElementById('uploadArea');

    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });

    uploadArea.addEventListener('dragleave', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
    });

    uploadArea.addEventListener('drop', async (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
            await uploadFiles(files);
        }
    });

    uploadArea.addEventListener('click', () => {
        document.getElementById('fileInput').click();
    });
}

// 設置檔案輸入
function setupFileInput() {
    const fileInput = document.getElementById('fileInput');
    fileInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (files.length > 0) {
            await uploadFiles(files);
            fileInput.value = ''; // 清空輸入
        }
    });
}

// 上傳檔案
async function uploadFiles(files) {
    const progressContainer = document.getElementById('uploadProgress');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    
    progressContainer.style.display = 'block';
    
    try {
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const progress = ((i + 1) / files.length) * 100;
            
            progressFill.style.width = progress + '%';
            progressText.textContent = `上傳中: ${file.name} (${i + 1}/${files.length})`;
            
            const expiryHours = parseInt(document.getElementById('expiryHours').value) || 24;
            const expiry = Date.now() + (expiryHours * 60 * 60 * 1000);
            
            await fileManager.storeFile(file, {
                source: 'upload',
                expiry: expiry
            });
            
            // 小延遲以顯示進度
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        showStatus(`成功上傳 ${files.length} 個檔案`, 'success');
        await refreshFileList();
        await updateStats();
        
    } catch (error) {
        console.error('上傳失敗:', error);
        showStatus('上傳失敗: ' + error.message, 'error');
    } finally {
        progressContainer.style.display = 'none';
    }
}

// 從剪貼簿貼上
async function pasteFromClipboard() {
    try {
        const clipboardItems = await navigator.clipboard.read();
        let hasFiles = false;
        
        for (const item of clipboardItems) {
            for (const type of item.types) {
                if (type.startsWith('image/')) {
                    const blob = await item.getType(type);
                    const file = new File([blob], `clipboard-${Date.now()}.png`, { type: blob.type });
                    
                    const expiryHours = parseInt(document.getElementById('expiryHours').value) || 24;
                    const expiry = Date.now() + (expiryHours * 60 * 60 * 1000);
                    
                    await fileManager.storeFile(file, {
                        source: 'clipboard',
                        expiry: expiry
                    });
                    
                    hasFiles = true;
                }
            }
        }
        
        if (hasFiles) {
            showStatus('已從剪貼簿貼上圖片', 'success');
            await refreshFileList();
            await updateStats();
        } else {
            showStatus('剪貼簿中沒有圖片', 'info');
        }
        
    } catch (error) {
        console.error('剪貼簿貼上失敗:', error);
        showStatus('剪貼簿貼上失敗: ' + error.message, 'error');
    }
}

// 螢幕截圖（如果支援）
async function captureScreen() {
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            showStatus('瀏覽器不支援螢幕截圖功能', 'error');
            return;
        }
        
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: { mediaSource: 'screen' }
        });
        
        const video = document.createElement('video');
        video.srcObject = stream;
        video.play();
        
        video.addEventListener('loadedmetadata', () => {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0);
            
            canvas.toBlob(async (blob) => {
                const file = new File([blob], `screenshot-${Date.now()}.png`, { type: 'image/png' });
                
                const expiryHours = parseInt(document.getElementById('expiryHours').value) || 24;
                const expiry = Date.now() + (expiryHours * 60 * 60 * 1000);
                
                await fileManager.storeFile(file, {
                    source: 'screenshot',
                    expiry: expiry
                });
                
                showStatus('螢幕截圖已儲存', 'success');
                await refreshFileList();
                await updateStats();
                
                // 停止螢幕共享
                stream.getTracks().forEach(track => track.stop());
            }, 'image/png');
        });
        
    } catch (error) {
        console.error('螢幕截圖失敗:', error);
        showStatus('螢幕截圖失敗: ' + error.message, 'error');
    }
}

// 重新整理檔案列表
async function refreshFileList() {
    try {
        const files = await fileManager.listFiles();
        const fileList = document.getElementById('fileList');
        
        if (files.length === 0) {
            fileList.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #666;">
                    <div style="font-size: 3em; margin-bottom: 20px;">📂</div>
                    <p>尚未上傳任何檔案</p>
                </div>
            `;
            return;
        }
        
        fileList.innerHTML = '';
        
        for (const fileInfo of files) {
            const fileElement = await createFileElement(fileInfo);
            fileList.appendChild(fileElement);
        }
        
    } catch (error) {
        console.error('重新整理檔案列表失敗:', error);
        showStatus('重新整理檔案列表失敗: ' + error.message, 'error');
    }
}

// 創建檔案元素
async function createFileElement(fileInfo) {
    const fileDiv = document.createElement('div');
    fileDiv.className = 'file-item';
    fileDiv.setAttribute('data-file-id', fileInfo.id);
    
    const icon = fileManager.getFileIcon(fileInfo.fileType);
    const formattedSize = fileManager.formatBytes(fileInfo.size);
    const uploadTime = new Date(fileInfo.timestamp).toLocaleString();
    const expiryTime = fileInfo.expiry ? new Date(fileInfo.expiry).toLocaleString() : '永不過期';
    
    // 預覽區域
    let previewElement = `<div class="file-preview">${icon}</div>`;
    
    // 如果是圖片，嘗試載入預覽
    if (fileInfo.fileType && fileInfo.fileType.startsWith('image/')) {
        try {
            const file = await fileManager.retrieveFile(fileInfo.id);
            if (file) {
                const url = URL.createObjectURL(file);
                previewElement = `<img class="file-preview" src="${url}" alt="${fileInfo.filename}">`;
            }
        } catch (error) {
            console.error('載入圖片預覽失敗:', error);
        }
    }
    
    fileDiv.innerHTML = `
        ${previewElement}
        <div class="file-info">
            <div class="file-name">${fileInfo.filename}</div>
            <div class="file-details">
                <div>大小: ${formattedSize}</div>
                <div>類型: ${fileInfo.fileType || '未知'}</div>
                <div>來源: ${getSourceLabel(fileInfo.source)}</div>
                <div>上傳: ${uploadTime}</div>
                <div>過期: ${expiryTime}</div>
            </div>
        </div>
        <div class="file-actions">
            <button class="btn" onclick="downloadFile('${fileInfo.id}')">📥 下載</button>
            <button class="btn secondary" onclick="shareFile('${fileInfo.id}')">🔗 分享</button>
            <button class="btn danger" onclick="deleteFile('${fileInfo.id}')">🗑️ 刪除</button>
        </div>
    `;
    
    return fileDiv;
}

// 獲取來源標籤
function getSourceLabel(source) {
    const labels = {
        'upload': '📤 上傳',
        'clipboard': '📋 剪貼簿',
        'screenshot': '📷 截圖',
        'unknown': '❓ 未知'
    };
    return labels[source] || labels['unknown'];
}

// 下載檔案
async function downloadFile(fileId) {
    try {
        const file = await fileManager.retrieveFile(fileId);
        if (!file) {
            showStatus('檔案不存在或已過期', 'error');
            return;
        }
        
        const url = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showStatus(`已下載: ${file.name}`, 'success');
        
    } catch (error) {
        console.error('下載檔案失敗:', error);
        showStatus('下載檔案失敗: ' + error.message, 'error');
    }
}

// 分享檔案
async function shareFile(fileId) {
    try {
        const file = await fileManager.retrieveFile(fileId);
        if (!file) {
            showStatus('檔案不存在或已過期', 'error');
            return;
        }
        
        if (navigator.share) {
            await navigator.share({
                title: file.name,
                files: [file]
            });
            showStatus('檔案已分享', 'success');
        } else {
            // 複製檔案ID到剪貼簿作為替代方案
            await navigator.clipboard.writeText(fileId);
            showStatus('檔案ID已複製到剪貼簿', 'info');
        }
        
    } catch (error) {
        console.error('分享檔案失敗:', error);
        showStatus('分享檔案失敗: ' + error.message, 'error');
    }
}

// 刪除檔案
async function deleteFile(fileId) {
    if (!confirm('確定要刪除這個檔案嗎？')) {
        return;
    }
    
    try {
        await fileManager.deleteFile(fileId);
        showStatus('檔案已刪除', 'success');
        await refreshFileList();
        await updateStats();
        
    } catch (error) {
        console.error('刪除檔案失敗:', error);
        showStatus('刪除檔案失敗: ' + error.message, 'error');
    }
}

// 下載所有檔案
async function downloadAll() {
    try {
        const files = await fileManager.listFiles();
        if (files.length === 0) {
            showStatus('沒有檔案可下載', 'info');
            return;
        }
        
        for (const fileInfo of files) {
            await downloadFile(fileInfo.id);
            // 小延遲避免瀏覽器阻擋多重下載
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        showStatus(`已下載 ${files.length} 個檔案`, 'success');
        
    } catch (error) {
        console.error('批量下載失敗:', error);
        showStatus('批量下載失敗: ' + error.message, 'error');
    }
}

// 清空所有檔案
async function clearAllFiles() {
    if (!confirm('確定要清空所有檔案嗎？此操作無法復原！')) {
        return;
    }
    
    try {
        await fileManager.clearAllData();
        showStatus('所有檔案已清空', 'success');
        await refreshFileList();
        await updateStats();
        
    } catch (error) {
        console.error('清空檔案失敗:', error);
        showStatus('清空檔案失敗: ' + error.message, 'error');
    }
}

// 更新統計資訊
async function updateStats() {
    try {
        const stats = await fileManager.getStorageStats();
        
        document.getElementById('totalFiles').textContent = stats.totalFiles;
        document.getElementById('totalSize').textContent = fileManager.formatBytes(stats.totalSize);
        
        // 更新同步狀態
        const syncStatus = await fileManager.checkSyncStatus();
        document.getElementById('activeTabs').textContent = syncStatus.activeTabs;
        
    } catch (error) {
        console.error('更新統計資訊失敗:', error);
    }
}

// 更新同步狀態
async function updateSyncStatus() {
    try {
        const status = await fileManager.checkSyncStatus();
        const syncStatusDiv = document.getElementById('syncStatus');
        const tabCountSpan = document.getElementById('tabCount');
        
        tabCountSpan.textContent = status.activeTabs - 1; // 減去當前分頁
        syncStatusDiv.style.display = 'flex';
        
        document.getElementById('activeTabs').textContent = status.activeTabs;
        document.getElementById('syncStatus2').textContent = status.activeTabs > 1 ? '🔄' : '⚠️';
        
    } catch (error) {
        console.error('更新同步狀態失敗:', error);
    }
}

// 檢查同步狀態
async function checkSyncStatus() {
    try {
        const status = await fileManager.checkSyncStatus();
        showStatus(`發現 ${status.activeTabs} 個活躍分頁`, 'info');
        await updateSyncStatus();
        
    } catch (error) {
        console.error('檢查同步狀態失敗:', error);
        showStatus('檢查同步狀態失敗: ' + error.message, 'error');
    }
}

// 清理過期檔案
async function cleanupExpired() {
    try {
        const cleaned = await fileManager.cleanupExpiredFiles();
        showStatus(`清理了 ${cleaned} 個過期檔案`, 'success');
        await refreshFileList();
        await updateStats();
        
    } catch (error) {
        console.error('清理過期檔案失敗:', error);
        showStatus('清理過期檔案失敗: ' + error.message, 'error');
    }
}

// 重置資料庫
async function resetDatabase() {
    if (!confirm('確定要重置資料庫嗎？這將刪除所有資料！')) {
        return;
    }
    
    try {
        await fileManager.clearAllData();
        showStatus('資料庫已重置', 'success');
        await refreshFileList();
        await updateStats();
        
    } catch (error) {
        console.error('重置資料庫失敗:', error);
        showStatus('重置資料庫失敗: ' + error.message, 'error');
    }
}

// 切換分頁
function switchTab(tabName) {
    // 更新分頁按鈕
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });
    event.target.classList.add('active');
    
    // 更新內容
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(tabName + '-tab').classList.add('active');
    
    currentTab = tabName;
    
    // 如果切換到統計分頁，更新統計資訊
    if (tabName === 'stats') {
        updateStats();
    }
}

// 顯示狀態訊息
function showStatus(message, type = 'info') {
    const statusContainer = document.getElementById('statusMessages');
    const statusDiv = document.createElement('div');
    statusDiv.className = `status ${type}`;
    statusDiv.textContent = message;
    
    statusContainer.appendChild(statusDiv);
    
    // 3秒後自動移除
    setTimeout(() => {
        if (statusDiv.parentNode) {
            statusDiv.parentNode.removeChild(statusDiv);
        }
    }, 3000);
    
    console.log(`[${type.toUpperCase()}] ${message}`);
}

// 處理新檔案通知
function handleNewFile(data) {
    console.log('收到新檔案通知:', data);
    showStatus(`其他分頁上傳了: ${data.metadata.filename}`, 'info');
    refreshFileList();
    updateStats();
}

// 處理檔案刪除通知
function handleFileDeleted(data) {
    console.log('收到檔案刪除通知:', data);
    showStatus('其他分頁刪除了一個檔案', 'info');
    refreshFileList();
    updateStats();
}

// 頁面載入時初始化
//window.addEventListener('load', initApp);

// 頁面卸載時清理
window.addEventListener('beforeunload', () => {
    if (fileManager) {
        fileManager.close();
    }
});

// 鍵盤快捷鍵
document.addEventListener('keydown', (e) => {
    // Ctrl+V 貼上
    if (e.ctrlKey && e.key === 'v' && currentTab === 'upload') {
        e.preventDefault();
        pasteFromClipboard();
    }
    
    // Ctrl+U 上傳
    if (e.ctrlKey && e.key === 'u') {
        e.preventDefault();
        document.getElementById('fileInput').click();
    }
    
    // F5 重新整理檔案列表
    if (e.key === 'F5' && currentTab === 'files') {
        e.preventDefault();
        refreshFileList();
    }
});
