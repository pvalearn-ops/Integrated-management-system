// js/camera.js

const user = getCurrentUser(); 
let currentName = "";
let gasUrl = 'https://script.google.com/macros/s/AKfycbylNtiXUPuOEo8DqIF6sFf-66Kj0xQ0BJzzN5M9zD6NjIDEpo0cpLr0dLSyLGpzPv9vlg/exec';
let currentPosition = null;
let watchId = null;
let currentFacingMode = 'environment';
let isRecording = false;
let mediaRecorder = null;
let recordedChunks = [];
let animationFrameId = null;

// 新增：紀錄當前螢幕方向
let lastOrientation = window.innerHeight > window.innerWidth ? 'portrait' : 'landscape';

window.onload = () => {
    if (!user.userName) { window.location.href = "index.html"; return; }
    currentName = user.userName;
    document.getElementById('display-name').textContent = currentName;
    initSystem();
    bindEvents();
};

function bindEvents() {
    const viewFilesBtn = document.getElementById('view-files-btn');
    const filesModal = document.getElementById('files-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const filesListContainer = document.getElementById('files-list-container');
    const previewModal = document.getElementById('preview-modal');
    const closePreviewBtn = document.getElementById('close-preview-btn');
    const previewContainer = document.getElementById('preview-container');
    const switchCameraBtn = document.getElementById('switch-camera-btn');
    const photoBtn = document.getElementById('photo-btn');
    const recordStartBtn = document.getElementById('record-start-btn');
    const recordStopBtn = document.getElementById('record-stop-btn');
    const unqualifiedCheck = document.getElementById('unqualified-check');
    const businessNameContainer = document.getElementById('business-name-container');
    const businessNameInput = document.getElementById('business-name');

    // 🔥 新增：監聽手機螢幕旋轉 (防變形對策)
    window.addEventListener('resize', () => {
        const currentOrientation = window.innerHeight > window.innerWidth ? 'portrait' : 'landscape';
        // 只有在方向真的改變，且沒有在錄影時，才重啟相機
        if (currentOrientation !== lastOrientation && !isRecording) {
            lastOrientation = currentOrientation;
            // 稍微等待 300 毫秒，讓手機瀏覽器完成排版旋轉後再重啟相機
            setTimeout(() => {
                startCamera();
            }, 300);
        }
    });

    viewFilesBtn.addEventListener('click', async () => {
        filesModal.classList.remove('hidden');
        filesListContainer.innerHTML = '<div class="text-center text-gray-500 my-8">載入中...</div>';
        try {
            const res = await fetch(gasUrl, {
                method: 'POST',
                body: JSON.stringify({ type: 'list_files', name: currentName }),
                headers: { 'Content-Type': 'text/plain;charset=utf-8' }
            });
            const result = await res.json();
            if(!result.success) throw new Error(result.error);
            
            if (!result.files || (result.files.photo.length === 0 && result.files.video.length === 0 && result.files.unqual.length === 0)) {
                filesListContainer.innerHTML = '<div class="text-center text-gray-500 my-8">尚無任何歷史檔案</div>';
            } else {
                const renderSection = (title, items, icon) => {
                    if (!items || items.length === 0) return '';
                    const listHtml = items.map(f => {
                        const date = new Date(f.dateCreated).toLocaleString();
                        return `<button data-fileid="${f.fileId}" data-mime="${f.mimeType}" class="preview-item-btn w-full text-left block bg-white hover:bg-blue-50 border p-3 rounded-lg mb-2 shadow-sm transition cursor-pointer">
                            <div class="flex items-center pointer-events-none">
                              <span class="text-3xl mr-4">${icon}</span>
                              <div><div class="font-bold text-blue-700 break-all pointer-events-auto">${f.name}</div><div class="text-xs text-gray-500 mt-1">建立時間: ${date}</div></div>
                            </div></button>`;
                    }).join('');
                    return `<div class="mb-6"><div class="font-bold text-gray-800 bg-gray-200 px-3 py-2 rounded mb-3 flex items-center"><span class="mr-2">${icon}</span> ${title}</div>${listHtml}</div>`;
                };
                filesListContainer.innerHTML = renderSection('照片紀錄 (最近 10 筆)', result.files.photo, '📸') + renderSection('正常錄影紀錄 (最近 10 筆)', result.files.video, '🎥') + renderSection('不合格錄影紀錄 (最近 10 筆)', result.files.unqual, '⚠️');
            }
        } catch (e) { filesListContainer.innerHTML = `<div class="text-center text-red-500 my-8">存檔紀錄讀取失敗: ${e.message}</div>`; }
    });

    closeModalBtn.addEventListener('click', () => filesModal.classList.add('hidden'));

    unqualifiedCheck.addEventListener('change', (e) => {
        if (e.target.checked) { businessNameContainer.classList.remove('hidden'); } 
        else { businessNameContainer.classList.add('hidden'); businessNameInput.value = ''; }
    });

    switchCameraBtn.addEventListener('click', async () => {
        if (isRecording) { alert('錄影中無法切換鏡頭'); return; }
        currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
        await startCamera();
    });

    photoBtn.addEventListener('click', async () => {
        const cameraVideo = document.getElementById('camera-video');
        cameraVideo.pause(); // 凍結畫面
        showLoading('📸 拍照並上傳中...');
        try {
            const captureCanvas = document.getElementById('capture-canvas');
            const captureCtx = captureCanvas.getContext('2d');
            drawVideoWithTimestamp(captureCtx, captureCanvas.width, captureCanvas.height);
            let dataUrl = captureCanvas.toDataURL('image/jpeg', 0.85);
            if (currentPosition) dataUrl = addExifGPS(dataUrl, currentPosition.latitude, currentPosition.longitude);

            const dateObj = getFilenameDateStr();
            const filename = `${dateObj.fileDate}.jpg`;

            await uploadToGas({ type: 'photo', name: currentName, year: dateObj.year, month: dateObj.month, filename: filename, mimeType: 'image/jpeg', data: dataUrl });
            alert('✅ 照片上傳成功！\n檔名: ' + filename);
        } catch (e) { alert('❌ 照片上傳失敗: \n' + e.message); } 
        finally { hideLoading(); cameraVideo.play(); /* 恢復播放 */ }
    });

    recordStartBtn.addEventListener('click', () => {
        if (unqualifiedCheck.checked && !businessNameInput.value.trim()) { alert('不合格錄影請務必輸入「事業單位名稱」'); return; }
        try {
            const recordCanvas = document.getElementById('record-canvas');
            const cameraVideo = document.getElementById('camera-video');
            const canvasStream = recordCanvas.captureStream(30);
            if (cameraVideo.srcObject && cameraVideo.srcObject.getAudioTracks().length > 0) { canvasStream.addTrack(cameraVideo.srcObject.getAudioTracks()[0]); }

            mediaRecorder = new MediaRecorder(canvasStream, { mimeType: 'video/webm; codecs=vp9' });
            recordedChunks = [];
            mediaRecorder.ondataavailable = (event) => { if (event.data.size > 0) recordedChunks.push(event.data); };
            mediaRecorder.onstop = uploadVideo;
            mediaRecorder.start();
            isRecording = true;

            recordStartBtn.classList.add('hidden'); recordStopBtn.classList.remove('hidden'); recordStopBtn.classList.add('flex');
            photoBtn.classList.add('hidden'); photoBtn.classList.remove('flex');
            document.getElementById('video-timestamp').classList.add('text-red-500');
        } catch (e) { console.error(e); alert('無法啟動錄影: ' + e.message); }
    });

    recordStopBtn.addEventListener('click', () => {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            document.getElementById('camera-video').pause(); // 結束時凍結在最後一幀
            mediaRecorder.stop();
            isRecording = false;
            recordStartBtn.classList.remove('hidden'); recordStartBtn.classList.add('flex');
            recordStopBtn.classList.add('hidden');
            photoBtn.classList.remove('hidden'); photoBtn.classList.add('flex');
            document.getElementById('video-timestamp').classList.remove('text-red-500');
        }
    });

    document.addEventListener('click', async (e) => {
        const btn = e.target.closest('.preview-item-btn');
        if (!btn) return;
        const fileId = btn.getAttribute('data-fileid');
        const mimeType = btn.getAttribute('data-mime');

        showLoading('⏬ 檔案安全存取中，可能需數秒至數十秒...');
        try {
            const res = await fetch(gasUrl, { method: 'POST', body: JSON.stringify({ type: 'get_file_data', fileId: fileId }), headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
            const result = await res.json();
            if(!result.success) throw new Error(result.error);
            
            const b64Url = `data:${result.mimeType};base64,${result.base64}`;
            const fetchRes = await fetch(b64Url);
            const blob = await fetchRes.blob();
            const objectUrl = URL.createObjectURL(blob);

            previewContainer.innerHTML = '';
            if (mimeType.startsWith('image/')) { previewContainer.innerHTML = `<img src="${objectUrl}" class="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl">`; } 
            else if (mimeType.startsWith('video/')) { previewContainer.innerHTML = `<video src="${objectUrl}" controls autoplay playsinline class="max-w-full max-h-[80vh] rounded-lg shadow-2xl"></video>`; } 
            else { previewContainer.innerHTML = `<div class="text-white">無法預覽此檔案類型</div>`; }
            previewModal.classList.remove('hidden');
        } catch(err) { alert('無法載入預覽: ' + err.message); } finally { hideLoading(); }
    });

    if (closePreviewBtn) {
        closePreviewBtn.addEventListener('click', () => {
            const mediaTag = previewContainer.querySelector('video, img');
            if(mediaTag && mediaTag.src.startsWith('blob:')) URL.revokeObjectURL(mediaTag.src);
            previewContainer.innerHTML = '';
            previewModal.classList.add('hidden');
        });
    }
}

function showLoading(text) { document.getElementById('loading-text').textContent = text; document.getElementById('loading-overlay').style.display = 'flex'; }
function hideLoading() { document.getElementById('loading-overlay').style.display = 'none'; }
function getFormattedTimestampDate() {
    const now = new Date(); const yy = now.getFullYear(); const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0'); const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0'); const s = String(now.getSeconds()).padStart(2, '0');
    return `${yy}/${mm}/${dd} ${h}:${m}:${s}`; 
}
function getFilenameDateStr() {
    const now = new Date(); const yy = now.getFullYear(); const mm = String(now.getMonth() + 1).padStart(2, '0');
    return Object.freeze({ year: yy.toString(), month: mm.toString(), fileDate: `${yy}${mm}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}` });
}
function degToDmsRational(deg) {
    const m = Math.abs(deg); const degrees = Math.floor(m); const minutes = Math.floor((m - degrees) * 60);
    return [[degrees, 1], [minutes, 1], [Math.round((m - degrees - minutes / 60) * 3600 * 1000), 1000]];
}
function addExifGPS(base64Image, lat, lng) {
    if (typeof piexif === 'undefined') return base64Image;
    try {
        const gpsIfd = {};
        gpsIfd[piexif.GPSIFD.GPSLatitudeRef] = lat >= 0 ? "N" : "S"; gpsIfd[piexif.GPSIFD.GPSLatitude] = degToDmsRational(lat);
        gpsIfd[piexif.GPSIFD.GPSLongitudeRef] = lng >= 0 ? "E" : "W"; gpsIfd[piexif.GPSIFD.GPSLongitude] = degToDmsRational(lng);
        return piexif.insert(piexif.dump({ "0th": {}, "Exif": {}, "GPS": gpsIfd }), base64Image);
    } catch (e) { return base64Image; }
}
function blobToBase64(blob) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onloadend = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); }); }
async function uploadToGas(payload) {
    const res = await fetch(gasUrl, { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
    const result = await res.json();
    if (!result.success) throw new Error(result.error || '上傳失敗');
    return result;
}

async function initSystem() {
    if (navigator.geolocation) {
        watchId = navigator.geolocation.watchPosition((position) => {
            currentPosition = position.coords;
            document.getElementById('gps-status').innerHTML = `<span class="text-green-500 font-bold">● 成功定位</span>`;
            document.getElementById('gps-coords').textContent = `緯度: ${currentPosition.latitude.toFixed(6)}, 經度: ${currentPosition.longitude.toFixed(6)}`;
        }, (error) => {
            document.getElementById('gps-status').innerHTML = `<span class="text-red-500 font-bold">● 定位失敗</span>`;
            document.getElementById('gps-coords').textContent = `錯誤碼: ${error.code}`;
        }, { enableHighAccuracy: true });
    } else { document.getElementById('gps-status').innerHTML = `<span class="text-red-500 font-bold">● 不支援定位</span>`; }
    await startCamera();
}

async function startCamera() {
    const cameraVideo = document.getElementById('camera-video');
    
    // 完全停止並清除目前的攝影機軌道
    if (cameraVideo.srcObject) {
        cameraVideo.srcObject.getTracks().forEach(track => track.stop());
        cameraVideo.srcObject = null; 
    }
    
    try {
        // 給手機硬體一點點時間切換
        await new Promise(resolve => setTimeout(resolve, 200));

        // 🔥 動態判斷當前是直式還是橫式，向手機硬體請求正確的長寬比
        const isPortrait = window.innerHeight > window.innerWidth;
        const idealWidth = isPortrait ? 720 : 1280;
        const idealHeight = isPortrait ? 1280 : 720;

        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                facingMode: currentFacingMode, 
                width: { ideal: idealWidth }, 
                height: { ideal: idealHeight } 
            }, 
            audio: true 
        });
        
        cameraVideo.srcObject = stream;
        
        cameraVideo.onloadedmetadata = () => {
            // 動態將視訊真實長寬同步給 Canvas
            const updateCanvasSize = () => {
                if (!isRecording) {
                    document.getElementById('record-canvas').width = cameraVideo.videoWidth;
                    document.getElementById('record-canvas').height = cameraVideo.videoHeight;
                    document.getElementById('capture-canvas').width = cameraVideo.videoWidth;
                    document.getElementById('capture-canvas').height = cameraVideo.videoHeight;
                }
            };
            updateCanvasSize();
            
            // 強制呼叫 play()
            cameraVideo.play().catch(e => console.warn('播放失敗:', e));
            
            if (!animationFrameId) startCanvasRenderLoop();
        };
    } catch (err) { alert('無法開啟攝影機：' + err.message); }
}

function drawVideoWithTimestamp(ctx, width, height) {
    // 拍照當下確保長寬抓取到最新真實解析度
    if (ctx.canvas.id === 'capture-canvas') {
        const cv = document.getElementById('camera-video');
        ctx.canvas.width = cv.videoWidth; ctx.canvas.height = cv.videoHeight;
        width = cv.videoWidth; height = cv.videoHeight;
    }

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(document.getElementById('camera-video'), 0, 0, width, height);
    
    const timestamp = getFormattedTimestampDate();
    const fontSize = Math.floor(Math.min(width, height) * 0.035); 
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.fillStyle = "white"; ctx.textAlign = "right"; ctx.textBaseline = "bottom";
    ctx.lineWidth = Math.max(1, Math.floor(fontSize / 15)); ctx.strokeStyle = "black";
    const padding = Math.floor(Math.min(width, height) * 0.02);
    
    ctx.strokeText(timestamp, width - padding, height - padding); 
    ctx.fillText(timestamp, width - padding, height - padding);
    return timestamp;
}

function startCanvasRenderLoop() {
    function render() {
        const cameraVideo = document.getElementById('camera-video');
        if (cameraVideo.readyState === cameraVideo.HAVE_ENOUGH_DATA) {
            if (isRecording) {
                const recordCanvas = document.getElementById('record-canvas');
                drawVideoWithTimestamp(recordCanvas.getContext('2d'), recordCanvas.width, recordCanvas.height);
            }
            document.getElementById('video-timestamp').textContent = getFormattedTimestampDate();
        }
        animationFrameId = requestAnimationFrame(render);
    }
    render();
}

async function uploadVideo() {
    showLoading('🎥 影片處理與上傳中，請稍候...');
    try {
        const base64Data = await blobToBase64(new Blob(recordedChunks, { type: 'video/webm' }));
        const dateObj = getFilenameDateStr();
        const isUnqualified = document.getElementById('unqualified-check').checked;
        const bName = document.getElementById('business-name').value.trim();

        let type = isUnqualified ? 'unqualified_video' : 'video';
        let filename = isUnqualified ? `${dateObj.fileDate}_${bName}.mp4` : `${dateObj.fileDate}.mp4`;

        await uploadToGas({ type: type, name: currentName, bizName: bName, year: dateObj.year, month: dateObj.month, filename: filename, mimeType: 'video/mp4', data: base64Data });
        alert('✅ 影片上傳成功！\n檔名: ' + filename);
    } catch (e) { alert('❌ 影片上傳失敗: \n' + e.message); } 
    finally {
        hideLoading();
        document.getElementById('camera-video').play(); // 恢復播放
        document.getElementById('unqualified-check').checked = false;
        document.getElementById('business-name-container').classList.add('hidden');
        document.getElementById('business-name').value = '';
    }
}
