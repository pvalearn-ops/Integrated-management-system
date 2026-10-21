// js/upload.js — 上傳掃描檔
// 一個檔案可同時送到多個雲端資料夾 (經 GAS) 與多個本機資料夾 (File System Access API)。

const user = getCurrentUser();

// key 必須與後端 SCAN_TARGETS 一致；資料夾 ID 只放在後端
const CLOUD_TARGETS = [
  { key: 'osha',      name: '職安署來函與函示',   byYear: true },
  { key: 'bizJoint',  name: '業務聯席會會議紀錄', byYear: true },
  { key: 'techComm',  name: '技術委員會會議紀錄', byYear: true },
  { key: 'groupMtg',  name: '組務會議',           byYear: true },
  { key: 'audit',     name: '代檢業務稽核',       byYear: true },
  { key: 'signMech',  name: '會簽檔案_機械',      byYear: false },
  { key: 'signEquip', name: '會簽檔案_設備',      byYear: false },
  { key: 'signAdmin', name: '會簽檔案_行政',      byYear: false }
];

// 經 GAS 上傳要包成 base64 (膨脹約 33%)，太大會撞到 Apps Script 的請求上限
const MAX_UPLOAD_MB = 30;

const SEL_KEY = 'uploadScanSel';   // localStorage：記住上次勾選的位置
const LOCAL_SUPPORTED = typeof window.showDirectoryPicker === 'function';

let picked = [];        // [{ file, handle, name }]；handle 有值才能刪除原始檔
let localTargets = [];  // [{ id, name, handle }]，存在 IndexedDB
let selection = loadSelection();
let uploading = false;

window.onload = async () => {
  if (!user.userName) { window.location.href = "index.html"; return; }
  document.getElementById('upUser').innerText = user.userName;
  document.getElementById('upDept').innerText = user.deptName;
  document.getElementById('rocYear').value = new Date().getFullYear() - 1911;

  initFilePicking();
  renderTargets();

  if (!LOCAL_SUPPORTED) {
    document.getElementById('localUnsupported').classList.remove('hidden');
    document.getElementById('btnAddLocal').classList.add('hidden');
    return;
  }
  try {
    localTargets = await idbGetAll();
  } catch (e) {
    console.error('讀取本機位置失敗', e);
  }
  renderLocalTargets();
};

// ==========================================
// 選擇檔案
// ==========================================
function initFilePicking() {
  const zone = document.getElementById('dropZone');
  const input = document.getElementById('fileInput');

  zone.addEventListener('click', async () => {
    // 支援的瀏覽器改用 showOpenFilePicker，才拿得到檔案 handle (刪除原始檔需要)
    if (typeof window.showOpenFilePicker === 'function') {
      try {
        const handles = await window.showOpenFilePicker({ multiple: true });
        for (const h of handles) addPicked(await h.getFile(), h);
        renderPicked();
      } catch (e) {
        if (e.name !== 'AbortError') console.error(e);
      }
    } else {
      input.click();
    }
  });

  input.addEventListener('change', () => {
    Array.from(input.files).forEach(f => addPicked(f, null));
    input.value = '';
    renderPicked();
  });

  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', async e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    // getAsFileSystemHandle 必須在 drop 事件當下 (任何 await 之前) 對每個項目呼叫
    const items = Array.from(e.dataTransfer.items || []).filter(it => it.kind === 'file');
    const jobs = items.map(it => ({
      file: it.getAsFile(),
      handle: typeof it.getAsFileSystemHandle === 'function' ? it.getAsFileSystemHandle() : null
    }));
    for (const job of jobs) {
      let handle = null;
      try { handle = job.handle ? await job.handle : null; } catch (err) {}
      if (handle && handle.kind !== 'file') continue;   // 拖進來的是資料夾就略過
      if (job.file) addPicked(job.file, handle);
    }
    renderPicked();
  });
}

function addPicked(file, handle) {
  // 同一個檔案重複選取不重複加入
  if (picked.some(p => p.file.name === file.name && p.file.size === file.size && p.file.lastModified === file.lastModified)) return;
  picked.push({ file: file, handle: handle, name: file.name });
}

function renderPicked() {
  const box = document.getElementById('pickedList');
  box.innerHTML = '';
  picked.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'pick-row';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = p.name;
    nameInput.title = '可直接修改上傳後的檔名';
    nameInput.addEventListener('input', () => { p.name = nameInput.value; });

    const size = document.createElement('span');
    size.className = 'pick-size';
    size.textContent = formatSize(p.file.size);

    const del = document.createElement('button');
    del.className = 'btn-x';
    del.textContent = '✕';
    del.title = '移除';
    del.addEventListener('click', () => { picked.splice(i, 1); renderPicked(); });

    row.append(nameInput, size, del);
    box.appendChild(row);
  });

  // 至少有一個檔案拿得到 handle 才顯示「刪除原始檔」選項
  const canDelete = picked.some(p => p.handle && typeof p.handle.remove === 'function');
  document.getElementById('deleteOptRow').classList.toggle('hidden', !canDelete);
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

// ==========================================
// 位置清單
// ==========================================
function getYear() {
  return parseInt(document.getElementById('rocYear').value, 10);
}

function changeYear(delta) {
  const y = getYear() || (new Date().getFullYear() - 1911);
  document.getElementById('rocYear').value = y + delta;
  renderTargets();
}

function renderTargets() {
  const box = document.getElementById('cloudTargets');
  box.innerHTML = '';
  const year = getYear();
  CLOUD_TARGETS.forEach(t => {
    const sub = t.byYear ? `依年度 → ${year || '?'}年` : '';
    box.appendChild(buildTargetItem('cloud', t.key, t.name, sub));
  });
}

function renderLocalTargets() {
  const box = document.getElementById('localTargets');
  box.innerHTML = '';
  if (localTargets.length === 0) {
    box.innerHTML = '<div class="target-sub">尚未設定本機位置，按右上「＋ 新增本機位置」選擇資料夾。</div>';
    return;
  }
  localTargets.forEach(t => {
    const item = buildTargetItem('local', t.id, t.name, '📁 ' + t.handle.name);

    const actions = document.createElement('span');
    actions.className = 'local-actions';
    const btnRename = document.createElement('button');
    btnRename.className = 'btn-secondary';
    btnRename.textContent = '改名';
    btnRename.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); renameLocalTarget(t.id); });
    const btnRemove = document.createElement('button');
    btnRemove.className = 'btn-secondary';
    btnRemove.textContent = '移除';
    btnRemove.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); removeLocalTarget(t.id); });
    actions.append(btnRename, btnRemove);

    item.appendChild(actions);
    box.appendChild(item);
  });
}

function buildTargetItem(group, id, name, sub) {
  const label = document.createElement('label');
  label.className = 'target-item';

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = selection[group].indexOf(id) !== -1;
  label.classList.toggle('checked', cb.checked);
  cb.addEventListener('change', () => {
    const list = selection[group];
    const idx = list.indexOf(id);
    if (cb.checked && idx === -1) list.push(id);
    if (!cb.checked && idx !== -1) list.splice(idx, 1);
    label.classList.toggle('checked', cb.checked);
    saveSelection();
  });

  const text = document.createElement('span');
  text.className = 'target-name';
  text.textContent = name;
  if (sub) {
    const s = document.createElement('div');
    s.className = 'target-sub';
    s.textContent = sub;
    text.appendChild(s);
  }

  label.append(cb, text);
  return label;
}

function loadSelection() {
  try {
    const s = JSON.parse(localStorage.getItem(SEL_KEY) || 'null');
    if (s && Array.isArray(s.cloud) && Array.isArray(s.local)) return s;
  } catch (e) {}
  return { cloud: [], local: [] };
}

function saveSelection() {
  try { localStorage.setItem(SEL_KEY, JSON.stringify(selection)); } catch (e) {}
}

// ==========================================
// 本機位置管理 (資料夾 handle 存在這台電腦的 IndexedDB)
// ==========================================
async function addLocalTarget() {
  let handle;
  try {
    handle = await window.showDirectoryPicker({ id: 'uploadScanTarget', mode: 'readwrite' });
  } catch (e) {
    if (e.name !== 'AbortError') alert('無法選擇資料夾：' + e.message);
    return;
  }
  const name = (prompt('請為這個本機位置命名：', handle.name) || '').trim();
  if (!name) return;

  const t = { id: 'L' + Date.now(), name: name, handle: handle };
  try {
    await idbPut(t);
  } catch (e) {
    alert('儲存本機位置失敗：' + e.message);
    return;
  }
  localTargets.push(t);
  selection.local.push(t.id);
  saveSelection();
  renderLocalTargets();
}

async function renameLocalTarget(id) {
  const t = localTargets.find(x => x.id === id);
  if (!t) return;
  const name = (prompt('新的名稱：', t.name) || '').trim();
  if (!name || name === t.name) return;
  t.name = name;
  try { await idbPut(t); } catch (e) { alert('儲存失敗：' + e.message); }
  renderLocalTargets();
}

async function removeLocalTarget(id) {
  const t = localTargets.find(x => x.id === id);
  if (!t || !confirm(`確定移除本機位置「${t.name}」？\n（只是從清單移除，不會刪除資料夾內的檔案）`)) return;
  try { await idbDelete(id); } catch (e) {}
  localTargets = localTargets.filter(x => x.id !== id);
  selection.local = selection.local.filter(x => x !== id);
  saveSelection();
  renderLocalTargets();
}

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('uploadScan', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('targets', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbTx(mode, fn) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('targets', mode);
    const req = fn(tx.objectStore('targets'));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  });
}

const idbGetAll = () => idbTx('readonly', s => s.getAll()).then(r => (r || []).sort((a, b) => a.id < b.id ? -1 : 1));
const idbPut = t => idbTx('readwrite', s => s.put(t));
const idbDelete = id => idbTx('readwrite', s => s.delete(id));

// ==========================================
// 上傳
// ==========================================
function log(msg, type) {
  const div = document.createElement('div');
  div.className = 'log-line log-' + (type || 'info');
  div.textContent = msg;
  document.getElementById('logBox').appendChild(div);
}

// 本機資料夾權限：瀏覽器重開後通常要再按一次「允許」，必須在使用者點擊當下詢問
async function ensurePermission(handle) {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

async function startUpload() {
  if (uploading) return;
  const cloudSel = CLOUD_TARGETS.filter(t => selection.cloud.indexOf(t.key) !== -1);
  const localSel = localTargets.filter(t => selection.local.indexOf(t.id) !== -1);
  const year = getYear();

  if (picked.length === 0) { alert('請先選擇檔案'); return; }
  if (cloudSel.length + localSel.length === 0) { alert('請至少勾選一個上傳位置'); return; }
  if (cloudSel.some(t => t.byYear) && !(year >= 100 && year <= 200)) { alert('年度格式錯誤'); return; }
  const emptyName = picked.find(p => !String(p.name).trim());
  if (emptyName) { alert('檔名不可空白'); return; }
  const tooBig = picked.find(p => cloudSel.length > 0 && p.file.size > MAX_UPLOAD_MB * 1024 * 1024);
  if (tooBig) { alert(`「${tooBig.name}」超過 ${MAX_UPLOAD_MB}MB，無法上傳到雲端`); return; }

  const wantDelete = !document.getElementById('deleteOptRow').classList.contains('hidden') &&
                     document.getElementById('optDeleteOriginal').checked;

  // 先把所有需要的權限一次問完 (之後的 await 會讓點擊的授權時效過期)
  try {
    for (const t of localSel) {
      if (!(await ensurePermission(t.handle))) { alert(`未取得本機位置「${t.name}」的寫入權限`); return; }
    }
    if (wantDelete) {
      for (const p of picked) {
        if (p.handle && typeof p.handle.remove === 'function') await ensurePermission(p.handle);
      }
    }
  } catch (e) {
    alert('權限確認逾時，請再按一次「開始上傳」。\n(' + e.message + ')');
    return;
  }

  uploading = true;
  const btn = document.getElementById('btnUpload');
  btn.disabled = true;
  document.getElementById('logBox').innerHTML = '';

  const done = [];
  for (let i = 0; i < picked.length; i++) {
    const p = picked[i];
    btn.innerText = `上傳中... (${i + 1}/${picked.length})`;
    const ok = await uploadOne(p, cloudSel, localSel, year);
    if (ok) done.push(p);

    if (ok && wantDelete && p.handle && typeof p.handle.remove === 'function') {
      try {
        await p.handle.remove();
        log(`🗑 已刪除原始檔：${p.file.name}`, 'info');
      } catch (e) {
        log(`⚠ 原始檔刪除失敗，請手動刪除：${p.file.name} (${e.message})`, 'err');
      }
    } else if (!ok && wantDelete) {
      log(`⚠ ${p.file.name} 有位置失敗，原始檔保留未刪除`, 'err');
    }
  }

  // 成功的檔案從清單移除，失敗的留著方便重試
  picked = picked.filter(p => done.indexOf(p) === -1);
  renderPicked();

  uploading = false;
  btn.disabled = false;
  btn.innerText = '開始上傳';
  if (picked.length === 0) log('✅ 全部完成', 'ok');
  else log(`完成 ${done.length} 個，失敗的 ${picked.length} 個仍留在清單，請確認後重試`, 'err');
}

// 回傳 true 代表所有勾選位置都成功
async function uploadOne(p, cloudSel, localSel, year) {
  const name = String(p.name).trim();
  let allOk = true;

  // 本機：直接寫檔，同名就加 (1)、(2)… 不覆蓋
  for (const t of localSel) {
    try {
      const finalName = await uniqueLocalName(t.handle, name);
      const fh = await t.handle.getFileHandle(finalName, { create: true });
      const w = await fh.createWritable();
      await w.write(p.file);
      await w.close();
      log(`✔ ${name} → 本機「${t.name}」${finalName !== name ? '（已改名為 ' + finalName + '）' : ''}`, 'ok');
    } catch (e) {
      allOk = false;
      log(`✘ ${name} → 本機「${t.name}」失敗：${e.message}`, 'err');
    }
  }

  // 雲端：檔案只送一次，後端寫入所有勾選的資料夾
  if (cloudSel.length > 0) {
    let data;
    try {
      data = await readAsBase64(p.file);
    } catch (e) {
      log(`✘ ${name} 讀取失敗：${e.message}`, 'err');
      return false;
    }
    const res = await callApi('uploadScanFile', {
      userName: user.userName,
      fileName: name,
      mimeType: p.file.type,
      data: data,
      targets: cloudSel.map(t => t.byYear ? { key: t.key, year: year } : { key: t.key })
    });

    if (Array.isArray(res.results)) {
      res.results.forEach(r => {
        if (r.success) {
          log(`✔ ${name} → 雲端「${r.path}」${r.fileName !== name ? '（已改名為 ' + r.fileName + '）' : ''}`, 'ok');
        } else {
          allOk = false;
          log(`✘ ${name} → 雲端「${r.path}」失敗：${r.message}`, 'err');
        }
      });
    } else {
      allOk = false;
      // 連線類錯誤時後端可能其實已寫入 (見 api.js 說明)，重試前先到雲端確認，避免重複
      log(`✘ ${name} 雲端上傳失敗：${res.message || '未知錯誤'}（重試前請先到雲端資料夾確認是否已上傳）`, 'err');
    }
  }
  return allOk;
}

async function uniqueLocalName(dir, name) {
  const exists = async n => {
    try { await dir.getFileHandle(n); return true; }
    catch (e) { if (e.name === 'NotFoundError') return false; throw e; }
  };
  if (!(await exists(name))) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.substring(0, dot) : name;
  const ext = dot > 0 ? name.substring(dot) : '';
  for (let i = 1; i < 100; i++) {
    const n = `${base} (${i})${ext}`;
    if (!(await exists(n))) return n;
  }
  return `${base}_${Date.now()}${ext}`;
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
