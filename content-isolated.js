let hasInitialized = false;
// content-isolated.js (有 Chrome API 權限)
async function getStorageData() {
  if (hasInitialized) return;
  hasInitialized = true;
  try {
    const result = await chrome.storage.local.get(['UserName', 'UserID', 'UserEmail', 'UserPhone', 'UserAddress']);
    
    // 通過 postMessage 發送到主環境
    window.postMessage({
      type: 'STORAGE_DATA',
      data: result
    }, '*');
  } catch (error) {
    console.error('Error getting storage:', error);
  }
}

// 監聽來自主環境的請求
window.addEventListener('message', function(event) {
  if (event.data.type === 'REQUEST_STORAGE_DATA') {
    getStorageData();
  }
});

// 頁面載入時自動獲取
getStorageData();
