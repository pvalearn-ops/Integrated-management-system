// js/transfer.js — 讓渡派件 (由原擴充功能 popup.js 移植為網頁版)

// 寫回讓渡名冊用的 GAS (沿用原擴充功能的端點；no-cors POST 不受 CORS 影響)
const DISPATCH_WRITE_URL = 'https://script.google.com/macros/s/AKfycbxX-oy4Ttv4Noh4CgiQS7ZD1ZPjXN7_02r0vnr3IiPqwz3J-VU75uVVIzDPZ00mTGOFvA/exec';

const TARGET_DEPT = '機械';
const HEADERS = {
  pName: '姓名', pDept: '部門', pLoad: '負荷比',
  cAppNo: '申請文號', cType: '讓渡態樣', cInsp: '檢查員'
};

let GLOBAL_VALID_INSPECTORS = [];

document.addEventListener('DOMContentLoaded', () => {
  const user = getCurrentUser();

  // 未登入 → 回登入頁
  if (!user.userName) {
    window.location.href = 'index.html';
    return;
  }
  document.getElementById('menuDept').innerText = user.deptName || '';
  document.getElementById('menuUser').innerText = user.userName;

  // 權限攔截：只有明確知道「讓渡派件」為 false 時才擋下 (後端亦會二次驗證)
  const perms = user.permissions || {};
  if (Object.keys(perms).length > 0 && !perms.transfer) {
    document.getElementById('error').style.display = 'block';
    document.getElementById('error').innerHTML = '<b>權限不足：</b>您沒有讓渡派件的權限，即將返回選單。';
    setTimeout(() => { window.location.href = 'menu.html'; }, 1800);
    return;
  }

  // Tab 切換
  document.querySelectorAll('.dispatch-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.dispatch-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.dispatch-view').forEach(v => v.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.target).classList.add('active');
    });
  });

  document.getElementById('writeBtn').addEventListener('click', writeToSheet);

  runProcess();
});

async function runProcess() {
  const statusEl = document.getElementById('dispatchStatus');
  const errorEl = document.getElementById('error');
  const btnWrite = document.getElementById('writeBtn');
  const tbodySuggest = document.querySelector('#suggestTable tbody');

  statusEl.textContent = '資料讀取中...';
  errorEl.style.display = 'none';
  tbodySuggest.innerHTML = '<tr><td colspan="5" style="color:#888; padding:20px;">分析運算中...</td></tr>';
  btnWrite.disabled = true;

  try {
    // 改由系統後端代讀試算表 (避開網頁 CORS，且權限以帳號表「讓渡派件」欄控管)
    const res = await callApi('getDispatchData', { userName: getCurrentUser().userName });
    if (!res || !res.success) {
      throw new Error((res && res.message) ? res.message : '資料讀取失敗');
    }

    const pData = res.personnel || [];
    const cData = res.cases || [];
    if (pData.length === 0 || cData.length === 0) throw new Error('表格內容為空');

    const inspectors = processPersonnel(pData);

    GLOBAL_VALID_INSPECTORS = Object.values(inspectors)
      .filter(p => p.loadRatio > 0)
      .sort((a, b) => b.loadRatio - a.loadRatio);

    const { unassignedCases, allTypes } = processCases(cData, inspectors);
    const suggestions = generateSuggestions(unassignedCases, inspectors);

    renderStats(inspectors, Array.from(allTypes).sort());
    renderSuggestions(suggestions);

    statusEl.textContent = `完成：找到 ${suggestions.length} 筆待派`;

    if (suggestions.length > 0) {
      btnWrite.disabled = false;
      btnWrite.textContent = `寫入 ${suggestions.length} 筆資料`;
    } else {
      btnWrite.textContent = '無待派案件';
    }
  } catch (err) {
    console.error(err);
    errorEl.innerHTML = `<b>執行失敗：</b>${err.message}`;
    errorEl.style.display = 'block';
    tbodySuggest.innerHTML = '<tr><td colspan="5" style="color:#d93025;">讀取失敗</td></tr>';
    statusEl.textContent = '讀取失敗';
  }
}

// --- 寫入功能 ---
async function writeToSheet() {
  const btnWrite = document.getElementById('writeBtn');
  const selects = document.querySelectorAll('.insp-select');
  if (selects.length === 0) return;
  if (!confirm(`確定要寫入 ${selects.length} 筆資料嗎？`)) return;

  btnWrite.disabled = true;
  btnWrite.textContent = '寫入中...';

  const updates = [];
  selects.forEach(sel => {
    const rowIndex = sel.getAttribute('data-row');
    const name = sel.value;
    if (rowIndex && name) {
      updates.push({ rowIndex: parseInt(rowIndex), name: name });
    }
  });

  try {
    await fetch(DISPATCH_WRITE_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates: updates })
    });

    alert('寫入指令已發送！\n將重新整理最新資料。');
    runProcess();
  } catch (err) {
    alert('連線失敗: ' + err.message);
    btnWrite.disabled = false;
    btnWrite.textContent = '重試寫入';
  }
}

// --- 邏輯區 (與原擴充功能一致) ---

function processPersonnel(rows) {
  const validRows = rows.filter(r => r && r.length > 0 && r[0]);

  const header = validRows[0].map(h => String(h).trim());
  const idxName = header.indexOf(HEADERS.pName);
  const idxDept = header.indexOf(HEADERS.pDept);
  let idxLoad = header.indexOf(HEADERS.pLoad);
  if (idxLoad === -1) idxLoad = header.indexOf('負荷');

  if (idxName === -1 || idxDept === -1 || idxLoad === -1) throw new Error('人員表欄位遺失');

  let inspectors = {};
  validRows.slice(1).forEach(row => {
    const name = String(row[idxName]).trim();
    const dept = String(row[idxDept]).trim();
    let loadVal = parseFloat(row[idxLoad]);

    if (name === '陳宜左') loadVal = 1;

    if (dept === TARGET_DEPT && name && !isNaN(loadVal) && loadVal > 0) {
      inspectors[name] = {
        name: name,
        loadRatio: loadVal,
        realCount: 0, realTypeCounts: {},
        simCount: 0, simTypeCounts: {}
      };
    }
  });
  return inspectors;
}

function processCases(rows, inspectors) {
  const header = rows[0].map(h => String(h).trim());
  const idxType = header.indexOf(HEADERS.cType);
  const idxInsp = header.indexOf(HEADERS.cInsp);
  let idxAppNo = header.indexOf(HEADERS.cAppNo);
  if (idxAppNo === -1) idxAppNo = header.indexOf('文號');

  if (idxType === -1 || idxInsp === -1) throw new Error('案件表欄位遺失');

  const unassignedCases = [];
  const allTypes = new Set();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    // 【絕對行號】Excel 行號 = 陣列索引 i + 1 (後端已保留中間空行)
    const excelRowNumber = i + 1;

    if (!row || row.length === 0 || !row[idxAppNo]) continue;

    const type = String(row[idxType] || '未分類').trim();
    const inspector = String(row[idxInsp] || '').trim();
    const appNo = row[idxAppNo];

    allTypes.add(type);

    if (inspector && inspectors[inspector]) {
      inspectors[inspector].realCount++;
      inspectors[inspector].realTypeCounts[type] = (inspectors[inspector].realTypeCounts[type] || 0) + 1;
      inspectors[inspector].simCount++;
      inspectors[inspector].simTypeCounts[type] = (inspectors[inspector].simTypeCounts[type] || 0) + 1;
    } else if (!inspector) {
      unassignedCases.push({ rowIndex: excelRowNumber, type: type, appNo: appNo });
    }
  }

  return { unassignedCases, allTypes };
}

function generateSuggestions(cases, inspectors) {
  return cases.map(caseItem => {
    const candidates = Object.values(inspectors);

    if (candidates.length === 0) {
      return { rowIndex: caseItem.rowIndex, type: caseItem.type, appNo: caseItem.appNo, suggestedPerson: '無', reason: '無可用人員' };
    }

    candidates.sort((a, b) => {
      const typeCountA = a.simTypeCounts[caseItem.type] || 0;
      const typeCountB = b.simTypeCounts[caseItem.type] || 0;
      const typeWeightA = typeCountA / a.loadRatio;
      const typeWeightB = typeCountB / b.loadRatio;
      if (Math.abs(typeWeightA - typeWeightB) > 0.01) return typeWeightA - typeWeightB;

      const weightA = a.simCount / a.loadRatio;
      const weightB = b.simCount / b.loadRatio;
      if (Math.abs(weightA - weightB) > 0.01) return weightA - weightB;

      return b.loadRatio - a.loadRatio;
    });

    const best = candidates[0];
    best.simCount++;
    best.simTypeCounts[caseItem.type] = (best.simTypeCounts[caseItem.type] || 0) + 1;

    const currentTypeWeight = (best.simTypeCounts[caseItem.type] / best.loadRatio).toFixed(2);
    const currentTotalWeight = (best.simCount / best.loadRatio).toFixed(2);

    return {
      rowIndex: caseItem.rowIndex,
      type: caseItem.type,
      appNo: caseItem.appNo,
      suggestedPerson: best.name,
      reason: `態樣權重:<b>${currentTypeWeight}</b> / 總權重:<b>${currentTotalWeight}</b>`
    };
  });
}

function renderStats(inspectors, types) {
  const thead = document.querySelector('#statsTable thead');
  const tbody = document.querySelector('#statsTable tbody');

  let htmlHead = '<tr><th>姓名</th><th>負荷比</th><th>總件</th><th>權重</th>';
  types.forEach(t => htmlHead += `<th>${t.replace('讓渡態樣-', '')}</th>`);
  htmlHead += '</tr>';
  thead.innerHTML = htmlHead;

  const list = Object.values(inspectors).sort((a, b) => {
    const weightA = a.realCount / a.loadRatio;
    const weightB = b.realCount / b.loadRatio;
    return weightA - weightB;
  });

  tbody.innerHTML = list.map(p => {
    const displayWeight = (p.realCount / p.loadRatio).toFixed(2);
    let html = `<tr>
      <td>${p.name}</td>
      <td><span class="load-tag">${p.loadRatio}</span></td>
      <td><b>${p.realCount}</b></td>
      <td><span class="weight-tag">${displayWeight}</span></td>`;
    types.forEach(t => {
      const c = p.realTypeCounts[t] || 0;
      html += `<td style="${c > 0 ? 'color:#333' : 'color:#ccc'}">${c > 0 ? c : '-'}</td>`;
    });
    html += '</tr>';
    return html;
  }).join('');
}

function renderSuggestions(list) {
  const tbody = document.querySelector('#suggestTable tbody');
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="padding:20px;color:#1e8e3e;font-weight:bold;">🎉 目前沒有待派案件</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(item => {
    let options = '';
    GLOBAL_VALID_INSPECTORS.forEach(insp => {
      const selected = insp.name === item.suggestedPerson ? 'selected' : '';
      options += `<option value="${insp.name}" ${selected}>${insp.name}</option>`;
    });

    return `
    <tr>
      <td>#${item.rowIndex}</td>
      <td style="color:#555;">${item.appNo || '-'}</td>
      <td>${item.type.replace('讓渡態樣-', '')}</td>
      <td><select class="insp-select" data-row="${item.rowIndex}">${options}</select></td>
      <td class="sub-text">${item.reason}</td>
    </tr>`;
  }).join('');
}
