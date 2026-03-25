const user = getCurrentUser();

window.onload = () => {
  if (!user.userName) { window.location.href = "index.html"; return; }
  initDashboard();
};

async function initDashboard() {
  const contentDiv = document.getElementById('dashContent');
  contentDiv.innerHTML = '<p style="text-align:center; color:#8b949e; padding:50px;">載入數據中...</p>';
  document.getElementById('dashName').innerText = user.userName;
  document.getElementById('dashDept').innerText = "部門: " + user.deptName;

  const data = await callApi('getDashboardData', { userName: user.userName, dept: user.deptName });
  
  if(!data.success) {
    contentDiv.innerHTML = `<p style="color:red; text-align:center;">${data.message}</p>`;
    return;
  }
  renderDashboardUI(data);
}

function renderDashboardUI(data) {
  const c = document.getElementById('dashContent');
  let html = "";

  // 1. 關鍵指標
  html += `<div class="metrics-grid">
    <div class="metric-card full-width">
      <span class="m-label">${data.special.loadRatio.label}</span>
      <div style="display:flex; justify-content:space-between; align-items:flex-end;">
        <span class="m-value" style="color:#f2cc60">${data.special.loadRatio.val}</span>
        <span style="font-size:0.8rem; color:#666;">Load Ratio</span>
      </div>
      <div class="progress-bg"><div class="progress-fill" style="width: ${Math.min(data.special.loadRatio.val * 100, 100)}%"></div></div>
    </div>
    <div class="metric-card">
      <span class="m-label">${data.special.inspectionQty.label}</span>
      <span class="m-value">${data.special.inspectionQty.val}</span>
      <span class="m-sub">平均: ${data.special.inspectionQty.avg}</span>
    </div>
    <div class="metric-card">
      <span class="m-label">${data.special.specialTotal.label}</span>
      <span class="m-value" style="font-size:1.4rem; color:#fff;">${data.special.specialTotal.val}</span>
      <span class="m-sub" style="color:#666;">(備註資訊)</span>
    </div>
  </div>`;

  // 2. 各項檢查量 (Skill Bars)
  let maxVal = 0;
  data.numeric.forEach(item => { maxVal = Math.max(maxVal, item.userValue, item.deptAvg); });
  let scaleMax = maxVal > 0 ? maxVal * 1.1 : 10;

  html += `<div class="dash-section-title">各項檢查量</div><div class="skill-bars-container">`;
  data.numeric.forEach(item => {
    let userPct = (item.userValue / scaleMax) * 100;
    let avgPct = (item.deptAvg / scaleMax) * 100;
    html += `
      <div class="sb-row">
        <div class="sb-header"><span class="sb-label">${item.label}</span><span class="sb-val">${item.userValue}</span></div>
        <div class="sb-track">
          <div class="sb-fill" style="width:${userPct}%"></div>
          <div class="sb-avg-marker" style="left:${avgPct}%"></div>
        </div>
        <div class="sb-avg-text">Dept Avg: ${item.deptAvg}</div>
      </div>`;
  });
  html += `</div>`;

  // 3. 讓渡案統計 (僅機械部門)
  if (data.transferStats) {
    html += `<div class="dash-section-title" style="border-color:#a371f7">讓渡案統計</div>`;
    data.transferStats.forEach(p => {
      let isMeClass = p.isMe ? 'me-row' : '';
      html += `
        <div class="transfer-box ${isMeClass}">
          <details>
            <summary class="t-summary">
              <span class="t-name">${p.name}</span><span class="t-total">${p.total} 件</span>
            </summary>
            <div class="t-details">`;
            if(p.breakdown.length === 0) html += `<div style="color:#666; font-size:0.8rem;">無詳細分類</div>`;
            else {
              p.breakdown.forEach(k => {
                html += `<div class="t-type-row"><span>${k.type}</span><span style="color:#fff;">${k.count}</span></div>`;
              });
            }
      html += `</div></details></div>`;
    });

    // 個人清單
    html += `<div class="dash-section-title" style="border-color:#f2cc60">個人讓渡案件</div>
    <div style="overflow-x:auto;"><table class="list-table">
      <thead><tr><th>日期</th><th>文號</th><th>原因</th><th>讓渡態樣</th></tr></thead>
      <tbody>`;
      if(data.personalList.length === 0) html += `<tr><td colspan="4" style="text-align:center; padding:20px; color:#666;">無資料</td></tr>`;
      else {
        data.personalList.forEach(c => {
          html += `<tr><td class="list-date">${c.date}</td><td>${c.docNo}</td><td>${c.reason}</td><td>${c.type}</td></tr>`;
        });
      }
    html += `</tbody></table></div>`;
  }

  // 4. 檢查類別與區域 (狀態燈號)
  html += `<div class="dash-section-title">檢查類別</div><div class="status-grid">`;
  data.typeStatus.forEach(s => {
    let activeClass = s.value ? 'active' : '';
    let valClass = s.value ? 'val-true' : 'val-false';
    let valText = s.value ? 'PASS' : 'NO';
    html += `<div class="status-card ${activeClass}"><span class="status-label">${s.label}</span><div class="status-value ${valClass}" style="font-weight:bold; margin-top:5px;">${valText}</div></div>`;
  });
  html += `</div>`;

  html += `<div class="dash-section-title">檢查區域</div><div class="status-grid">`;
  data.areaStatus.forEach(s => {
    let activeClass = s.value ? 'active' : '';
    let valClass = s.value ? 'val-true' : 'val-false';
    let valText = s.value ? 'PASS' : 'NO';
    html += `<div class="status-card ${activeClass}"><span class="status-label">${s.label}</span><div class="status-value ${valClass}" style="font-weight:bold; margin-top:5px;">${valText}</div></div>`;
  });
  html += `</div>`;

  c.innerHTML = html;
}
