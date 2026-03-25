const user = getCurrentUser();
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth() + 1;

window.onload = () => {
  if (!user.userName) { window.location.href = "index.html"; return; }
  
  document.getElementById('proxyDisplayInfo').innerText = `${user.userName} (${user.deptName})`;
  
  renderCalendar();
  const todayISO = new Date().toLocaleDateString('en-CA');
  document.getElementById('proxyDate').value = todayISO;
  document.getElementById('logDate').value = todayISO;
  loadLogData();
};

function changeMonth(delta) {
  currentMonth += delta;
  if (currentMonth > 12) { currentMonth = 1; currentYear++; }
  if (currentMonth < 1) { currentMonth = 12; currentYear--; }
  renderCalendar();
}

async function renderCalendar() {
  document.getElementById('calTitle').innerText = `${currentYear}年 ${currentMonth}月`;
  const grid = document.getElementById('calendarGrid');
  grid.innerHTML = '<div class="cal-header">日</div><div class="cal-header">一</div><div class="cal-header">二</div><div class="cal-header">三</div><div class="cal-header">四</div><div class="cal-header">五</div><div class="cal-header">六</div>';

  const data = await callApi('getDutyCalendarData', { year: currentYear, month: currentMonth });
  if (!data) return;

  const dataMap = {};
  data.forEach(d => dataMap[d.date] = d);
  const firstDay = new Date(currentYear, currentMonth - 1, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
  const today = new Date(); today.setHours(0,0,0,0);

  for (let i = 0; i < firstDay; i++) grid.innerHTML += '<div></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${currentYear}/${currentMonth}/${d}`;
    const info = dataMap[dateStr];
    const div = document.createElement('div');
    div.className = 'cal-cell';
    
    const checkDate = new Date(currentYear, currentMonth-1, d);
    if (checkDate.toDateString() === new Date().toDateString()) div.classList.add('is-today');

    let content = `<span class="cal-date">${d}</span>`;
    
    if (info) {
      // 機械
      let mechClass = "cal-item";
      let mechShow = info.mech.name;
      if (info.mech.proxy) mechShow = `<span class="has-proxy">${info.mech.proxy}(代)</span>`;
      let isMeMech = (info.mech.name === user.userName || info.mech.proxy === user.userName);
      if (info.mech.missing) {
        if (isMeMech) { mechClass += " me-missing"; mechShow += "(缺)"; }
        else mechClass += " missing-alert";
      } else if (isMeMech) {
        if (checkDate < today) { mechClass += " me-done"; mechShow += "(OK)"; }
        else mechClass += " me-future";
      }
      content += `<div class="${mechClass}" style="color:#0b5394;">機:${mechShow}</div>`;

      // 設備
      let equipClass = "cal-item";
      let equipShow = info.equip.name;
      if (info.equip.proxy) equipShow = `<span class="has-proxy">${info.equip.proxy}(代)</span>`;
      let isMeEquip = (info.equip.name === user.userName || info.equip.proxy === user.userName);
      if (info.equip.missing) {
        if (isMeEquip) { equipClass += " me-missing"; equipShow += "(缺)"; }
        else equipClass += " missing-alert";
      } else if (isMeEquip) {
        if (checkDate < today) { equipClass += " me-done"; equipShow += "(OK)"; }
        else equipClass += " me-future";
      }
      content += `<div class="${equipClass}" style="color:#274e13;">設:${equipShow}</div>`;

      // 行政
      if (info.admin.name || info.admin.proxy) {
        let adminClass = "cal-item";
        let adminShow = info.admin.name;
        if (info.admin.proxy) adminShow = `<span class="has-proxy">${info.admin.proxy}(代)</span>`;
        let isMeAdmin = (info.admin.name === user.userName || info.admin.proxy === user.userName);
        if (isMeAdmin) {
          if (checkDate < today) { adminClass += " me-done"; } 
          else adminClass += " me-future";
        }
        content += `<div class="${adminClass}" style="color:#5e35b1;">行:${adminShow}</div>`;
      }

      // 總機
      if (info.operator) {
        content += `<div class="cal-item" style="color:#d84315; font-weight:bold; font-size: 0.9em; line-height: 1.2;">總:${info.operator}</div>`;
      }

      // 備註
      if (info.note) content += `<span class="cal-note">註:${info.note}</span>`;
    }
    div.innerHTML = content;
    div.onclick = () => {
      const isoDate = `${currentYear}-${String(currentMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      document.getElementById('logDate').value = isoDate;
      loadLogData();
    };
    grid.appendChild(div);
  }
}

async function submitProxy() {
  const dateRaw = document.getElementById('proxyDate').value;
  const date = dateRaw.replace(/-/g, '/').replace(/\/0/g, '/'); 
  if (!confirm(`確定設定自己為 ${date} 的代理人?`)) return;
  
  const res = await callApi('setDutyProxy', { dateStr: date, dept: user.deptName, proxyName: user.userName });
  if(res.success) { alert("設定成功"); renderCalendar(); } 
  else { alert(res.message); }
}

function changeLogDate(delta) {
  const current = new Date(document.getElementById('logDate').value);
  current.setDate(current.getDate() + delta);
  document.getElementById('logDate').value = current.toLocaleDateString('en-CA');
  loadLogData();
}

async function loadLogData() {
  const dateRaw = document.getElementById('logDate').value; 
  const dateStr = dateRaw.replace(/-/g, '/').replace(/\/0/g, '/');
  
  document.getElementById('logTask1').value = "讀取中...";
  document.getElementById('logTask2').value = "讀取中...";
  document.getElementById('logTask1').disabled = true;
  document.getElementById('logTask2').disabled = true;
  document.getElementById('btnSaveLog').disabled = true;
  document.getElementById('logOverlay').classList.add('hidden');
  document.getElementById('logForm').classList.remove('hidden');

  const res = await callApi('getDutyLog', { dateStr: dateStr, dept: user.deptName, userName: user.userName });
  
  if (res.success) {
    if (res.isLocked) {
      document.getElementById('logForm').classList.add('hidden');
      const overlay = document.getElementById('logOverlay');
      overlay.innerText = res.message;
      overlay.classList.remove('hidden');
    } else if (res.isOwner) {
      document.getElementById('logTask1').value = res.task1;
      document.getElementById('logTask2').value = res.task2;
      document.getElementById('logTask1').disabled = false;
      document.getElementById('logTask2').disabled = false;
      document.getElementById('btnSaveLog').disabled = false;
    } else {
      document.getElementById('logForm').classList.add('hidden');
      const overlay = document.getElementById('logOverlay');
      overlay.innerText = res.message || "⚠ 非本日值班人員，無法查看或編輯內容。";
      overlay.classList.remove('hidden');
    }
  } else { alert(res.message); }
}

async function saveLog() {
  const dateRaw = document.getElementById('logDate').value;
  const dateStr = dateRaw.replace(/-/g, '/').replace(/\/0/g, '/');
  const t1 = document.getElementById('logTask1').value;
  const t2 = document.getElementById('logTask2').value;

  document.getElementById('btnSaveLog').innerText = "儲存中...";
  document.getElementById('btnSaveLog').disabled = true;

  const res = await callApi('saveDutyLog', { dateStr: dateStr, dept: user.deptName, userName: user.userName, task1: t1, task2: t2 });
  
  document.getElementById('btnSaveLog').innerText = "儲存日誌";
  document.getElementById('btnSaveLog').disabled = false;
  
  if(res.success) {
    alert("儲存成功！");
    renderCalendar();
  } else { alert(res.message); }
}
