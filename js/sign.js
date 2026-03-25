let targetFileId = "", targetFileName = "";
const user = getCurrentUser();

window.onload = () => {
  if (!user.userName) { window.location.href = "index.html"; return; }
  loadFiles();
};

async function loadFiles() {
  const listDiv = document.getElementById('fileList');
  listDiv.innerHTML = "載入中...";
  
  const files = await callApi('getFileList', { userName: user.userName, deptName: user.deptName });
  
  listDiv.innerHTML = "";
  
  // 【新增防呆機制】如果後端回傳錯誤訊息 (success為false)，就把錯誤印出來
  if (files && files.success === false) {
    listDiv.innerHTML = `<p style="color:red; text-align:center;">讀取失敗：${files.message}</p>`;
    return;
  }

  // 確保 files 是陣列且有資料
  if (!Array.isArray(files) || files.length === 0) { 
    listDiv.innerHTML = "<p style='text-align:center;'>無檔案</p>"; 
    return; 
  }
  
  files.forEach(f => {
    const safeName = f.name.replace(/'/g, "\\'");
    let btnHtml = f.isSigned ? 
      `<button class="btn-read done">✔ 已簽核</button>` : 
      `<button class="btn-read" onclick="openModal('${safeName}', '${f.id}')">確認已讀</button>`;
    
    const div = document.createElement('div');
    div.className = 'file-card';
    div.innerHTML = `<span class="file-name" onclick="previewFile('${f.id}', '${safeName}')">📄 ${f.name}</span> ${btnHtml}`;
    listDiv.appendChild(div);
  });
}

async function previewFile(id, name) {
  document.getElementById('previewSection').classList.remove('hidden');
  document.getElementById('previewNameTarget').innerText = name;
  const container = document.getElementById('pdfContainer');
  container.innerHTML = "<div class='loading-spinner'>📥 下載文件並繪製浮水印中...</div>";
  
  const res = await callApi('getFileBase64', { fileId: id });
  
  if(res.success) {
    const pdfData = atob(res.data);
    pdfjsLib.getDocument({data: pdfData}).promise.then(pdf => {
      container.innerHTML = "";
      for(let p=1; p<=pdf.numPages; p++) {
        pdf.getPage(p).then(page => {
          const viewport = page.getViewport({scale:1.5});
          const canvas = document.createElement('canvas');
          canvas.className = 'pdf-page-canvas';
          canvas.width = viewport.width; canvas.height = viewport.height;
          canvas.style.width = "100%"; canvas.style.height = "auto";
          container.appendChild(canvas);
          const ctx = canvas.getContext('2d');
          page.render({canvasContext: ctx, viewport: viewport}).promise.then(() => {
            drawWatermark(ctx, canvas.width, canvas.height);
          });
        });
      }
    });
  } else { container.innerHTML = "讀取失敗"; }
}

function drawWatermark(ctx, width, height) {
  const dateStr = new Date().toLocaleDateString('zh-TW', {month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'}).replace(/\//g, '/');
  const text = `${user.userName} ${dateStr}`;
  ctx.save();
  ctx.font = "bold 40px 'Microsoft JhengHei'";
  ctx.fillStyle = "rgba(255, 0, 0, 0.2)";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.rotate(-45 * Math.PI / 180);
  const stepX = 600, stepY = 400; 
  for (let x = -width * 2; x < width * 2; x += stepX) {
    for (let y = -height * 2; y < height * 2; y += stepY) {
      ctx.fillText(text, x, y);
    }
  }
  ctx.restore();
}

function openModal(name, id) {
  targetFileName = name; targetFileId = id;
  document.getElementById('modalMessage').innerText = "您確定要簽核: " + name + " ?";
  document.getElementById('confirmModal').classList.remove('hidden');
}

function closeModal() { document.getElementById('confirmModal').classList.add('hidden'); }

async function executeSign() {
  closeModal();
  const res = await callApi('markAsRead', { userName: user.userName, fileName: targetFileName, deptName: user.deptName });
  alert("簽核請求已送出");
  loadFiles();
}
