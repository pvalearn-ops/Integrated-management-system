let targetFileId = "", targetFileName = "";
let pdfRenderObserver = null;
// 每次開預覽 +1。較早開始、較晚完成的預覽發現自己已過期就放棄，
// 避免快速連點兩份文件時，前一份載完把後一份的畫面蓋掉。
let previewSeq = 0;
const user = getCurrentUser();

// ★ Drive API 金鑰。填入後，PDF 改由瀏覽器直接向 Google 取檔，
//   不再繞道 GAS —— 速度快上一個量級，且沒有大小限制，浮水印照常繪製。
//   留空則沿用原本的 GAS 路徑 (大檔會失敗)。
//   前置作業：三個會簽資料夾設為「知道連結者可檢視」+ 建立受限的 API 金鑰。
const DRIVE_API_KEY = "AIzaSyDF35QvitrwstxIzACmNwq0SOavdE2QgHk";

// 文件一律以「pdf.js 繪製 + 浮水印」顯示。浮水印畫不上去的頁面直接不顯示，
// 也不提供 Drive 原檔連結或內嵌檢視器 —— 那些路徑拿得到沒有浮水印的原始檔。

// pdf.js 的備援來源：主來源 (sign.html 載入的 cdnjs) 載不到時改從 jsdelivr 載入
const PDFJS_FALLBACK = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@2.16.105/build/';

// 本頁已下載過的 PDF 位元組 (fileId → Uint8Array)，重複點同一份不必再下載
const pdfBytesCache = new Map();

// 會簽清單的本地快取 key (依部門+姓名區分)
function signCacheKey() {
  return 'signList_' + user.deptName + '_' + user.userName;
}

window.onload = () => {
  if (!user.userName) { window.location.href = "index.html"; return; }
  loadFiles();
};

function renderFiles(files) {
  const listDiv = document.getElementById('fileList');
  listDiv.innerHTML = "";

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

async function loadFiles() {
  const listDiv = document.getElementById('fileList');

  // 先用上次的清單即時渲染 (開頁面零等待)，新資料到了再無感更新
  let hadCache = false;
  try {
    const cached = JSON.parse(localStorage.getItem(signCacheKey()) || 'null');
    if (Array.isArray(cached) && cached.length > 0) {
      renderFiles(cached);
      hadCache = true;
    }
  } catch (e) {}
  if (!hadCache) listDiv.innerHTML = "載入中...";

  const files = await callApi('getFileList', { userName: user.userName, deptName: user.deptName });

  // 後端回傳錯誤：有快取畫面就維持舊清單不動，沒有才顯示錯誤
  if (files && files.success === false) {
    if (!hadCache) {
      listDiv.innerHTML = `<p style="color:red; text-align:center;">讀取失敗：${files.message}</p>`;
    }
    return;
  }
  if (!Array.isArray(files)) {
    if (!hadCache) listDiv.innerHTML = "<p style='text-align:center;'>無檔案</p>";
    return;
  }

  try {
    localStorage.setItem(signCacheKey(), JSON.stringify(files));
  } catch (e) {}
  renderFiles(files);
}

// 更新本地快取中某檔案的簽核狀態 (樂觀更新用)
function updateCachedSign(fileId, isSigned) {
  try {
    const cached = JSON.parse(localStorage.getItem(signCacheKey()) || 'null');
    if (!Array.isArray(cached)) return;
    cached.forEach(f => { if (f.id === fileId) f.isSigned = isSigned; });
    localStorage.setItem(signCacheKey(), JSON.stringify(cached));
  } catch (e) {}
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
  const seq = ++previewSeq;
  const isStale = () => seq !== previewSeq;

  container.innerHTML = "<div class='loading-spinner'>📥 下載文件中...</div>";

  // 切換檔案時停掉上一份的延遲渲染，避免 observer 累積
  if (pdfRenderObserver) {
    pdfRenderObserver.disconnect();
    pdfRenderObserver = null;
  }

  // 沒有姓名就畫不出浮水印 → 不顯示
  if (!user.userName) {
    showPreviewError(container, id, name, '無法取得使用者姓名，浮水印無法產生');
    return;
  }

  try {
    await ensurePdfJs();
  } catch (e) {
    if (!isStale()) showPreviewError(container, id, name, '預覽元件載入失敗，請檢查網路後重試');
    return;
  }

  let bytes;
  try {
    bytes = await getPdfBytes(id);
  } catch (e) {
    if (!isStale()) showPreviewError(container, id, name, e.message || String(e));
    return;
  }
  if (isStale()) return;

  try {
    container.innerHTML = "<div class='loading-spinner'>📄 解析文件中...</div>";
    // pdf.js 會把傳入的 buffer 轉移給 worker，給它一份複本，快取的才不會被清空
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    if (isStale()) return;
    await renderPdfLazily(pdf, container, isStale);
  } catch (e) {
    pdfBytesCache.delete(id);
    if (!isStale()) showPreviewError(container, id, name, '文件顯示失敗：' + (e.message || e));
  }
}

// 依序嘗試：記憶體快取 → Drive API (重試一次) → GAS。全部失敗才丟出錯誤。
async function getPdfBytes(id) {
  if (pdfBytesCache.has(id)) return pdfBytesCache.get(id);

  let lastErr = '';
  // 路徑 1：瀏覽器直接向 Drive API 取原始位元組 (快、沒有大小限制)
  if (DRIVE_API_KEY) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const bytes = await fetchPdfFromDrive(id);
        pdfBytesCache.set(id, bytes);
        return bytes;
      } catch (e) {
        lastErr = e.message || String(e);
        console.warn(`[預覽] Drive API 第 ${attempt} 次失敗：`, e);
        if (attempt === 1) await delay(500);
      }
    }
  }

  // 路徑 2：經 GAS 取 base64 (大檔可能失敗)
  const res = await callApi('getFileBase64', { fileId: id });
  if (res && res.success && res.data) {
    const bytes = base64ToBytes(res.data);
    pdfBytesCache.set(id, bytes);
    return bytes;
  }
  throw new Error((res && res.message) || lastErr || '伺服器無回應或連線失敗');
}

// 向 Drive REST API 取原始檔案位元組。
// googleapis.com 會回傳 CORS 標頭，所以瀏覽器可以直接抓；
// 檔案必須是「知道連結者可檢視」，金鑰才有權限讀取。
async function fetchPdfFromDrive(fileId) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${DRIVE_API_KEY}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    // 瀏覽器預設跨站只送網域 (https://pvalearn-ops.github.io/)，對不上金鑰限制的
    // 「.../Integrated-management-system/*」而被 403；改為送出完整網址。
    const resp = await fetch(url, {
      cache: 'no-store',
      referrerPolicy: 'no-referrer-when-downgrade',
      signal: controller.signal
    });
    if (!resp.ok) throw new Error(`Drive API HTTP ${resp.status}`);
    const bytes = new Uint8Array(await resp.arrayBuffer());
    // 確認真的是 PDF (開頭為 %PDF)，避免把錯誤頁面當文件解析
    if (bytes.length < 5 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== '%PDF') {
      throw new Error('Drive API 回傳的不是 PDF');
    }
    return bytes;
  } finally {
    clearTimeout(timer);
  }
}

// 確保 pdf.js 可用：主來源沒載到時，改從備援 CDN 動態載入
async function ensurePdfJs() {
  if (window.pdfjsLib) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PDFJS_FALLBACK + 'pdf.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('pdf.js 載入失敗'));
    document.head.appendChild(s);
  });
  if (!window.pdfjsLib) throw new Error('pdf.js 載入失敗');
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_FALLBACK + 'pdf.worker.min.js';
}

// 預覽失敗：只顯示錯誤與「重試」，刻意不給 Drive 連結 (那會拿到沒有浮水印的原檔)
function showPreviewError(container, fileId, fileName, errMsg) {
  container.innerHTML = "";
  const box = document.createElement('div');
  box.style.cssText = "color:#ff8a80; padding:20px; text-align:center;";
  box.textContent = `❌ 文件無法顯示：${errMsg}`;
  const retry = document.createElement('button');
  retry.className = 'btn-secondary';
  retry.style.cssText = "display:block; margin:12px auto 0;";
  retry.textContent = '🔄 重試';
  retry.addEventListener('click', () => previewFile(fileId, fileName));
  box.appendChild(retry);
  container.appendChild(box);
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
async function renderPdfLazily(pdf, container, isStale) {
  const SCALE = 1.5;
  const baseViewport = (await pdf.getPage(1)).getViewport({ scale: SCALE });
  if (isStale()) return;

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

    try {
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: viewport }).promise;
      // 浮水印畫不上去就丟掉這張 canvas，絕不顯示沒有浮水印的頁面
      drawWatermark(ctx, canvas.width, canvas.height);
    } catch (e) {
      console.error(`[預覽] 第 ${slot.dataset.pageNum} 頁顯示失敗：`, e);
      canvas.width = 0;
      slot.style.background = "";
      slot.style.aspectRatio = "";
      slot.innerHTML = `<div style="color:#ff8a80; padding:20px; text-align:center;">❌ 第 ${slot.dataset.pageNum} 頁無法顯示（浮水印或頁面繪製失敗）</div>`;
      return;
    }

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
  const text = `${user.userName || ''} ${dateStr}`.trim();
  if (!user.userName || !text) throw new Error('浮水印文字為空');
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
  const fileId = targetFileId, fileName = targetFileName;

  // 樂觀更新：按下去立刻顯示已簽核，寫入在背景進行；失敗才還原並提示重按。
  // 小系統以操作回饋速度為優先，值得用這個取捨。
  if (btn) markButtonSigned(btn);
  updateCachedSign(fileId, true);

  const res = await callApi('markAsRead', { userName: user.userName, fileName: fileName, deptName: user.deptName });

  if (!res || !res.success) {
    updateCachedSign(fileId, false);
    if (btn) {
      btn.disabled = false;
      btn.className = 'btn-read';
      btn.textContent = '確認已讀';
    }
    const msg = (res && res.message) ? res.message : "伺服器無回應";
    alert(`「${fileName}」簽核失敗：${msg}\n請再按一次「確認已讀」。`);
  }
}
