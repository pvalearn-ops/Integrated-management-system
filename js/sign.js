let targetFileId = "", targetFileName = "";
let pdfRenderObserver = null;
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

  // 【防呆機制】如果後端回傳錯誤訊息 (success為false)，就把錯誤印出來
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
    const div = document.createElement('div');
    div.className = 'file-card';

    // 以 DOM API 綁事件，避免檔名含引號時把 onclick 字串弄壞
    const nameSpan = document.createElement('span');
    nameSpan.className = 'file-name';
    nameSpan.textContent = `📄 ${f.name}`;
    nameSpan.addEventListener('click', () => previewFile(f.id, f.name));

    const btn = document.createElement('button');
    btn.dataset.signId = f.id;
    if (f.isSigned) {
      markButtonSigned(btn);
    } else {
      btn.className = 'btn-read';
      btn.textContent = '確認已讀';
      btn.addEventListener('click', () => openModal(f.name, f.id));
    }

    div.appendChild(nameSpan);
    div.appendChild(btn);
    listDiv.appendChild(div);
  });
}

function markButtonSigned(btn) {
  btn.className = 'btn-read done';
  btn.textContent = '✔ 已簽核';
  btn.disabled = true;
}

async function previewFile(id, name) {
  document.getElementById('previewSection').classList.remove('hidden');
  document.getElementById('previewNameTarget').innerText = name;
  const container = document.getElementById('pdfContainer');
  container.innerHTML = "<div class='loading-spinner'>📥 下載文件中...</div>";

  // 切換檔案時停掉上一份的延遲渲染，避免 observer 累積
  if (pdfRenderObserver) {
    pdfRenderObserver.disconnect();
    pdfRenderObserver = null;
  }

  const res = await callApi('getFileBase64', { fileId: id });

  if (!res || !res.success) {
    const errMsg = (res && res.message) ? res.message : "伺服器無回應或連線失敗";
    let html = `<div style="color:#fff; padding:20px; text-align:center;">❌ 讀取失敗：${errMsg}`;
    // 檔案過大時後端會附上 Drive 連結
    if (res && res.webViewLink) {
      html += `<div style="margin-top:12px;"><a href="${res.webViewLink}" target="_blank" rel="noopener noreferrer" style="color:#8ab4f8;">🔗 在 Google Drive 開啟</a></div>`;
    }
    container.innerHTML = html + `</div>`;
    return;
  }

  try {
    container.innerHTML = "<div class='loading-spinner'>📄 解析文件中...</div>";

    const pdf = await pdfjsLib.getDocument({ data: base64ToBytes(res.data) }).promise;
    await renderPdfLazily(pdf, container);
  } catch (e) {
    container.innerHTML = `<div style="color:#ff8a80; padding:20px; text-align:center;">⚠️ PDF 解析失敗：${e.message || e}</div>`;
  }
}

// base64 → Uint8Array。
// 曾經改用 fetch('data:application/pdf;base64,...') 想交給瀏覽器原生解碼，
// 但十幾 MB 的 data URL 會讓 fetch 直接丟出 "Failed to fetch"，所以維持 atob。
// 真正拖慢預覽的是「一次渲染所有頁面」，那部分由 renderPdfLazily 處理。
function base64ToBytes(b64) {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// 先依第 1 頁尺寸替所有頁面建立佔位框，只渲染進入畫面的頁。
// 舊版一次把每一頁都 render 出來，長文件會同時開出數十張大 canvas 並各畫 150 次浮水印。
async function renderPdfLazily(pdf, container) {
  const SCALE = 1.5;
  const baseViewport = (await pdf.getPage(1)).getViewport({ scale: SCALE });

  container.innerHTML = "";

  const slots = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const slot = document.createElement('div');
    slot.dataset.pageNum = String(p);
    slot.style.width = "100%";
    slot.style.aspectRatio = `${baseViewport.width} / ${baseViewport.height}`;
    slot.style.background = "rgba(255,255,255,0.08)";
    slot.style.margin = "10px auto";
    container.appendChild(slot);
    slots.push(slot);
  }

  const renderSlot = async (slot) => {
    if (slot.dataset.rendered) return;
    slot.dataset.rendered = "1";

    const page = await pdf.getPage(Number(slot.dataset.pageNum));
    const viewport = page.getViewport({ scale: SCALE });

    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-page-canvas';
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = "100%";
    canvas.style.height = "auto";
    canvas.style.margin = "0";   // 外距交給 slot，避免與 .pdf-page-canvas 的 margin 疊加

    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    drawWatermark(ctx, canvas.width, canvas.height);

    slot.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
    slot.style.background = "";
    slot.innerHTML = "";
    slot.appendChild(canvas);
  };

  // 捲動發生在 pdfContainer 內部 (css: overflow:auto)，root 必須指向它而非 viewport
  pdfRenderObserver = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        obs.unobserve(entry.target);
        renderSlot(entry.target);
      }
    });
  }, { root: container, rootMargin: "400px 0px" });

  slots.forEach(s => pdfRenderObserver.observe(s));

  // 第 1 頁一定先畫出來，使用者才不會看到空白
  pdfRenderObserver.unobserve(slots[0]);
  await renderSlot(slots[0]);
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

  const btn = document.querySelector(`[data-sign-id="${targetFileId}"]`);
  if (btn) { btn.disabled = true; btn.textContent = "簽核中..."; }

  const res = await callApi('markAsRead', { userName: user.userName, fileName: targetFileName, deptName: user.deptName });

  if (res && res.success) {
    // 只更新這一筆的狀態，不再整包重抓 (舊版簽核一次要付兩趟 GAS 往返)
    if (btn) markButtonSigned(btn);
  } else {
    const msg = (res && res.message) ? res.message : "伺服器無回應";
    alert("簽核失敗：" + msg);
    if (btn) { btn.disabled = false; btn.textContent = "確認已讀"; }
  }
}
