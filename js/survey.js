// js/survey.js - 問卷管理前端邏輯

window.onload = async () => {
  const user = getCurrentUser();
  if (!user.userName) {
    window.location.href = "index.html";
    return;
  }
  
  const perms = user.permissions || {};
  if (Object.keys(perms).length > 0 && perms.survey === false) {
    alert("權限不足：您沒有自動問卷的權限！將返回主選單。");
    window.location.href = "menu.html";
    return;
  }

  document.getElementById('surveyUser').innerText = user.userName;
  document.getElementById('surveyDept').innerText = user.deptName;

  await loadSurveyList();
};

/**
 * 載入當前使用者的問卷清單
 */
async function loadSurveyList() {
  const surveyListEl = document.getElementById('surveyList');
  surveyListEl.innerHTML = '<div style="text-align: center; color: #999; padding: 20px;">載入中...</div>';
  
  const user = getCurrentUser();
  const res = await callApi('getSurveyList', {
    userName: user.userName,
    deptName: user.deptName
  });

  if (!res.success) {
    surveyListEl.innerHTML = `<div style="text-align: center; color: #d93025; padding: 20px;">載入失敗：${res.message}</div>`;
    return;
  }

  if (res.surveys.length === 0) {
    surveyListEl.innerHTML = '<div style="text-align: center; color: #999; padding: 30px;">您目前尚未建立任何問卷。</div>';
    return;
  }

  surveyListEl.innerHTML = '';
  res.surveys.forEach(survey => {
    // 格式化建立時間，若是 Date 物件轉的字串直接截取
    const dateStr = String(survey.createdTime).substring(0, 16);
    
    const card = document.createElement('div');
    card.className = 'survey-card';
    card.innerHTML = `
      <div class="survey-info">
        <div class="survey-title">${escapeHtml(survey.title)}</div>
        <div class="survey-meta">建立時間：${dateStr}</div>
      </div>
      <div class="survey-ops">
        <button class="btn-outline" style="padding: 5px 12px; font-size:0.9em;" onclick="showQrModal('${survey.url}')">分享 (QR)</button>
        <button class="btn-primary" style="padding: 5px 12px; font-size:0.9em; width:auto;" onclick="showStatsModal('${survey.id}')">統計分析</button>
        <button class="btn-outline" style="padding: 5px 12px; font-size:0.9em; border-color:#0b5394; color:#0b5394;" onclick="showResponsesModal('${survey.id}')">回覆明細</button>
        <button class="btn-secondary" style="padding: 5px 12px; font-size:0.9em; color:#d93025; border-color:#fce8e6;" onclick="handleDeleteSurvey('${survey.id}', '${escapeJs(survey.title)}')">刪除</button>
      </div>
    `;
    surveyListEl.appendChild(card);
  });
}

/**
 * 處理建立問卷
 */
async function handleCreateSurvey() {
  const titleInput = document.getElementById('newSurveyTitle');
  const title = titleInput.value.trim();
  
  if (!title) {
    alert("請輸入問卷課程/活動標題！");
    return;
  }

  const btn = document.getElementById('btnCreateSurvey');
  btn.disabled = true;
  btn.innerText = "建立中...";

  const user = getCurrentUser();
  const res = await callApi('createSurvey', {
    userName: user.userName,
    deptName: user.deptName,
    title: title
  });

  btn.disabled = false;
  btn.innerText = "建立問卷";

  if (res.success) {
    alert(`問卷「${title}」已建立成功！`);
    titleInput.value = "";
    await loadSurveyList();
    showQrModal(res.url);
  } else {
    alert(`建立失敗：${res.message}`);
  }
}

/**
 * 處理刪除問卷
 */
async function handleDeleteSurvey(surveyId, title) {
  if (!confirm(`確定要刪除「${title}」問卷嗎？\n刪除後會將問卷與回覆檔案移至垃圾桶。`)) {
    return;
  }

  const user = getCurrentUser();
  const res = await callApi('deleteSurvey', {
    userName: user.userName,
    deptName: user.deptName,
    surveyId: surveyId
  });

  if (res.success) {
    alert("刪除問卷成功！");
    await loadSurveyList();
  } else {
    alert(`刪除失敗：${res.message}`);
  }
}

/**
 * 分享與 QR Code 視窗
 */
function showQrModal(url) {
  const modal = document.getElementById('qrModal');
  const qrImg = document.getElementById('qrImg');
  const qrLink = document.getElementById('qrLink');
  
  // 使用 https://api.qrserver.com/ 免費且無流量限制產生 QR Code 圖片
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(url)}`;
  qrImg.src = qrUrl;
  qrLink.href = url;
  qrLink.innerText = url;
  
  modal.classList.remove('hidden');
}

function closeQrModal() {
  document.getElementById('qrModal').classList.add('hidden');
}

function copyQrLink() {
  const link = document.getElementById('qrLink').href;
  navigator.clipboard.writeText(link).then(() => {
    alert("問卷連結已複製至剪貼簿！");
  }).catch(() => {
    alert("複製失敗，請手動複製連結：" + link);
  });
}

/**
 * 顯示問卷統計燈箱
 */
async function showStatsModal(surveyId) {
  const modal = document.getElementById('statsModal');
  const content = document.getElementById('statsContent');
  
  content.innerHTML = '<div style="text-align: center; color: #999; padding: 50px;">正在從 Google 試算表統計回覆資料，請稍候...</div>';
  modal.classList.remove('hidden');

  const user = getCurrentUser();
  const res = await callApi('getSurveyStats', {
    userName: user.userName,
    deptName: user.deptName,
    surveyId: surveyId
  });

  if (!res.success) {
    content.innerHTML = `<div style="text-align: center; color: #d93025; padding: 50px;">載入統計失敗：${res.message}</div>`;
    return;
  }

  const stats = res.stats;
  
  if (res.count === 0 || !stats || stats.count === 0) {
    content.innerHTML = `<div style="text-align: center; color: #999; padding: 50px;">${res.message || '目前尚無人填寫此問卷。'}</div>`;
    return;
  }

  // 生成統計圖表 HTML
  let html = `
    <div class="stats-header-summary">
      <div>問卷名稱：${escapeHtml(stats.title)}</div>
      <div>回收份數：${stats.count} 份</div>
    </div>
  `;

  // 1. 評分題統計 (第 1 到 7 題)
  html += `
    <div class="stats-card-group">
      <div class="stats-card-title">滿意度量化評分 (百分比單選格統計)</div>
  `;
  for (const qTitle in stats.scores) {
    const sData = stats.scores[qTitle];
    html += `
      <div class="stats-progress-row">
        <div class="stats-progress-label">
          <span>${escapeHtml(qTitle)}</span>
          <span>滿意度平均：<strong>${sData.average}%</strong></span>
        </div>
        <div class="stats-progress-bar-container">
          <div class="stats-progress-bar-fill" style="width: ${sData.percentage}%"></div>
        </div>
        <div style="font-size: 0.75em; color: #777; margin-top: 2px; text-align: right;">
          分佈：100%(${sData['100%']}人) | 90%(${sData['90%']}人) | 80%(${sData['80%']}人) | 70%(${sData['70%']}人) | 60%(${sData['60%']}人) | 50%(${sData['50%']}人) | 其他(${sData['其他']}人)
        </div>
      </div>
    `;
  }
  html += `</div>`;

  // 2. 建議與意見回饋 (8)
  html += `
    <div class="stats-card-group">
      <div class="stats-card-title">8. 針對課程內容及其他相關問題回饋</div>
      <div class="feedback-list">
  `;
  if (stats.feedbacks.length === 0) {
    html += `<div style="color: #999; font-size: 0.9em; padding: 5px;">無填寫回饋</div>`;
  } else {
    stats.feedbacks.forEach(fb => {
      html += `
        <div class="feedback-item">
          <div class="feedback-name">${escapeHtml(fb.name)}</div>
          <div>${escapeHtml(fb.content)}</div>
        </div>
      `;
    });
  }
  html += `
      </div>
    </div>
  `;

  // 3. 未來辦理課程建議 (9)
  html += `
    <div class="stats-card-group">
      <div class="stats-card-title">9. 希望未來辦理之訓練課程內容</div>
      <div class="feedback-list">
  `;
  if (stats.futureDemands.length === 0) {
    html += `<div style="color: #999; font-size: 0.9em; padding: 5px;">無填寫回饋</div>`;
  } else {
    stats.futureDemands.forEach(fd => {
      html += `
        <div class="feedback-item">
          <div class="feedback-name">${escapeHtml(fd.name)}</div>
          <div>${escapeHtml(fd.content)}</div>
        </div>
      `;
    });
  }
  html += `
      </div>
    </div>
  `;

  content.innerHTML = html;
}

function closeStatsModal() {
  document.getElementById('statsModal').classList.add('hidden');
}

/**
 * 列印統計分析報表
 */
function printStats() {
  const statsContent = document.getElementById('statsContent').innerHTML;
  const printArea = document.getElementById('printArea');
  
  printArea.innerHTML = `
    <h2 style="text-align: center; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 10px;">
      問卷滿意度回覆統計分析報告
    </h2>
    ${statsContent}
  `;
  
  window.print();
}

/**
 * 顯示問卷回覆明細燈箱
 */


async function showResponsesModal(surveyId) {
  const modal = document.getElementById('responsesModal');
  const content = document.getElementById('responsesContent');
  
  content.innerHTML = '<div style="text-align: center; color: #999; padding: 50px;">正在讀取回覆明細資料，請稍候...</div>';
  modal.classList.remove('hidden');

  const user = getCurrentUser();
  const res = await callApi('getSurveyStats', {
    userName: user.userName,
    deptName: user.deptName,
    surveyId: surveyId
  });

  if (!res.success) {
    content.innerHTML = `<div style="text-align: center; color: #d93025; padding: 50px;">載入明細失敗：${res.message}</div>`;
    return;
  }

  if (!res.rows || res.rows.length === 0) {
    content.innerHTML = `<div style="text-align: center; color: #999; padding: 50px;">目前尚無人填寫此問卷。</div>`;
    return;
  }

  // 尋找「姓名」欄位的索引值
  let nameColIndex = -1;
  for (let c = 0; c < res.headers.length; c++) {
    if (String(res.headers[c]).trim() === '姓名') {
      nameColIndex = c;
      break;
    }
  }

  // 計算每個姓名出現的次數
  const nameCounts = {};
  if (nameColIndex !== -1) {
    res.rows.forEach(row => {
      const nameVal = String(row[nameColIndex] || '').trim();
      if (nameVal) {
        nameCounts[nameVal] = (nameCounts[nameVal] || 0) + 1;
      }
    });
  }

  // 製造表格 HTML
  let html = `
    <table class="detail-table" style="width: 100%; border-collapse: collapse; min-width: 900px; text-align: left; font-size: 0.9em; color: #333;">
      <thead>
        <tr style="background-color: #f1f3f4; border-bottom: 2px solid #ddd;">
  `;

  res.headers.forEach(header => {
    html += `<th style="padding: 10px; border: 1px solid #ddd; word-break: break-all; white-space: normal;" title="${escapeHtml(String(header))}">${escapeHtml(String(header))}</th>`;
  });

  
  // 多加一個操作欄位
  html += `
          <th class="op-col" style="padding: 10px; border: 1px solid #ddd; text-align: center; width: 80px; min-width: 80px;">操作</th>
        </tr>
      </thead>
      <tbody>
  `;

  res.rows.forEach((row, rIndex) => {
    const nameVal = nameColIndex !== -1 ? String(row[nameColIndex] || '').trim() : '';
    const isDuplicate = nameVal && nameCounts[nameVal] > 1;
    
    // 如果是重複的姓名，將此行/儲存格標記背景色
    const rowBg = isDuplicate ? 'background-color: #fce8e6;' : '';

    html += `<tr style="border-bottom: 1px solid #ddd; ${rowBg}">`;
    row.forEach((cell, cIndex) => {
      let cellStyle = 'padding: 10px; border: 1px solid #ddd; word-break: break-all; white-space: pre-line;';
      if (cIndex === nameColIndex && isDuplicate) {
        cellStyle += ' font-weight: bold; color: #d93025;';
      }
      html += `<td style="${cellStyle}">${escapeHtml(String(cell))}</td>`;
    });

    // 刪除按鈕
    html += `
      <td class="op-col" style="padding: 10px; border: 1px solid #ddd; text-align: center; vertical-align: middle;">
        <button class="btn-secondary" style="padding: 3px 8px; font-size: 0.85em; color: #d93025; border-color: #fce8e6; width: auto; display: inline-block;" onclick="handleDeleteResponseRow('${surveyId}', ${rIndex}, '${escapeJs(nameVal)}')">刪除</button>
      </td>
    `;
    html += `</tr>`;
  });

  html += `
      </tbody>
    </table>
  `;

  modal.dataset.title = res.stats.title;
  content.innerHTML = html;
}

function closeResponsesModal() {
  document.getElementById('responsesModal').classList.add('hidden');
}

async function handleDeleteResponseRow(surveyId, rowIndex, name) {
  const warningMsg = `【重要提醒】\n確定要刪除「${name}」的這筆填寫資料嗎？\n刪除後將直接從 Google 試算表移除，且無法恢復！`;
  if (!confirm(warningMsg)) {
    return;
  }

  const user = getCurrentUser();
  const res = await callApi('deleteResponseRow', {
    userName: user.userName,
    deptName: user.deptName,
    surveyId: surveyId,
    rowIndex: rowIndex
  });

  if (res.success) {
    alert("刪除成功！");
    // 重新載入明細，讓列表仍保持連續
    await showResponsesModal(surveyId);
  } else {
    alert(`刪除失敗：${res.message}`);
  }
}

/**
 * 列印回覆明細報表
 */
function printResponses() {
  const modal = document.getElementById('responsesModal');
  const title = modal.dataset.title || '問卷回覆明細';
  const tableHtml = document.getElementById('responsesContent').innerHTML;
  const printArea = document.getElementById('printArea');
  
  printArea.innerHTML = `
    <h2 style="text-align: center; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 10px;">
      ${escapeHtml(title)} - 問卷回覆明細報表
    </h2>
    <div class="print-responses-table">
      ${tableHtml}
    </div>
  `;
  
  window.print();
}

function getShortHeader(header) {
  const h = String(header || '').trim();
  if (h.includes('時間')) return '時間戳記';
  if (h.includes('單位')) return '單位名稱';
  if (h.includes('姓名')) return '姓名';
  if (h.includes('1.本課程內容') || h.includes('預期程度')) return '1.預期達成';
  if (h.includes('2.講師之評價') || h.includes('講師之評價')) return '2.講師評價';
  if (h.includes('3.講師講授內容') || h.includes('整體評價是')) return '3.講授整體';
  if (h.includes('4.課程教材') || h.includes('教材內容之評價')) return '4.教材評價';
  if (h.includes('5.課程硬體') || h.includes('硬體設施與環境')) return '5.硬體環境';
  if (h.includes('6.您個人在') || h.includes('個人在此次訓練')) return '6.個人收穫';
  if (h.includes('7.整體而言') || h.includes('本次訓練的滿意度')) return '7.整體滿意';
  if (h.includes('8.針對課程') || h.includes('8.針對')) return '8.意見回饋';
  if (h.includes('9.您希望未來') || h.includes('9.您希望')) return '9.未來建議';
  return h.length > 15 ? h.substring(0, 15) + '...' : h;
}

// 輔助函式
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
}

function escapeJs(str) {
  if (!str) return '';
  return str.replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/"/g, '\\"');
}
