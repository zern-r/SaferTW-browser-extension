let UserData = [];
let enableSaferFileMenu = 0;
let pc, dc, remoteDC, file, sendOffset=0, recvBuffer=[], recvSize=0, fileMeta=null, saferTW_webRTC={}, importData={};
let statusIndicator, countyIndicator, vueInstance;
let storageData = null;

// 監聽來自隔離環境的數據
window.addEventListener('message', function(event) {
  if (event.data.type === 'STORAGE_DATA') {
    storageData = event.data.data;
    //console.log('Received storage data in main world:', storageData);
    // 現在可以同時使用 storage 數據和 Vue 實例
    if (storageData.UserName) {
        MainFunction();
        //console.log("loaded EXT")
    }
  }
});

// 請求 storage 數據
window.postMessage({
  type: 'REQUEST_STORAGE_DATA'
}, '*');

const fileMenu = '<!-- 遮罩層 --> <div class="safertw_overlay" id="safertw_overlay"></div> <!-- 右側指示器 --> <div class="safertw_sidebar-indicator" id="safertw_sidebarIndicator"> <div class="safertw_indicator-dot"></div> <div class="safertw_indicator-dot"></div> <div class="safertw_indicator-dot"></div> </div> <!-- 側邊欄 - 右側 --> <div class="safertw_sidebar" id="safertw_sidebar"> <div class="safertw_sidebar-header"> <h2 class="safertw_sidebar-title">安全台灣 傳輸檔案框架</h2> <button class="safertw_close-btn" id="safertw_closeSidebar">✕</button> </div><div class="safertw_file-receiver"> <h3 class="safertw_receiver-title">輸入接收代碼</h3> <div class="safertw_code-input-container"> <input type="text" class="safertw_code-input" id="safertw_codeInput" placeholder="0000000" maxlength="7" pattern="[0-9]{7}" > </div> <button class="safertw_receive-btn" id="safertw_receiveBtn" disabled>允許接收檔案</button><button class="safertw_receive-btn safertw_receive-btn-success" id="safertw_testDownload" disabled style="display: none;">下載檔案</button><button class="safertw_receive-btn safertw_receive-btn-primary" id="safertw_toggle_unzip_manual" style="">手動載入壓縮檔</button><hr><!-- 檔案上傳 --><div class="safertw_file-upload-container" style="display: none;"> <input type="file" id="safertw_zipFile" accept=".zip" /> <label for="safertw_zipFile" class="safertw_file-input-label"> <span class="safertw_file-icon">📁</span> 選擇 ZIP 檔案</label> <button id="safertw_unzipexpress" class="safertw_unzip-button"><span class="safertw_button-icon">📦</span>解壓縮+載入資訊</button></div> <div class="safertw_status-indicator safertw_status-waiting" id="safertw_statusIndicator"> 等待輸入代碼... </div> </div> </div>';
const iceServers = {iceServers:[{urls:'stun:stun.l.google.com:19302'}]};

let customCSS = ``;

function syncDelay(milliseconds) {
    var start = new Date().getTime();
    var end = 0;
    while ((end - start) < milliseconds) {
        end = new Date().getTime();
    }
}
function injectCSS(cssText) {
    //const style = document.createElement('style');
    //style.textContent = cssText;
    //document.head.appendChild(style);
}
function saferTW_webRTCanswer(code){
    pc = new RTCPeerConnection(iceServers);
    pc.ondatachannel = e => {
        remoteDC = e.channel;
        setupDC(remoteDC);
    };
    pc.onicecandidate = e => {
        if (!e.candidate){
            let answerDescription = JSON.stringify(pc.localDescription);
            const formdata = new FormData();
            formdata.append("answerCode", answerDescription);
            formdata.append("action", "answerPost");
            formdata.append("accessCode", code);

            const requestOptions = {
                method: "POST",
                body: formdata,
                redirect: "follow"
            };

            fetch("https://safer.tw/api/sync/answerPost", requestOptions)
            .then((response) => response.text())
            .then((result) => {
                let res = JSON.parse(result);
                if(res.status == "success"){
                    saferTW_webRTC.answerDesc = answerDescription;
                    saferTW_webRTC.step = 3;
                    saferTW_webRTC.expire = res.data.expire;
                    saferTW_webRTC.status = "已開啟通道，請在起始端確認";
                }else{
                    console.log(res);
                    updateStatusRoot("error", "配對錯誤，請稍後再試");
                }
            })
            .catch((error) => console.error(error));
        };
    };
    
    const formdata = new FormData();
    formdata.append("action", "answerGet");
    formdata.append("accessCode", code);

    const requestOptions = {
        method: "POST",
        body: formdata,
        redirect: "follow"
    };

    fetch("https://safer.tw/api/sync/answerGet", requestOptions)
    .then((response) => response.text())
    .then((result) => {
        let res = JSON.parse(result);
        if(res.status == "success"){
            let offer = JSON.parse(res.data.offerCode);
            pc.setRemoteDescription(offer).then(() => pc.createAnswer())
                .then(a => {
                    pc.setLocalDescription(a);
                    saferTW_webRTC.localDesc = result;
                    saferTW_webRTC.step = 2;
                    saferTW_webRTC.status = "已建立回應通道，接者處理中";
                });
        }else{
            console.log(res);
            updateStatusRoot("error", "配對錯誤，請稍後再試");
        }

        
    })
    .catch((error) => console.error(error));
}
function setupDC(channel) {
    //console.log(channel)
    channel.onopen = () => {
        saferTW_webRTC.step = 5;
        saferTW_webRTC.status = "資料通道已開啟，雙方可互傳檔案";
        console.log("[log]資料通道已開啟，雙方可互傳檔案"); 
    };
    channel.onmessage = handleMsg;
}
function handleMsg(e){
    //console.log(e);
    if(typeof e.data === 'string') {
        let msg = JSON.parse(e.data);
        if(msg.type === 'meta') {
            fileMeta = msg; recvBuffer = []; recvSize = 0;
            updateStatusRoot('waiting', '開始接收檔案...');
        }
    }else{
        recvBuffer.push(e.data);
        recvSize += e.data.byteLength;
        //console.log("recvSize", recvSize);
        if( recvSize == fileMeta.size){
            updateStatusRoot('success', '檔案接收成功');
            $$$("#safertw_testDownload").show();
            $$$("#safertw_testDownload").prop("disabled", false);

            //開始自動解壓縮
            let blob = new Blob(recvBuffer);
            loadFileToInput(blobToFile(blob, "safertw_tempfile.zip"), "safertw_zipFile");
            //$$$("#safertw_unzipexpress").click();
            $$$("#safertw_closeSidebar").click();
            //
        }else{
            updateStatusRoot('waiting', '正在接收檔案...');
        }
        //console.log("fileMeta", fileMeta);
    }
}
function updateStatusRoot(type, message) {
    statusIndicator = document.getElementById('safertw_statusIndicator');
    statusIndicator.className = `safertw_status-indicator safertw_status-${type}`;
    statusIndicator.textContent = message;
}
function selectByText(selectElement, text) {
    const options = selectElement.options;
    
    for (let i = 0; i < options.length; i++) {
        if (options[i].text === text) {
            selectElement.selectedIndex = i;
            selectElement.dispatchEvent(new Event('change', { bubbles: true }));
            return true; // 找到並選中
        }
    }
    return false; // 未找到
}
function simulateChineseInput(selector, text) {
    const $element = $$$(selector);
    
    // 設定焦點
    $element.focus();
    
    // 設定值
    $element.val(text);
    
    // 觸發相關事件
    $element.trigger('input');
    $element.trigger('change');
}
function simulateTyping(inputElement, text, delay = 10) {
    return new Promise((resolve) => {
        let index = 0;
        inputElement.value = '';
        inputElement.focus();
        
        function typeNextChar() {
            if (index < text.length) {
                inputElement.value += text[index];
                
                // 觸發 input 事件
                inputElement.dispatchEvent(new Event('input', { bubbles: true }));
                inputElement.dispatchEvent(new Event('change', { bubbles: true }));
                inputElement.dispatchEvent(new Event('blur', { bubbles: true }));
                
                index++;
                setTimeout(typeNextChar, delay);
            } else {
                resolve();
            }
        }
        
        typeNextChar();
    });
}
async function simulateVuetifyVSelect(inputText, options = {}) {
    const {
        selector = '.v-select',
        inputId = null,           // 新增：指定 input ID
        waitTime = 200,
        typingSpeed = 50,
        debug = false
    } = options;
    
    let vSelect = null;
    let targetInput = null;
    
    // 如果指定了 inputId，優先根據 ID 尋找
    if (inputId) {
        targetInput = document.getElementById(inputId);
        if (!targetInput) {
            throw new Error(`找不到 ID 為 "${inputId}" 的 input 元素`);
        }
        
        // 從 input 向上尋找對應的 v-select 容器
        vSelect = targetInput.closest('.v-select') || 
                 targetInput.closest('.v-input') ||
                 targetInput.closest('[class*="v-select"]');
        
        if (!vSelect) {
            throw new Error(`input#${inputId} 不在 v-select 組件內`);
        }
        
    } else {
        // 沒有指定 inputId，使用傳統的 selector 方式
        vSelect = document.querySelector(selector);
        if (!vSelect) {
            throw new Error(`找不到 v-select 元素: ${selector}`);
        }
    }
    
    // 步驟1: 激活 v-select
    const activateElement = vSelect.querySelector('.v-select__slot') ||
                           vSelect.querySelector('.v-input__slot') ||
                           vSelect.querySelector('.v-select__selections') ||
                           vSelect;
    
    // 點擊激活
    activateElement.click();
    activateElement.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        
    // 等待下拉選單開啟
    await new Promise(resolve => setTimeout(resolve, waitTime));
    
    // 步驟2: 尋找輸入框
    let inputElement = null;
    
    if (inputId && targetInput) {
        // 如果指定了 inputId，直接使用該 input
        inputElement = targetInput;
    } else {
        // 否則按優先順序尋找可用的輸入框
        const possibleInputs = [
            vSelect.querySelector('input:not([type="hidden"])'),
            document.querySelector('.v-menu__content input'),
            document.querySelector('.v-select-list input'),
            ...vSelect.querySelectorAll('input[type="text"]'),
            ...document.querySelectorAll('.v-menu--attached input')
        ].filter(input => input && input.offsetParent !== null); // 過濾隱藏元素
        
        inputElement = possibleInputs[0];
    }
    
    if (!inputElement) {
        throw new Error(inputId ? 
            `無法使用 input#${inputId} 進行輸入` : 
            '找不到可用的輸入框');
    }
    
    // 步驟3: 輸入文字
    inputElement.focus();
    
    // 清空現有內容
    inputElement.value = '';
    
    // 觸發 focus 事件
    inputElement.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    
    // 如果需要模擬打字效果
    if (typingSpeed > 0) {
        for (let i = 0; i <= inputText.length; i++) {
            inputElement.value = inputText.substring(0, i);
            inputElement.dispatchEvent(new Event('input', { bubbles: true }));
            await new Promise(resolve => setTimeout(resolve, typingSpeed));
        }
    } else {
        inputElement.value = inputText;
        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    }
    
    // 觸發其他相關事件
    inputElement.dispatchEvent(new Event('change', { bubbles: true }));
    inputElement.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    
    // 步驟4: 按下 Enter
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
    });
    
    inputElement.dispatchEvent(enterEvent);
    
    // 也觸發 keyup 事件確保完整性
    const enterUpEvent = new KeyboardEvent('keyup', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
    });
    
    inputElement.dispatchEvent(enterUpEvent);
    return true;
}
function onDOMReady(callback) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        // DOM 已就緒，立即執行
        setTimeout(callback, 1);
    } else {
        // 等待 DOM 就緒
        document.addEventListener('DOMContentLoaded', callback);
    }
}
function searchByTitle(selector, searchText) {
    const options = $$$(selector);
    const results = [];
    
    options.each(function() {
        const title = $$$(this).text().trim();
        if (title.includes(searchText)) {
            results.push({
                title: title,
                value: $$$(this).attr('data-value')
            });
        }
    });
    
    return results;
}
function getFileExtensionOri(filename){
    return filename.split('.').pop();
}
function blobToFile(blob, filename) {
    const Ext = getFileExtensionOri(filename);
    let file_type = "";
    switch(Ext){
        case "jpg" : {
            file_type = "image/jpg";
            break;
        }
        case "jpeg" : {
            file_type = "image/jpeg";
            break;
        }
        case "png" : {
            file_type = "image/png";
            break;
        }
        case "gif" : {
            file_type = "image/gif";
            break;
        }
        case "mp4" : {
            file_type = "video/mp4";
            break;
        }
        case "mpeg" : {
            file_type = "video/mpeg";
            break;
        }
        case "mov" : {
            file_type = "video/quicktime";
            break;
        }
        case "avi" : {
            file_type = "video/avi";
            break;
        }
        case "wmv" : {
            file_type = "video/x-ms-wmv";
            break;
        }
        case "zip" : {
            file_type = "application/x-zip-compressed";
            break;
        }
    }

    return new File([blob], filename, {
        type: file_type,
        lastModified: Date.now()
    });
}
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}
function loadFileToInput(file, inputElement) {
    const fileinput = document.getElementById(inputElement);
    // 創建DataTransfer物件來模擬檔案拖放
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    
    // 將檔案設定到input元素
    fileinput.files = dataTransfer.files;
    
    // 觸發change事件
    fileinput.dispatchEvent(new Event('change', { bubbles: true }));
}
function loadFileToInputQuery(file, inputElement) {
    const fileinput = document.querySelectorAll(inputElement)[0];
    // 創建DataTransfer物件來模擬檔案拖放
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    
    // 將檔案設定到input元素
    fileinput.files = dataTransfer.files;
    
    // 觸發change事件
    fileinput.dispatchEvent(new Event('change', { bubbles: true }));
}
function loadFileToInputQueryIndex(file, inputElement, index) {
    const fileinput = document.querySelectorAll(inputElement)[index];
    // 創建DataTransfer物件來模擬檔案拖放
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    
    // 將檔案設定到input元素
    fileinput.files = dataTransfer.files;
    
    // 觸發change事件
    fileinput.dispatchEvent(new Event('change', { bubbles: true }));
}
function loadMultipleFileToInput(files, inputElement) {
    const fileinput = document.getElementById(inputElement);
    // 創建DataTransfer物件來模擬檔案拖放
    const dataTransfer = new DataTransfer();
    //dataTransfer.items.add(file);
    Array.from(files).forEach(file => {
        dataTransfer.items.add(file);
    });
    // 將檔案設定到input元素
    fileinput.files = dataTransfer.files;
    
    // 觸發change事件
    fileinput.dispatchEvent(new Event('change', { bubbles: true }));
}
function loadFileToInputAll(file, condition, index_) {
    const fileinput = document.querySelectorAll(condition)[index_];
    // 創建DataTransfer物件來模擬檔案拖放
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    
    // 將檔案設定到input元素
    fileinput.files = dataTransfer.files;
    
    // 觸發change事件
    fileinput.dispatchEvent(new Event('change', { bubbles: true }));
}
async function extractZip(blob) {
    if(!blob){
        return;
    }
    
    const zipFile = blob;
    try{
        const arrayBuffer = await zipFile.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);
        
        // 遍歷 ZIP 檔案中的所有檔案
        for (const [filename, file] of Object.entries(zip.files)) {
            if (!file.dir) { // 如果不是資料夾
                console.log('檔案名稱:', filename);
                
                // 根據檔案類型選擇解壓縮方式
                if((filename) == "metadata.json"){
                    // 文字檔案
                    const content = await file.async('text');
                    importData = JSON.parse(content);
                    console.log(importData);
                    //displayTextFile(filename, content, resultDiv);
                }else{
                    // 其他檔案
                }
            }
        }
    }catch(error) {
        console.error('解壓縮失敗:', error);
        resultDiv.innerHTML = `<p style="color: red;">解壓縮失敗: ${error.message}</p>`;
    }
}
function waitForVueInstance() {
  return new Promise((resolve) => {
    const check = () => {
      const element = document.querySelector('.container.container--fluid');
      if (element && element.__vue__) {
        resolve(element.__vue__);
      } else {
        setTimeout(check, 3000);
      }
    };
    check();
  });
}
async function extractZipExpress() {
    const fileInput = document.getElementById('safertw_zipFile');
    if (!fileInput.files[0]) {
        alert('請選擇一個 ZIP 檔案');
        return;
    }
    const zipFile = fileInput.files[0];
    //console.log(zipFile);
    
    try{
        //swal("處理中", "檔案解壓縮和解析中...", "warning");
        const arrayBuffer = await zipFile.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);
        let fileProcessIndex = 0;
        let fileURLqueue = [];
        let files = [];
        let photoFiles = [];
        let videoFiles = [];
        if(countyIndicator == "台北市"){
            vueInstance = document.querySelector('.container.container--fluid').__vue__;
        }else if(countyIndicator == "台中市"){
            vueInstance = document.querySelector('.container.container--fluid').__vue__;
        }

        // 遍歷 ZIP 檔案中的所有檔案
        for (const [filename, file] of Object.entries(zip.files)) {
            if(!file.dir){ // 如果不是資料夾
                switch(countyIndicator){
                    case "桃園市" : {

                    const WebInputList = [
                        "files1",
                        "files2",
                        "files3",
                        "files4",
                        "files5",
                    ];

                    //console.log(file)
                    if((filename) == "metadata.json"){
                        // 文字檔案
                        const content = await file.async('text');
                        importData = JSON.parse(content);
                        //console.log(importData);
                        //start input into police site
                        //add carNum to form
                        $$$("#addNo").val((importData.overall.add_rest).match(/\d+/) ? (importData.overall.add_rest).match(/\d+/)[0] : "");
                        $$$("#CarNum").val((importData.overall.car_plate).split("-")[0]);
                        $$$("#CarNum2").val((importData.overall.car_plate).split("-")[1]);
                        $$$("#cardate").val((importData.overall.date).replace(/-/g, "/"));
                        $$$("#carTime").val((importData.overall.time).substring(0, 5));
                        $$$("#myform > div.main-page2 > table > tbody > tr:nth-child(9) > td > label:nth-child(1)").text("＊違規地址："+importData.overall.add_full);
                        const selectElementCity = document.getElementById('city');
                        selectByText(selectElementCity, importData.overall.add_county);
                        const selectElementDistrict = document.getElementById('village');
                        selectByText(selectElementDistrict, importData.overall.add_district);
                        simulateChineseInput("#selectize_Road-selectized", importData.overall.add_road);
                        var TargetRoadValue = $$$(".selectize-dropdown-content").first().find(".option");
                        let Roads = searchByTitle(TargetRoadValue, importData.overall.add_road);
                        if(Roads.length > 0){
                            $$$(".option[data-value="+Roads[0].value+"]").first().click();
                        }
                        
                        //$$$("#myform > div:nth-child(6) > p:nth-child(1) > label").click();
                        //proceed to Files
                        
                        swal("成功帶入", "請再次確認內容", "success");
                        $$$("#safertw_closeSidebar").click();

                            //
                    }else{
                        // 其他檔案
                        //console.log(filename)
                        if(fileProcessIndex < (WebInputList.length -1 )){
                            const blob = await file.async('blob');
                            //console.log(blob)
                            const url = URL.createObjectURL(blob);
                            fileURLqueue[fileProcessIndex] = url;
                            const fileSingle = blobToFile(blob, filename);
                            loadFileToInput(fileSingle, (WebInputList[fileProcessIndex]));

                            fileProcessIndex += 1; 
                        }
                        
                    }

                    break;
                    }

                    case "台北市" : {
                    //console.log(file)
                    if((filename) == "metadata.json"){
                        
                        // 文字檔案
                        const content = await file.async('text');
                        importData = JSON.parse(content);
                        //console.log(importData);
                        simulateVuetifyVSelect(importData.overall.add_full, {
                            inputId: 'sViladd'
                        });
                        simulateVuetifyVSelect((importData.overall.time).substring(0, 2), {
                            inputId: 'input-88'
                        });
                        simulateVuetifyVSelect((importData.overall.time).substring(3, 5), {
                            inputId: 'input-92'
                        });
                        simulateVuetifyVSelect((importData.overall.car_plate).split("-")[0], {
                            inputId: 'input-100'
                        });
                        simulateVuetifyVSelect((importData.overall.car_plate).split("-")[1], {
                            inputId: 'input-103'
                        });
                        simulateVuetifyVSelect((importData.overall.content), {
                            inputId: 'sRuldec'
                        });

                        swal("成功帶入", "請再次確認內容", "success");
                        $$$("#safertw_closeSidebar").click();
                        
                        
                    }else{
                        // 其他檔案
                        if(fileProcessIndex < 5){
                            const blob = await file.async('blob');
                            const fileSingle = blobToFile(blob, filename);
                            const Ext = getFileExtensionOri(filename);
                            const base64 = await blobToBase64(blob);

                            vueInstance.photos.push({
                                file: fileSingle,
                                name: filename,
                                size: fileSingle.size,
                                thumb: base64,
                                extension: Ext,
                                date: "無資料",
                                sub_ps: ""
                            });
                            fileProcessIndex += 1; 
                        }
                        
                    }

                    break;
                    }

                    case "新北市" : {
                    //console.log(file)
                    if((filename) == "metadata.json"){
                        
                        // 文字檔案
                        const content = await file.async('text');
                        importData = JSON.parse(content);
                        console.log(importData);
                        //start input into police site
                        /*
                        $$$("#cardate").val((importData.overall.date).replace(/-/g, "/"));
                        $$$("#carTime").val((importData.overall.time).substring(0, 5));
                        const selectElementCity = document.getElementById('city');
                        selectByText(selectElementCity, importData.overall.add_county);
                        const selectElementDistrict = document.getElementById('village');
                        selectByText(selectElementDistrict, importData.overall.add_district);
                        simulateChineseInput("#selectize_Road-selectized", importData.overall.add_road);
                        var TargetRoadValue = $$$(".selectize-dropdown-content").first().find(".option");
                        let Roads = searchByTitle(TargetRoadValue, importData.overall.add_road);
                        $$$(".option[data-value="+Roads[0].value+"]").first().click();
                        $$$("#addNo").click()
                        $$$("#addNo").val(importData.overall.add_num); 
                        //proceed to Files
                        */

                        $$$("#eventsData_vio_date").val((importData.overall.date));
                        $$$("#eventsData_vio_hour").val((importData.overall.time).substring(0, 2));
                        $$$("#eventsData_vio_min").val(parseInt((importData.overall.time).substring(3, 5)));
                        $$$("#eventsData_custom_addr").val(importData.overall.add_full);
                        $$$("#eventsData_vio_content_memo").val(importData.overall.content);
                        swal("成功帶入", "請再次確認內容", "success");
                        $$$("#safertw_closeSidebar").click();
                        
                        
                    }else{
                        // 其他檔案
                        //console.log(filename)
                        if(fileProcessIndex < 5){
                            const blob = await file.async('blob');
                            //console.log(blob)
                            const fileSingle = blobToFile(blob, filename);
                            //const Ext = getFileExtensionOri(filename);
                            const url = URL.createObjectURL(blob);
                            fileURLqueue[fileProcessIndex] = url;
                            loadFileToInputAll(fileSingle, "input.isfile:not(.btn)", fileProcessIndex);

                            fileProcessIndex += 1; 
                        }
                        
                    }

                    break;
                    }

                    case "台中市" : {

                    //console.log(file)
                    if((filename) == "metadata.json"){
                        
                        // 文字檔案
                        const content = await file.async('text');
                        importData = JSON.parse(content);
                        //console.log(importData);
                        simulateVuetifyVSelect(importData.overall.add_full, {
                            inputId: 'input-132'
                        });
                        simulateVuetifyVSelect((function(d){ const p=d.split('-'); return (parseInt(p[0])-1911)+p[1]+p[2]; })(importData.overall.date), {
                            inputId: 'input-83'
                        });
                        simulateVuetifyVSelect((function(d){ const p=d.split(':'); return (p[0]+p[1]); })(importData.overall.time), {
                            inputId: 'input-89'
                        });
                        simulateVuetifyVSelect((importData.overall.car_plate).split("-")[0], {
                            inputId: 'input-96'
                        });
                        simulateVuetifyVSelect((importData.overall.car_plate).split("-")[1], {
                            inputId: 'input-99'
                        });
                        simulateVuetifyVSelect((importData.overall.content), {
                            inputId: 'input-140'
                        });


                        swal("成功帶入", "請再次確認內容", "success");
                        $$$("#safertw_closeSidebar").click();
                        
                        
                    }else{
                        // 其他檔案
                        if(fileProcessIndex < 5){
                            const blob = await file.async('blob');
                            const fileSingle = blobToFile(blob, filename);
                            const Ext = getFileExtensionOri(filename);
                            const base64 = await blobToBase64(blob);

                            vueInstance.photos.push({
                                file: fileSingle,
                                name: filename,
                                size: fileSingle.size,
                                thumb: base64,
                                extension: Ext,
                                date: "無資料",
                                sub_ps: ""
                            });
                            fileProcessIndex += 1; 
                        }
                        
                    }

                    break;
                    }
                    
                    case "台南市" : {

                    const WebInputList = [
                        "Upfile1",
                        "Upfile2",
                        "Upfile3",
                        "Upfile4",
                        "Upfile5",
                        "Upfile6",
                    ];
                    //console.log(file)
                    if((filename) == "metadata.json"){
                        
                        // 文字檔案
                        const content = await file.async('text');
                        importData = JSON.parse(content);
                        console.log(importData);
                        $$$("#violation_date").val((importData.overall.date).replace(/-/g, "/"));
                        $$$("#violation_time1").val( parseInt((importData.overall.time).split(':')[0], 10).toString());
                        $$$("#violation_time2").val( parseInt((importData.overall.time).split(':')[1], 10).toString());
                        simulateTyping(document.getElementById('violation_place'), importData.overall.add_full , 10);
                        simulateTyping(document.getElementById('violation_carno1'), (importData.overall.car_plate).split('-')[0] , 10);
                        simulateTyping(document.getElementById('violation_carno2'), (importData.overall.car_plate).split('-')[1] , 10);
                        swal("成功帶入", "請再次確認內容", "success");
                        $$$("#safertw_closeSidebar").click();
                        
                        
                    }else{
                        // 其他檔案
                        if(fileProcessIndex < 6){
                            const blob = await file.async('blob');
                            //console.log(blob)
                            const url = URL.createObjectURL(blob);
                            fileURLqueue[fileProcessIndex] = url;
                            const fileSingle = blobToFile(blob, filename);
                            loadFileToInput(fileSingle, (WebInputList[fileProcessIndex]));

                            fileProcessIndex += 1; 
                        }
                        
                    }

                    break;
                    }

                    case "高雄市" : {

                    //console.log(file)
                    if((filename) == "metadata.json"){
                        
                        // 文字檔案
                        const content = await file.async('text');
                        importData = JSON.parse(content);
                        console.log(importData);
                        $$$("#ContentPlaceHolder1_ViolationDate").val((importData.overall.date) + " " + (importData.overall.time).substring(0, 5));
                        $$$("#ContentPlaceHolder1_uscPlace_txtAddress").val(importData.overall.add_full);
                        $$$("#ContentPlaceHolder1_LicenseNo").val((importData.overall.car_plate).split('-')[0]);
                        $$$("#ContentPlaceHolder1_LicenseNo2").val((importData.overall.car_plate).split('-')[1]);
                        //swal("成功帶入", "請再次確認內容", "success");
                        $$$("#safertw_closeSidebar").click();
                        
                        
                    }else{
                        // 其他檔案
                        if(fileProcessIndex < 6){
                            const blob = await file.async('blob');
                            //console.log(blob)
                            const url = URL.createObjectURL(blob);
                            fileURLqueue[fileProcessIndex] = url;
                            const fileSingle = blobToFile(blob, filename);
                            files.push(fileSingle);
                            //loadFileToInput(fileSingle, ("ContentPlaceHolder1_fl_File"));

                            fileProcessIndex += 1;
                        }
                        
                    }

                    break;
                    }

                    case "苗栗縣" : {

                    const WebInputList = [
                        "File1",
                        "File2",
                        "File3",
                        "File4",
                    ];
                    //console.log(file)
                    if((filename) == "metadata.json"){
                        
                        // 文字檔案
                        const content = await file.async('text');
                        importData = JSON.parse(content);
                        console.log(importData);
                        $$$("#DateOfOccurrence").val((importData.overall.date) + " " + (importData.overall.time));
                        const selectElementDistrict = document.getElementById('TownIdOfOccurrence');
                        selectByText(selectElementDistrict, importData.overall.add_district);
                        simulateTyping(document.getElementById('AddressOfOccurrence'), importData.overall.add_full, 10);
                        simulateTyping(document.getElementById('ViolationRemark'), importData.overall.content, 10);
                        simulateTyping(document.getElementById('FistCarNumber'), (importData.overall.car_plate).split('-')[0], 10);
                        simulateTyping(document.getElementById('LastCarNumber'), (importData.overall.car_plate).split('-')[1], 10);
                        swal("成功帶入", "請再次確認內容", "success");
                        $$$("#safertw_closeSidebar").click();
                        
                    }else{
                        // 其他檔案
                        if(fileProcessIndex < 4){
                            const blob = await file.async('blob');
                            //console.log(blob)
                            const url = URL.createObjectURL(blob);
                            fileURLqueue[fileProcessIndex] = url;
                            const fileSingle = blobToFile(blob, filename);
                            loadFileToInput(fileSingle, (WebInputList[fileProcessIndex]));
                            fileProcessIndex += 1; 
                        }
                    }

                    break;
                    }

                    case "彰化縣" : {

                    const WebInputList = [
                        "File1",
                        "File2",
                        "File3",
                        "File4",
                        "File5",
                    ];
                    //console.log(file)
                    if((filename) == "metadata.json"){
                        
                        // 文字檔案
                        const content = await file.async('text');
                        importData = JSON.parse(content);
                        console.log(importData);
                        $$$("#ViolationDate").val((importData.overall.date));
                        $$$("#ViolationTime").val((importData.overall.time).substring(0, 5));
                        $$$("#Subject").val((importData.overall.content));
                        $$$("#ViolationDescription").val((importData.overall.content));
                        $$$("#LicensePlateNumber").val((importData.overall.car_plate));
                        const selectElementDistrict = document.getElementById('ViolationArea');
                        selectByText(selectElementDistrict, importData.overall.add_district);
                        $$$("#ViolationLocation").val(importData.overall.add_full);
                        swal("成功帶入", "請再次確認內容", "success");
                        $$$("#safertw_closeSidebar").click();
                        $$$("#DataCollectionConsultation").click();
                        
                    }else{
                        // 其他檔案
                        if(fileProcessIndex < 5){
                            const blob = await file.async('blob');
                            //console.log(blob)
                            const url = URL.createObjectURL(blob);
                            fileURLqueue[fileProcessIndex] = url;
                            const fileSingle = blobToFile(blob, filename);
                            loadFileToInput(fileSingle, (WebInputList[fileProcessIndex]));
                            fileProcessIndex += 1; 
                        }
                    }

                    break;
                    }

                    case "雲林縣" : {

                    const WebInputList = [
                        "File1",
                        "File2",
                    ];
                    //console.log(file)
                    if((filename) == "metadata.json"){
                        
                        // 文字檔案
                        const content = await file.async('text');
                        importData = JSON.parse(content);
                        console.log(importData);
                        $$$("input[name=SetDateOfOccurrence]").val((importData.overall.date));
                        $$$("input[name=SetTimeOfOccurrence]").val((importData.overall.time).substring(0, 5));
                        $$$("#FistCarNumber").val((importData.overall.car_plate).split('-')[0]);
                        $$$("#LastCarNumber").val((importData.overall.car_plate).split('-')[1]);
                        const selectElementDistrict = document.getElementById('TownIdOfOccurrence');
                        selectByText(selectElementDistrict, importData.overall.add_district);
                        $$$("#AddressOfOccurrence").val(importData.overall.add_full);
                        $$$("#ViolationRemark").val(importData.overall.content);
                        swal("成功帶入", "請再次確認內容", "success");
                        $$$("#safertw_closeSidebar").click();
                        $$$("#DataCollectionConsultation").click();
                        
                    }else{
                        // 其他檔案
                        if(fileProcessIndex < 2){
                            const blob = await file.async('blob');
                            //console.log(blob)
                            const url = URL.createObjectURL(blob);
                            fileURLqueue[fileProcessIndex] = url;
                            const fileSingle = blobToFile(blob, filename);
                            loadFileToInput(fileSingle, (WebInputList[fileProcessIndex]));
                            fileProcessIndex += 1; 
                        }
                    }

                    break;
                    }

                    case "嘉義縣" : {

                    const WebInputList = [
                        "checkFile1",
                        "checkFile2",
                        "checkFile3",
                        "checkFile4",
                        "checkFile5",
                    ];
                    //console.log(file)
                    if((filename) == "metadata.json"){
                        
                        // 文字檔案
                        const content = await file.async('text');
                        importData = JSON.parse(content);
                        console.log(importData);
                        $$$("#checkHour").val( parseInt((importData.overall.time).split(':')[0], 10).toString());
                        $$$("#checkMin").val( parseInt((importData.overall.time).split(':')[1], 10).toString());
                        $$$("#checkCarNum").val(importData.overall.car_plate);
                        const selectElementDate = document.getElementById('checkstartTime');
                        selectByText(selectElementDate, (importData.overall.date).replace(/-/g, "/"));
                        const selectElementDistrict = document.getElementById('checkCountry');
                        selectByText(selectElementDistrict, importData.overall.add_district);
                        $$$("#checkAddress").val(importData.overall.add_full);
                        $$$("#Memo").val(importData.overall.content);
                        swal("成功帶入", "請再次確認內容", "success");
                        $$$("#safertw_closeSidebar").click();
                        $$$("#DataCollectionConsultation").click();
                        
                    }else{
                        // 其他檔案
                        if(fileProcessIndex < 2){
                            const blob = await file.async('blob');
                            //console.log(blob)
                            const url = URL.createObjectURL(blob);
                            fileURLqueue[fileProcessIndex] = url;
                            const fileSingle = blobToFile(blob, filename);
                            loadFileToInput(fileSingle, (WebInputList[fileProcessIndex]));
                            fileProcessIndex += 1; 
                        }
                    }

                    break;
                    }

                    case "宜蘭縣" : {

                    const WebInputList = [
                        'input[name="data[0]"]',
                        'input[name="data[1]"]',
                        'input[name="data[2]"]',
                        'input[name="data[3]"]',
                    ];
                    //console.log(file)
                    if((filename) == "metadata.json"){
                        
                        // 文字檔案
                        const content = await file.async('text');
                        importData = JSON.parse(content);
                        console.log(importData);
                        $$$("#datepicker1").val((importData.overall.date) + " " + (importData.overall.time).substring(0, 5));
                        $$$("#address").val(importData.overall.add_full);
                        $$$("#carcode").val((importData.overall.car_plate).split('-')[0]);
                        $$$("#carcode12").val((importData.overall.car_plate).split('-')[1]);
                        $$$("#content22").val(importData.overall.content);
                        swal("成功帶入", "請再次確認內容", "success");
                        $$$("#safertw_closeSidebar").click();
                        
                    }else{
                        // 其他檔案
                        if(fileProcessIndex < 4){
                            const blob = await file.async('blob');
                            //console.log(blob)
                            const url = URL.createObjectURL(blob);
                            fileURLqueue[fileProcessIndex] = url;
                            const fileSingle = blobToFile(blob, filename);
                            loadFileToInputQuery(fileSingle, (WebInputList[fileProcessIndex]));
                            fileProcessIndex += 1; 
                        }
                    }

                    break;
                    }

                    case "花蓮縣" : {

                    const WebInputList = [
                        "pic_1",
                        "pic_2",
                        "pic_3",
                        "pic_4",
                    ];
                    //console.log(file)
                    if((filename) == "metadata.json"){
                        
                        // 文字檔案
                        const content = await file.async('text');
                        importData = JSON.parse(content);
                        console.log(importData);
                        $$$("#timet").val( (importData.overall.time).split(':')[0]);
                        $$$("#tmi").val( (importData.overall.time).split(':')[1]);
                        $$$("#datet").val( importData.overall.date );
                        $$$("input[name=subject]").val( (importData.overall.car_plate).split('-')[0] );
                        $$$("input[name=subject6]").val( (importData.overall.car_plate).split('-')[1] );
                        $$$("#content").val(importData.overall.add_full + " \n " + importData.overall.content);
                        swal("成功帶入", "請再次確認內容", "success");
                        $$$("#safertw_closeSidebar").click();
                        
                    }else{
                        // 其他檔案
                        if(fileProcessIndex < 4){
                            const blob = await file.async('blob');
                            //console.log(blob)
                            const url = URL.createObjectURL(blob);
                            fileURLqueue[fileProcessIndex] = url;
                            const fileSingle = blobToFile(blob, filename);
                            loadFileToInput(fileSingle, (WebInputList[fileProcessIndex]));
                            fileProcessIndex += 1; 
                        }
                    }

                    break;
                    }

                    case "基隆市" : {

                    const WebInputList = [
                        'FileUpload1',
                        'FileUpload2',
                        'FileUpload3',
                        'FileUpload4',
                    ];
                    //console.log(file)
                    if((filename) == "metadata.json"){
                        
                        // 文字檔案
                        const content = await file.async('text');
                        importData = JSON.parse(content);
                        //console.log(importData);
                        $$$("#IllegalHour").val( parseInt((importData.overall.time).split(':')[0], 10).toString());
                        $$$("#IllegalMinute").val( parseInt((importData.overall.time).split(':')[1], 10).toString());
                        $$$("#IllegalCarNo1").val((importData.overall.car_plate));
                        $$$("#IllegalDate").val((importData.overall.date).replace(/-/g, "/"));
                        const selectElementDistrict = document.getElementById('OccurAddr1_2');
                        selectByText(selectElementDistrict, importData.overall.add_district);
                        $$$("#IllegalContent").val(importData.overall.add_full + " \n " + importData.overall.content);
                        swal("成功帶入", "請再次確認內容", "success");
                        $$$("#safertw_closeSidebar").click();
                        
                    }else{
                        // 其他檔案
                        if(fileProcessIndex < 4){
                            const blob = await file.async('blob');
                            //console.log(blob)
                            const url = URL.createObjectURL(blob);
                            fileURLqueue[fileProcessIndex] = url;
                            const fileSingle = blobToFile(blob, filename);
                            loadFileToInput(fileSingle, (WebInputList[fileProcessIndex]));
                            fileProcessIndex += 1; 
                        }
                    }

                    break;
                    }

                    case "新竹市" : {

                    const WebInputList = [
                        'case_case_attachments_attributes_0_file',
                        'case_case_attachments_attributes_1_file',
                        'case_case_attachments_attributes_2_file',
                        'case_case_attachments_attributes_3_file',
                        'case_case_attachments_attributes_4_file',
                    ];
                    //console.log(file)
                    if((filename) == "metadata.json"){
                        
                        // 文字檔案
                        const content = await file.async('text');
                        importData = JSON.parse(content);
                        console.log(importData);
                        $$$("#case_violated_at_hour").val(((importData.overall.time).split(':')[0]).toString());
                        $("#case_violated_at_hour").select2();
                        $$$("#case_violated_at_min").val(((importData.overall.time).split(':')[1]).toString());
                        $("#case_violated_at_min").select2();
                        $$$("#case_violated_at_date").val((importData.overall.date));
                        $("#case_violated_at_date").select2();
                        $$$("#case_addr_detail").val(importData.overall.add_full);
                        $$$("#case_first_car_number").val(importData.overall.car_plate.split("-")[0]);
                        $$$("#case_last_car_number").val(importData.overall.car_plate.split("-")[1]);
                        swal("成功帶入", "請再次確認內容", "success");
                        $$$("#safertw_closeSidebar").click();
                        $$$("#case_read_statement").click();
                        
                    }else{
                        // 其他檔案
                        if(fileProcessIndex < 5){
                            const blob = await file.async('blob');
                            //console.log(blob)
                            const url = URL.createObjectURL(blob);
                            fileURLqueue[fileProcessIndex] = url;
                            let fileSingle;
                            if(getFileExtensionOri(filename).toLowerCase() == "jpeg"){
                                fileSingle = blobToFile(blob, filename+".jpg");
                            }else{
                                fileSingle = blobToFile(blob, filename);
                            }
                            
                            loadFileToInput(fileSingle, (WebInputList[fileProcessIndex]));
                            fileProcessIndex += 1; 
                        }
                    }

                    break;
                    }

                    case "新竹縣" : {

                    const WebInputList = [
                        'input[id="fileInput"]',
                        'input[id="fileInput"]',
                        'input[id="fileInput"]',
                        'input[id="fileInput"]',
                    ];
                    //console.log(file)
                    if((filename) == "metadata.json"){
                        
                        // 文字檔案
                        const content = await file.async('text');
                        importData = JSON.parse(content);
                        //console.log(importData);
                        $$$("#MainContent_txtViolationTime").val(((importData.overall.time).split(':')[0]+":"+(importData.overall.time).split(':')[1]).toString());
                        $$$("#MainContent_txtViolationDate").val((importData.overall.date));
                        $$$("#MainContent_txtViolationOther").val(importData.overall.add_full);
                        $$$("#MainContent_txtCarCode1").val((importData.overall.car_plate).split("-")[0]);
                        $$$("#MainContent_txtCarCode2").val((importData.overall.car_plate).split("-")[1]);
                        $$$("#MainContent_txtContent").val(importData.overall.content);
                        swal("成功帶入", "請再次確認內容", "success");
                        $$$("#safertw_closeSidebar").click();
                        
                    }else{
                        // 其他檔案
                        if(fileProcessIndex < 4){
                            const blob = await file.async('blob');
                            //console.log(blob)
                            const url = URL.createObjectURL(blob);
                            fileURLqueue[fileProcessIndex] = url;
                            let fileSingle;
                            fileSingle = blobToFile(blob, filename);

                            loadFileToInputQueryIndex(fileSingle, (WebInputList[fileProcessIndex]), fileProcessIndex);
                            fileProcessIndex += 1;
                        }
                    }

                    break;
                    }

                    case "屏東縣" : {

                    const WebInputList = [
                        'filename1',
                        'filename2',
                        'filename3',
                        'filename4',
                    ];
                    //console.log(file)
                    if((filename) == "metadata.json"){
                        
                        // 文字檔案
                        const content = await file.async('text');
                        importData = JSON.parse(content);
                        console.log(importData);
                        $$$("#violationdatetime").val( (importData.overall.date) + " " + (importData.overall.time).substring(0, 5) );
                        $$$("#cityarea").val(importData.overall.add_district);
                        $$$("#licensenumber1").val(importData.overall.car_plate.split("-")[0]);
                        $$$("#licensenumber2").val(importData.overall.car_plate.split("-")[1]);
                        
                        $$$("#detailcontent").val(importData.overall.content);
                        $$$("#inputaddress").val(importData.overall.add_full);
                        swal("成功帶入", "請再次確認內容", "success");
                        $$$("#safertw_closeSidebar").click();
                        
                    }else{
                        // 其他檔案
                        if(fileProcessIndex < 4){
                            const blob = await file.async('blob');
                            //console.log(blob)
                            const url = URL.createObjectURL(blob);
                            fileURLqueue[fileProcessIndex] = url;
                            const fileSingle = blobToFile(blob, filename);
                            loadFileToInput(fileSingle, (WebInputList[fileProcessIndex]));
                            fileProcessIndex += 1; 
                        }
                    }

                    break;
                    }

                    case "嘉義市" : {

                    const PhotoInputList = [
                        'filename1',
                        'filename2',
                        'filename3',
                        'filename4',
                    ];
                    const VideoInputList = [
                        'videofile1',
                        'videofile2',
                    ];
                    const photoExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'];
                    const videoExtensions = ['mp4', 'mpeg', 'mov', 'avi', 'wmv', 'mkv'];
                    //console.log(file)
                    if((filename) == "metadata.json"){
                        
                        // 文字檔案
                        const content = await file.async('text');
                        importData = JSON.parse(content);
                        //console.log(importData);
                        $$$("#violationdatetime").val( (importData.overall.date) + " " + (importData.overall.time).substring(0, 5) );
                        $$$("#cityarea").val(importData.overall.add_district);
                        $$$("body > div.page > main > article > div > div > div > div.main-content-card > div > div.form-container > div.dynamic-form-container > form > div.form-fields > div > div:nth-child(11) > div > div > div > input").val(importData.overall.car_plate);

                        $$$("input[type=tel]").val(UserData.UserPhone);
                        $$$("body > div.page > main > article > div > div > div > div.main-content-card > div > div.form-container > div.dynamic-form-container > form > div.form-fields > div > div:nth-child(3) > div > div > div > div.card-body > div > input").val(UserData.UserID);
                        $$$("body > div.page > main > article > div > div > div > div.main-content-card > div > div.form-container > div.dynamic-form-container > form > div.form-fields > div > div:nth-child(7) > div > div > div.col-md-6 > input").val(UserData.UserAddress);
                        $$$("body > div.page > main > article > div > div > div > div.main-content-card > div > div.form-container > div.dynamic-form-container > form > div.form-fields > div > div:nth-child(14) > div > div > div.col-md-6 > input").val(importData.overall.add_full);
                        $$$("body > div.page > main > article > div > div > div > div.main-content-card > div > div.form-container > div.dynamic-form-container > form > div.form-fields > div > div:nth-child(17) > div > textarea").val(importData.overall.content);

                        
                        $$$("#detailcontent").val(importData.overall.content);
                        $$$("#inputaddress").val(importData.overall.add_full);
                        swal("成功帶入", "請再次確認內容", "success");
                        $$$("#safertw_closeSidebar").click();
                        
                    }else{
                        // 其他檔案
                        const fileExt = getFileExtensionOri(filename).toLowerCase();
                        const isPhoto = photoExtensions.includes(fileExt);
                        const isVideo = videoExtensions.includes(fileExt);
                        const blob = await file.async('blob');
                        const fileSingle = blobToFile(blob, filename);
                        if(isPhoto){
                            photoFiles.push(fileSingle);
                        }else if(isVideo){
                            videoFiles.push(fileSingle);
                        }
                    }

                    break;
                    }

                    case "台東縣" : {

                    const WebInputList = [
                        'file1',
                        'file2',
                        'file3',
                    ];
                    //console.log(file)
                    if((filename) == "metadata.json"){
                        // 文字檔案
                        const content = await file.async('text');
                        importData = JSON.parse(content);
                        //console.log(importData);
                        $$$("#odate").val((importData.overall.date).replace(/-/g, ""));
                        $$$("#hh").val(((importData.overall.time).split(':')[0]).toString());
                        $$$("#mm").val(((importData.overall.time).split(':')[1]).toString());
                        $$$("#cityarea").val(importData.overall.add_district);
                        $$$("#car").val(importData.overall.car_plate);
                        
                        $$$("#content1").val(importData.overall.content);
                        $$$("#oad").val(importData.overall.add_full);
                        swal("成功帶入", "請再次確認內容", "success");
                        $$$("#safertw_closeSidebar").click();
                        
                    }else{
                        // 其他檔案
                        if(fileProcessIndex < 3){
                            const blob = await file.async('blob');
                            //console.log(blob)
                            const url = URL.createObjectURL(blob);
                            fileURLqueue[fileProcessIndex] = url;
                            const fileSingle = blobToFile(blob, filename);
                            loadFileToInput(fileSingle, (WebInputList[fileProcessIndex]));
                            fileProcessIndex += 1; 
                        }
                    }

                    break;
                    }

                    case "澎湖縣" : {

                    const WebInputList = [
                        'file1',
                        'file2',
                        'file3',
                        'file4',
                        'file5',
                    ];
                    //console.log(file)
                    if((filename) == "metadata.json"){
                        // 文字檔案
                        const content = await file.async('text');
                        importData = JSON.parse(content);
                        //console.log(importData);
                        $$$("#impdate").val((importData.overall.date));
                        $$$("#hh").val(((importData.overall.time).split(':')[0]).toString());
                        $$$("#mm").val(((importData.overall.time).split(':')[1]).toString());
                        $$$("#carno1").val(importData.overall.car_plate.split("-")[0]);
                        $$$("#carno2").val(importData.overall.car_plate.split("-")[1]);
                        $$$("#dataread").click();
                        
                        $$$("#impaddress").val(importData.overall.add_full);
                        swal("成功帶入", "請再次確認內容", "success");
                        $$$("#safertw_closeSidebar").click();
                        
                    }else{
                        // 其他檔案
                        if(fileProcessIndex < 5){
                            const blob = await file.async('blob');
                            //console.log(blob)
                            const url = URL.createObjectURL(blob);
                            fileURLqueue[fileProcessIndex] = url;
                            const fileSingle = blobToFile(blob, filename);
                            loadFileToInput(fileSingle, (WebInputList[fileProcessIndex]));
                            fileProcessIndex += 1; 
                        }
                    }

                    break;
                    }

                    case "南投縣" : {

                    const WebInputList = [
                        'file1',
                        'file2',
                        'file3',
                    ];
                    //console.log(file)
                    if((filename) == "metadata.json"){
                        // 文字檔案
                        const content = await file.async('text');
                        importData = JSON.parse(content);
                        //console.log(importData);
                        $$$("#txtDate").val((importData.overall.date).replace(/-/g, "/"));
                        $$$("#mcarhour").val((parseInt((importData.overall.time).split(':')[0])).toString());
                        $$$("#mcarmitu").val((parseInt((importData.overall.time).split(':')[1])).toString());
                        $$$("#mcarno").val(importData.overall.car_plate);
                        
                        $$$("#mcarblack").val(importData.overall.content);
                        $$$("#mcaraddr").val(importData.overall.add_full);
                        swal("成功帶入", "請再次確認內容", "success");
                        $$$("#safertw_closeSidebar").click();
                        
                    }else{
                        // 其他檔案
                        if(fileProcessIndex < 3){
                            //const blob = await file.async('blob');
                            //console.log(blob)
                            //const url = URL.createObjectURL(blob);
                            //fileURLqueue[fileProcessIndex] = url;
                            //const fileSingle = blobToFile(blob, filename);
                            //loadFileToInput(fileSingle, (WebInputList[fileProcessIndex]));
                            //fileProcessIndex += 1; 
                        }
                    }

                    break;
                    }
                }
            }
        }

        if(countyIndicator == "高雄市"){
            loadMultipleFileToInput(files, ("ContentPlaceHolder1_fl_File"));
            $$$("input[type=submit]")[0].click();
        }

        if(countyIndicator == "嘉義市"){
            if(photoFiles.length > 0){
                const photoInput = document.querySelectorAll('input[type=file]')[2];
                const dtPhoto = new DataTransfer();
                photoFiles.forEach(f => dtPhoto.items.add(f));
                photoInput.files = dtPhoto.files;
                photoInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if(videoFiles.length > 0){
                const videoInput = document.querySelectorAll('input[type=file]')[1];
                const dtVideo = new DataTransfer();
                videoFiles.forEach(f => dtVideo.items.add(f));
                videoInput.files = dtVideo.files;
                videoInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }

        if(countyIndicator == "南投縣"){
            loadFileToInput(blobToFile(zipFile, zipFile.name), "FileUpload1");
        }

        //console.log(fileURLqueue);
    }catch(error) {
        swal('解壓縮失敗:', error.message || String(error));
        console.error('解壓縮失敗:', error);
    }
}

function MainFunction() {
    //console.log(items);
    UserData.UserName = storageData.UserName;
    UserData.UserID = storageData.UserID;
    UserData.UserEmail = storageData.UserEmail;
    UserData.UserPhone = storageData.UserPhone;
    UserData.UserAddress = storageData.UserAddress;
    console.log("[info]成功讀取預存資料");

    //Main functions
    const appURL = window.location.host;
    //console.log(appURL)
    enableSaferFileMenu = 0;
    switch (appURL) {
        // 桃園市
        case "tvrweb.typd.gov.tw:3444": {
            console.log("[info]桃園市檢舉系統");
            countyIndicator = "桃園市";
            const pathURL = window.location.pathname;
            console.log("[info]pathURL: " + pathURL)
            switch (pathURL) {
                case "/": {
                    $$$(document).ready(function() {
                        $$$("#cbox1").click();
                        syncDelay(100);
                        $$$("#button").click();  
                    });
                    break;
                }
                case "/TTPB/D0101": {
                    $$$(document).ready(function() {
                        console.log("[info]桃園檢舉系統 - 自動輸入基本資料")
                        $$$("#txtName").val(UserData.UserName);
                        $$$("#txtId").val(UserData.UserID);
                        $$$("#txtEmaill").val(UserData.UserEmail);
                        $$$("#txtNum").val(UserData.UserPhone);
                        $$$("#txtAdd").val(UserData.UserAddress);
                    });
                    break;
                }
                case "/TTPB/D0102": {
                    enableSaferFileMenu = 1;
                    $$$(fileMenu).prependTo('body');
                    injectCSS(customCSS);

                    break;
                }
            }
            break;
        }
        // 台北市
        case "prsweb.tcpd.gov.tw": {
            console.log("[info]台北市檢舉系統");
            countyIndicator = "台北市";
            const pathURL = window.location.pathname;
            //console.log(UserData)
            console.log("[info]pathURL: " + pathURL)
            switch (pathURL) {
                case "/": {
                    onDOMReady(function() {
                        console.log("[info]台北市檢舉系統 - 自動輸入基本資料")
                        simulateTyping(document.getElementById('sPub_id'), UserData.UserID, 10);
                        simulateTyping(document.getElementById('sPub_nm'), UserData.UserName, 10);
                        simulateTyping(document.getElementById('email'), UserData.UserEmail, 10);
                        simulateTyping(document.getElementById('sPubtel'), UserData.UserPhone, 10);
                        simulateTyping(document.getElementById('sPubadd'), UserData.UserAddress, 10);
                    });
                    enableSaferFileMenu = 1;
                    $$$(fileMenu).prependTo('body');
                    injectCSS(customCSS);

                    break;
                }
            }
            break;
        }
        // 新北市
        case "tvrs.ntpd.gov.tw": {
            console.log("[info]新北市檢舉系統");
            countyIndicator = "新北市";
            const pathURL = window.location.pathname;
            //console.log(UserData)
            console.log("[info]pathURL: " + pathURL)
            switch (pathURL) {
                case "/Home/Report": {
                    $$$("#ck").click();
                    $$$(".btn-next").click();

                    break;
                }
                case "/Home/Report_Add": {

                    simulateTyping(document.getElementById('informerData_informer_name'), UserData.UserName, 10);
                    simulateTyping(document.getElementById('informerData_identity'), UserData.UserID, 10);
                    simulateTyping(document.getElementById('informerData_contact_address'), UserData.UserAddress, 10);
                    simulateTyping(document.getElementById('informerData_Phone'), UserData.UserPhone, 10);
                    simulateTyping(document.getElementById('informerData_Email'), UserData.UserEmail, 10);
                    $$$(".add_file").click();
                    $$$(".add_file").click();
                    $$$(".add_file").click();
                    $$$(".add_file").click();

                    enableSaferFileMenu = 1;
                    $$$(fileMenu).prependTo('body');
                    injectCSS(customCSS);

                    break;
                }
            }
            break;
        }
        // 台中市
        case "tvrweb.police.taichung.gov.tw": {
            console.log("[info]台中市檢舉系統");
            countyIndicator = "台中市";
            const pathURL = window.location.pathname;
            //console.log(UserData)
            console.log("[info]pathURL: " + pathURL)
            switch (pathURL) {
                case "/": {
                    onDOMReady(function() {
                        console.log("[info]台中市檢舉系統 - 自動輸入基本資料")
                        simulateTyping(document.getElementById('input-60'), UserData.UserID, 10);
                        simulateTyping(document.getElementById('input-63'), UserData.UserName, 10);
                        simulateTyping(document.getElementById('input-75'), UserData.UserEmail, 10);
                        simulateTyping(document.getElementById('input-66'), UserData.UserPhone, 10);
                        simulateTyping(document.getElementById('input-72'), UserData.UserAddress, 10);
                        $$$("#detailcontent").val("交通違規如上所述");
                    });
                    enableSaferFileMenu = 1;
                    $$$(fileMenu).prependTo('body');
                    injectCSS(customCSS);

                    break;
                }
            }
            break;
        }
        // 台南市
        case "tr.tnpd.gov.tw": {
            console.log("[info]台南市檢舉系統");
            countyIndicator = "台南市";
            const pathURL = window.location.pathname;
            //console.log(UserData)
            console.log("[info]pathURL: " + pathURL)
            switch (pathURL) {
                case "/TrafficMailbox/Index/92929b01-cf5e-99d6-2539-bee668350a6d": {
                    $$$("#checkRead").click()
                    $$$("#btnSend").click()
                    break;
                }
                case "/TrafficMailbox/Create": {
                    onDOMReady(function() {
                        console.log("[info]台南市檢舉系統 - 自動輸入基本資料")
                        simulateTyping(document.getElementById('Pid'), UserData.UserID, 10);
                        simulateTyping(document.getElementById('Name'), UserData.UserName, 10);
                        simulateTyping(document.getElementById('Email'), UserData.UserEmail, 10);
                        simulateTyping(document.getElementById('TEL'), UserData.UserPhone, 10);
                        simulateTyping(document.getElementById('Address'), UserData.UserAddress, 10);
                        $$$("#Subject").val("交通違規如下所述");
                    });
                    enableSaferFileMenu = 1;
                    $$$(fileMenu).prependTo('body');
                    injectCSS(customCSS);

                    break;
                }
            }
            break;
        }
        // 高雄市
        case "policemail.kcg.gov.tw": {
            console.log("[info]高雄市檢舉系統");
            countyIndicator = "高雄市";
            const pathURL = window.location.pathname;
            //console.log(UserData)
            console.log("[info]pathURL: " + pathURL)
            switch (pathURL) {
                case "/Statement.aspx": {
                    $$$("#ContentPlaceHolder1_chk1").click();
                    $$$("#ContentPlaceHolder1_chk2").click();
                    $$$("#ContentPlaceHolder1_chk3").click();
                    $$$("#ContentPlaceHolder1_chk4").click();
                    __doPostBack('ctl00$ContentPlaceHolder1$IWantToReport','')
                    break;
                }
                case "/Mail.aspx": {
                    onDOMReady(function() {
                        if($$$("#ContentPlaceHolder1_Name").val() == ""){
                            console.log("[info]高雄市檢舉系統 - 自動輸入基本資料")
                            simulateTyping(document.getElementById('ContentPlaceHolder1_txtCardID'), UserData.UserID, 10);
                            simulateTyping(document.getElementById('ContentPlaceHolder1_Name'), UserData.UserName, 10);
                            simulateTyping(document.getElementById('ContentPlaceHolder1_EMail'), UserData.UserEmail, 10);
                            simulateTyping(document.getElementById('ContentPlaceHolder1_Phone'), UserData.UserPhone, 10);
                            simulateTyping(document.getElementById('ContentPlaceHolder1_ucsAddress_txtAddress'), UserData.UserAddress, 10);
                            $$$("#ContentPlaceHolder1_Content").val("交通違規如選項所述");
                        }else{
                            console.log("[info]高雄市檢舉系統 - 已自動輸入基本資料");
                            swal("成功帶入", "請再次確認內容", "success");
                        }
                    });
                    enableSaferFileMenu = 1;
                    $$$(fileMenu).prependTo('body');
                    injectCSS(customCSS);

                    break;
                }
            }
            break;
        }
        // 苗栗縣
        case "trv.mpb.gov.tw": {
            console.log("[info]苗栗縣檢舉系統");
            countyIndicator = "苗栗縣";
            const pathURL = window.location.pathname;
            //console.log(UserData)
            console.log("[info]pathURL: " + pathURL)
            switch (pathURL) {
                case "/Home/Report": {
                    onDOMReady(function() {
                        console.log("[info]苗栗縣檢舉系統 - 自動輸入基本資料")
                        simulateTyping(document.getElementById('IdentityNumber'), UserData.UserID, 10);
                        simulateTyping(document.getElementById('Name'), UserData.UserName, 10);
                        simulateTyping(document.getElementById('Email'), UserData.UserEmail, 10);
                        simulateTyping(document.getElementById('Telphone'), UserData.UserPhone, 10);
                        simulateTyping(document.getElementById('Address'), UserData.UserAddress, 10);
                        $$$("#ViolationRemark").val("交通違規如所述");
                    });
                    enableSaferFileMenu = 1;
                    $$$(fileMenu).prependTo('body');
                    injectCSS(customCSS);

                    break;
                }
            }
            break;
        }
        // 彰化縣
        case "traffic.chpb.gov.tw": {
            console.log("[info]彰化縣檢舉系統");
            countyIndicator = "彰化縣";
            const pathURL = window.location.pathname;
            //console.log(UserData)
            console.log("[info]pathURL: " + pathURL)
            switch (pathURL) {
                case "/ViolatePetition/C005400/Form": {
                    onDOMReady(function() {
                        console.log("[info]彰化縣檢舉系統 - 自動輸入基本資料")
                        simulateTyping(document.getElementById('IdentityCard'), UserData.UserID, 10);
                        simulateTyping(document.getElementById('Name'), UserData.UserName, 10);
                        simulateTyping(document.getElementById('Mail'), UserData.UserEmail, 10);
                        simulateTyping(document.getElementById('OfficeTel'), UserData.UserPhone, 10);
                        simulateTyping(document.getElementById('Address'), UserData.UserAddress, 10);
                        $$$("#Subject").val("交通違規如下所述");
                    });
                    enableSaferFileMenu = 1;
                    $$$(fileMenu).prependTo('body');
                    injectCSS(customCSS);

                    break;
                }
            }
            break;
        }
        // 雲林縣
        case "trv.ylhpb.gov.tw": {
            console.log("[info]雲林縣檢舉系統");
            countyIndicator = "雲林縣";
            const pathURL = window.location.pathname;
            //console.log(UserData)
            console.log("[info]pathURL: " + pathURL)
            switch (pathURL) {
                case "/Home/Report": {
                    onDOMReady(function() {
                        console.log("[info]雲林縣檢舉系統 - 自動輸入基本資料")
                        simulateTyping(document.getElementById('IdentityNumber'), UserData.UserID, 10);
                        simulateTyping(document.getElementById('Name'), UserData.UserName, 10);
                        simulateTyping(document.getElementById('Email'), UserData.UserEmail, 10);
                        simulateTyping(document.getElementById('Telphone'), UserData.UserPhone, 10);
                        simulateTyping(document.getElementById('Address'), UserData.UserAddress, 10);
                        $$$("#ViolationRemark").val("交通違規如下所述");
                    });
                    enableSaferFileMenu = 1;
                    $$$(fileMenu).prependTo('body');
                    injectCSS(customCSS);

                    break;
                }
            }
            break;
        }
        // 嘉義縣
        case "www.cypd.gov.tw": {
            console.log("[info]嘉義縣檢舉系統");
            countyIndicator = "嘉義縣";
            const pathURL = window.location.pathname;
            //console.log(UserData)
            console.log("[info]pathURL: " + pathURL)
            switch (pathURL) {
                case '/TrafficMailbox/f21e7f75-04e2-082d-d2ae-1d038340ed7b': {
                    $$$("#checkRead").click()
                    $$$("#btnSubmit").click()

                    break;
                }
                case '/TrafficMailbox/Create': {
                    onDOMReady(function() {
                        console.log("[info]嘉義縣檢舉系統 - 自動輸入基本資料")
                        simulateTyping(document.getElementById('FromID'), UserData.UserID, 10);
                        simulateTyping(document.getElementById('FromName'), UserData.UserName, 10);
                        simulateTyping(document.getElementById('FromMail'), UserData.UserEmail, 10);
                        simulateTyping(document.getElementById('ContactPhone'), UserData.UserPhone, 10);
                        simulateTyping(document.getElementById('ContactAddress'), UserData.UserAddress, 10);
                        $$$("#Memo").val("交通違規如所述");
                        $$$("#checkRead").click();
                    });
                    enableSaferFileMenu = 1;
                    $$$(fileMenu).prependTo('body');
                    injectCSS(customCSS);

                    break;
                }
            }
            break;
        }
        // 宜蘭縣
        case "ppl.report.ilcpb.gov.tw": {
            console.log("[info]宜蘭縣檢舉系統");
            countyIndicator = "宜蘭縣";
            const pathURL = window.location.pathname;
            //console.log(UserData)
            console.log("[info]pathURL: " + pathURL)
            switch (pathURL) {
                case '/index.php': {
                    onDOMReady(function() {
                        if( $$$("#name").length > 0 ){
                            console.log("[info]宜蘭縣檢舉系統 - 自動輸入基本資料")
                            simulateTyping(document.getElementById('idcard'), UserData.UserID, 10);
                            simulateTyping(document.getElementById('name'), UserData.UserName, 10);
                            simulateTyping(document.getElementById('email'), UserData.UserEmail, 10);
                            simulateTyping(document.getElementById('tel'), UserData.UserPhone, 10);
                            simulateTyping(document.getElementById('address2'), UserData.UserAddress, 10);
                            $$$("#content22").val("交通違規如所述");
                        }
                        
                    });
                    if( $$$("#name").length > 0 ){
                        enableSaferFileMenu = 1;
                        $$$(fileMenu).prependTo('body');
                        injectCSS(customCSS);
                    }

                    break;
                }
            }
            break;
        }
        // 花蓮縣
        case "hlpb.twgov.mobi": {
            console.log("[info]花蓮縣檢舉系統");
            countyIndicator = "花蓮縣";
            const pathURL = window.location.pathname;
            //console.log(UserData)
            console.log("[info]pathURL: " + pathURL)
            switch (pathURL) {
                case '/order/iframviolation_list.php': {
                    onDOMReady(function() {
                        console.log("[info]花蓮縣檢舉系統 - 自動輸入基本資料")
                        simulateTyping(document.querySelectorAll('input[name="20191113095654"]')[0], UserData.UserID);
                        simulateTyping(document.querySelectorAll('input[name="name"]')[0], UserData.UserName);
                        simulateTyping(document.querySelectorAll('input[name="email"]')[0], UserData.UserEmail);
                        simulateTyping(document.querySelectorAll('input[name="mobile"]')[0], UserData.UserPhone);
                        simulateTyping(document.querySelectorAll('input[name="address"]')[0], UserData.UserAddress);
                        //$$$("#content22").val("交通違規如所述");
                    });
                    enableSaferFileMenu = 1;
                    $$$(fileMenu).prependTo('body');
                    injectCSS(customCSS);
                

                    break;
                }
            }
            break;
        }
        // 基隆市
        case "tptv.klg.gov.tw": {
            console.log("[info]基隆市檢舉系統");
            countyIndicator = "基隆市";
            const pathURL = window.location.pathname;
            //console.log(UserData)
            console.log("[info]pathURL: " + pathURL)
            switch (pathURL) {
                case '/reportcase/index.aspx': {
                    onDOMReady(function() {
                        $$$("#CheckBox1").click();
                        $$$("#Button2").click();
                        //$$$("#content22").val("交通違規如所述");
                    });

                    break;
                }
                case '/reportcase/ReportIndex.aspx': {
                    onDOMReady(function() {
                        console.log("[info]基隆市檢舉系統 - 自動輸入基本資料")
                        simulateTyping(document.querySelectorAll('input[name="ReportCreditID"]')[0], UserData.UserID);
                        simulateTyping(document.querySelectorAll('input[name="ReportName"]')[0], UserData.UserName);
                        simulateTyping(document.querySelectorAll('input[name="ReportEmail"]')[0], UserData.UserEmail);
                        simulateTyping(document.querySelectorAll('input[name="ReportMobile"]')[0], UserData.UserPhone);
                        simulateTyping(document.querySelectorAll('input[name="ReportAddress"]')[0], UserData.UserAddress);
                    });
                    enableSaferFileMenu = 1;
                    $$$(fileMenu).prependTo('body');
                    injectCSS(customCSS);
                

                    break;
                }
            }
            break;
        }
        // 新竹市
        case "tra2.hccp.gov.tw": {
            console.log("[info]新竹市檢舉系統");
            countyIndicator = "新竹市";
            const pathURL = window.location.pathname;
            //console.log(UserData)
            console.log("[info]pathURL: " + pathURL)
            switch (pathURL) {
                case '/new/': {
                    onDOMReady(function() {
                        $$$("#agree").click();
                        $$$("input[type=submit]").click();
                        //$$$("#content22").val("交通違規如所述");
                    });

                    break;
                }
                case '/new/new.php': {
                    onDOMReady(function() {
                        console.log("[info]新竹市檢舉系統 - 自動輸入基本資料")
                        simulateTyping(document.getElementById('case_id_number'), UserData.UserID);
                        simulateTyping(document.getElementById('case_name'), UserData.UserName);
                        simulateTyping(document.getElementById('case_email'), UserData.UserEmail);
                        simulateTyping(document.getElementById('case_phone'), UserData.UserPhone);
                        simulateTyping(document.getElementById('case_contact_address'), UserData.UserAddress);
                    });
                    enableSaferFileMenu = 1;
                    $$$(fileMenu).prependTo('body');
                    injectCSS(customCSS);
                

                    break;
                }
            }
            break;
        }
        // 新竹縣
        case "traffic.hchpb.gov.tw": {
            console.log("[info]新竹縣檢舉系統");
            countyIndicator = "新竹縣";
            const pathURL = window.location.pathname;
            //console.log(UserData)
            console.log("[info]pathURL: " + pathURL)
            switch (pathURL) {
                case '/10/13': {
                    onDOMReady(function() {
                        $$$("input[type=checkbox]").click();
                        $$$("button[type=submit]").click();
                        //$$$("#content22").val("交通違規如所述");
                    });

                    break;
                }
                case '/ReportStep2.aspx': {
                    onDOMReady(function() {
                        console.log("[info]新竹縣檢舉系統 - 自動輸入基本資料");
                        $$$("#MainContent_txtIdNumber").val(UserData.UserID);
                        simulateTyping(document.getElementById('MainContent_txtName'), UserData.UserName);
                        simulateTyping(document.getElementById('MainContent_txtEmail'), UserData.UserEmail);
                        simulateTyping(document.getElementById('MainContent_txtPhone'), UserData.UserPhone);
                        simulateTyping(document.getElementById('MainContent_txtFloor'), UserData.UserAddress);
                    });
                    enableSaferFileMenu = 1;
                    $$$(fileMenu).prependTo('body');
                    injectCSS(customCSS);
                

                    break;
                }
                case '/ReportStep3.aspx': {

                    enableSaferFileMenu = 1;
                    $$$(fileMenu).prependTo('body');
                    injectCSS(customCSS);
                
                    break;
                }
            }
            break;
        }
        // 屏東縣
        case "trafficmailbox.ptpolice.gov.tw": {
            console.log("[info]屏東縣檢舉系統");
            countyIndicator = "屏東縣";
            const pathURL = window.location.pathname;
            //console.log(UserData)
            console.log("[info]pathURL: " + pathURL)
            switch (pathURL) {
                case '/': {
                    onDOMReady(function() {
                        $$$("#OK").click();
                        window.location.href = "traffic_write.jsp";
                        //$$$("#content22").val("交通違規如所述");
                    });

                    break;
                }
                case '/traffic_write.jsp': {
                    onDOMReady(function() {
                        console.log("[info]屏東縣檢舉系統 - 自動輸入基本資料")
                        simulateTyping(document.getElementById('sub'), UserData.UserID);
                        simulateTyping(document.getElementById('name'), UserData.UserName);
                        simulateTyping(document.getElementById('email'), UserData.UserEmail);
                        simulateTyping(document.getElementById('liaisontel'), UserData.UserPhone);
                        simulateTyping(document.getElementById('address'), UserData.UserAddress);
                    });
                    enableSaferFileMenu = 1;
                    $$$(fileMenu).prependTo('body');
                    injectCSS(customCSS);
                

                    break;
                }
            }
            break;
        }
        // 嘉義市
        case "trn.ccpb.gov.tw": {
            console.log("[info]嘉義市檢舉系統");
            countyIndicator = "嘉義市";
            const pathURL = window.location.pathname;
            //console.log(UserData)
            console.log("[info]pathURL: " + pathURL)
            switch (pathURL) {
                case '/user-login/2/6': {
                    onDOMReady(function() {
                        console.log("[info]嘉義市檢舉系統 - 自動輸入基本資料");
                        //$$$("input[type=email]").val(UserData.UserEmail);
                    });
                    enableSaferFileMenu = 1;
                    $$$(fileMenu).prependTo('body');
                    injectCSS(customCSS);

                    break;
                }
                case '/application-data-form': {
                    onDOMReady(function() {
                        console.log("[info]嘉義市檢舉系統 - 自動輸入基本資料");
                        //$$$("input[type=email]").val(UserData.UserEmail);
                    });
                    enableSaferFileMenu = 1;
                    $$$(fileMenu).prependTo('body');
                    injectCSS(customCSS);

                    break;
                }
            }
            break;
        }
        // 台東縣
        case "www.ttcpb.gov.tw": {
            console.log("[info]台東縣檢舉系統");
            countyIndicator = "台東縣";
            const pathURL = window.location.pathname;
            //console.log(UserData)
            console.log("[info]pathURL: " + pathURL)
            switch (pathURL) {
                case '/chinese/home.jsp': {
                    onDOMReady(function() {
                        console.log("[info]台東縣檢舉系統 - 自動輸入基本資料");
                        simulateTyping(document.getElementById('pid'), UserData.UserID);
                        simulateTyping(document.getElementById('name'), UserData.UserName);
                        simulateTyping(document.getElementById('email'), UserData.UserEmail);
                        simulateTyping(document.getElementById('tel'), UserData.UserPhone);
                        simulateTyping(document.getElementById('address'), UserData.UserAddress);
                        
                    });
                    enableSaferFileMenu = 1;
                    $$$(fileMenu).prependTo('body');
                    injectCSS(customCSS);

                    break;
                }
            }
            break;
        }
        // 澎湖縣
        case "www.phpb.gov.tw": {
            console.log("[info]澎湖縣檢舉系統");
            countyIndicator = "澎湖縣";
            const pathURL = window.location.pathname;
            //console.log(UserData)
            console.log("[info]pathURL: " + pathURL)
            switch (pathURL) {
                case '/home.jsp': {
                    onDOMReady(function() {
                        console.log("[info]澎湖縣檢舉系統 - 自動輸入基本資料");
                        simulateTyping(document.getElementById('pid'), UserData.UserID);
                        simulateTyping(document.getElementById('name'), UserData.UserName);
                        simulateTyping(document.getElementById('email'), UserData.UserEmail);
                        simulateTyping(document.getElementById('tel'), UserData.UserPhone);
                        simulateTyping(document.getElementById('address'), UserData.UserAddress);
                        
                    });
                    enableSaferFileMenu = 1;
                    $$$(fileMenu).prependTo('body');
                    injectCSS(customCSS);

                    break;
                }
            }
            break;
        }
        // 南投縣
        case "jiaowei.ncpd.gov.tw": {
            console.log("[info]南投縣檢舉系統");
            countyIndicator = "南投縣";
            const pathURL = window.location.pathname;
            //console.log(UserData)
            console.log("[info]pathURL: " + pathURL)
            switch (pathURL) {
                case '/sc11/rwd/rincase3.aspx': {
                    onDOMReady(function() {
                        console.log("[info]南投縣檢舉系統 - 自動輸入基本資料");
                        simulateTyping(document.getElementById('mpid'), UserData.UserID);
                        simulateTyping(document.getElementById('mname'), UserData.UserName);
                        simulateTyping(document.getElementById('memail'), UserData.UserEmail);
                        simulateTyping(document.getElementById('mtel'), UserData.UserPhone);
                        simulateTyping(document.getElementById('maddr'), UserData.UserAddress);
                        
                    });
                    enableSaferFileMenu = 1;
                    $$$(fileMenu).prependTo('body');
                    injectCSS(customCSS);

                    break;
                }
            }
            break;
        }
        // 國道公路警察局
        case "wos.hpb.gov.tw": {
            console.log("[info]國道公路警察局檢舉系統");
            countyIndicator = "國道公路警察局";
            const pathURL = window.location.pathname;
            //console.log(UserData)
            console.log("[info]pathURL: " + pathURL)
            switch (pathURL) {
                case '/RV': {
                    onDOMReady(function() {
                        $$$("#chkAgree").click();
                        window.location.href = "/RV/Create";
                    });

                    break;
                }
                case '/RV/Create': {
                    onDOMReady(function() {
                        console.log("[info]國道公路警察局檢舉系統 - 自動輸入基本資料");
                        simulateTyping(document.getElementById('ApplicantIDNo'), UserData.UserID);
                        simulateTyping(document.getElementById('ApplicantName'), UserData.UserName);
                        simulateTyping(document.getElementById('ApplicantEMail'), UserData.UserEmail);
                        simulateTyping(document.getElementById('ApplicantTel'), UserData.UserPhone);
                        $$$("#step1 > div > div:nth-child(3) > div:nth-child(1) > label").text(UserData.UserAddress);
                        
                    });
                    //enableSaferFileMenu = 1;
                    //$$$(fileMenu).prependTo('body');
                    //injectCSS(customCSS);

                    break;
                }
            }
            break;
        }

    }

    // 顯示選單
    if(enableSaferFileMenu == 1){
        console.log("[info]載入同步側窗")
        // DOM 元素
        const closeSidebarBtn = document.getElementById('safertw_closeSidebar');
        const sidebar = document.getElementById('safertw_sidebar');
        const sidebarIndicator = document.getElementById('safertw_sidebarIndicator');
        const codeInput = document.getElementById('safertw_codeInput');
        const receiveBtn = document.getElementById('safertw_receiveBtn');
        const testDownloadBtn = document.getElementById('safertw_testDownload');
        statusIndicator = document.getElementById('safertw_statusIndicator');
        //
        const unzipexpressbtn = document.getElementById('safertw_unzipexpress');

        $$$("#safertw_toggle_unzip_manual").click(function(){
            $$$(".safertw_file-upload-container").slideToggle();
        });

        //test Download function
        function downloadFileTest() {
            let blob = new Blob(recvBuffer);
            //extractZip(blob);
            let url = URL.createObjectURL(blob);
            let a = document.createElement('a');
            a.href = url; a.download = fileMeta.name;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        // 開啟側邊欄
        function openSidebar() {
            sidebar.classList.add('safertw_open');
            sidebarIndicator.classList.add('safertw_hidden');
            
            // 自動聚焦到輸入框
            setTimeout(() => {
                codeInput.focus();
            }, 300);
        }

        // 關閉側邊欄
        function closeSidebar() {
            sidebar.classList.remove('safertw_open');
            sidebarIndicator.classList.remove('safertw_hidden');
        }

        // 事件監聽器
        closeSidebarBtn.addEventListener('click', closeSidebar);
        testDownloadBtn.addEventListener('click', downloadFileTest);
        unzipexpressbtn.addEventListener('click', extractZipExpress);
        sidebarIndicator.addEventListener('click', openSidebar);

        // 選取 ZIP 檔案後自動觸發解壓縮
        document.getElementById('safertw_zipFile').addEventListener('change', function() {
            if (this.files[0]) {
                unzipexpressbtn.click();
            }
        });

        // 代碼輸入驗證
        codeInput.addEventListener('input', function(e) {
            // 只允許數字
            e.target.value = e.target.value.replace(/[^0-9]/g, '');
            const code = e.target.value;
            
            if (code.length === 0) {
                updateStatus('waiting', '等待輸入代碼...');
                receiveBtn.disabled = true;
            } else if (code.length < 7) {
                updateStatus('waiting', `請輸入完整的7位數字`);
                receiveBtn.disabled = true;
            } else if (code.length === 7) {
                updateStatus('success', '格式正確，可以接收檔案');
                receiveBtn.disabled = false;
            }
        });

        // 接收檔案按鈕
        receiveBtn.addEventListener('click', function() {
            const code = codeInput.value;
            
            if (code.length !== 7) {
                updateStatus('error', '請輸入7位數字代碼');
                return;
            }

            saferTW_webRTCanswer(code);
            
            // 模擬接收檔案過程
            updateStatus('waiting', '等待傳送端開始發送...');
            receiveBtn.disabled = true;
            
        });

        // 更新狀態指示器
        function updateStatus(type, message) {
            statusIndicator.className = `safertw_status-indicator safertw_status-${type}`;
            statusIndicator.textContent = message;
        }

        // 右側指示器動畫
        let indicatorAnimation;
        function animateIndicator() {
            const dots = document.querySelectorAll('.safertw_indicator-dot');
            let currentDot = 0;
            
            indicatorAnimation = setInterval(() => {
                dots.forEach(dot => dot.classList.remove('safertw_active'));
                dots[currentDot].classList.add('safertw_active');
                currentDot = (currentDot + 1) % dots.length;
            }, 800);
        }

        // 停止指示器動畫
        function stopIndicatorAnimation() {
            if (indicatorAnimation) {
                clearInterval(indicatorAnimation);
                document.querySelectorAll('.safertw_indicator-dot').forEach(dot => 
                    dot.classList.remove('safertw_active')
                );
            }
        }

        // 頁面載入時開始動畫
        animateIndicator();
        //openSidebar();

        // 側邊欄開啟時停止動畫
        sidebar.addEventListener('transitionend', function() {
            if (sidebar.classList.contains('safertw_open')) {
                stopIndicatorAnimation();
            } else {
                animateIndicator();
            }
        });
    }

};