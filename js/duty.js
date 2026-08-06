const user = getCurrentUser();
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth() + 1;

window.onload = async () => {
  if (!user.userName) { window.location.href = "index.html"; return; }
  
  document.getElementById('proxyDisplayInfo').innerText = `${user.userName} (${user.deptName})`;
  
  const todayISO = new Date().toLocaleDateString('en-CA');
  document.getElementById('proxyDate').value = todayISO;
  document.getElementById('logDate').value = todayISO;

  // 依序執行，避免平行發起雙重 POST 導致 GAS 請求互鎖阻塞
  await renderCalendar();
  await loadLogData();
};

function changeMonth(delta) {
  currentMonth += delta;
  if (currentMonth > 12) { currentMonth = 1; currentYear++; }
  if (currentMonth < 1) { currentMonth = 12; currentYear--; }
  renderCalendar();
}

// 當月資料留在前端，代理人/日誌存檔後可以直接重畫，不必再跟後端要一次
let currentMonthData = {};

async function renderCalendar() {
  // 先把標題換掉，讓切換月份當下就有回饋 (資料還在路上)；paintCalendar 之後會再設定一次
  document.getElementById('calTitle').innerText = `${currentYear}年 ${currentMonth}月`;

  const data = await callApi('getDutyCalendarData', { year: currentYear, month: currentMonth });
  if (!data) return;

  // 後端出錯時回傳的是 { success:false, message }，不是陣列。
  // 沒有這道檢查會靜靜畫出一個空月曆，看起來像「這個月沒有排班」。
  if (!Array.isArray(data)) {
    const grid = document.getElementById('calendarGrid');
    grid.innerHTML = `<div style="grid-column:1/-1; color:#d93025; padding:20px; text-align:center;">值班表讀取失敗：${data.message || '未知錯誤'}</div>`;
    return;
  }

  currentMonthData = {};
  data.forEach(d => currentMonthData[d.date] = d);
  paintCalendar();
}

function paintCalendar() {
  document.getElementById('calTitle').innerText = `${currentYear}年 ${currentMonth}月`;
  const grid = document.getElementById('calendarGrid');
  grid.innerHTML = '<div class="cal-header">日</div><div class="cal-header">一</div><div class="cal-header">二</div><div class="cal-header">三</div><div class="cal-header">四</div><div class="cal-header">五</div><div class="cal-header">六</div>';

  const firstDay = new Date(currentYear, currentMonth - 1, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
  const today = new Date(); today.setHours(0,0,0,0);

  // 先組進 fragment 再一次掛上；原本在迴圈裡用 innerHTML += 會每加一格就重新解析整個月曆
  const frag = document.createDocumentFragment();
  for (let i = 0; i < firstDay; i++) frag.appendChild(document.createElement('div'));

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${currentYear}/${currentMonth}/${d}`;
    const info = currentMonthData[dateStr];
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
    frag.appendChild(div);
  }

  grid.appendChild(frag);
}

async function submitProxy() {
  const dateRaw = document.getElementById('proxyDate').value;
  const date = dateRaw.replace(/-/g, '/').replace(/\/0/g, '/'); 
  if (!confirm(`確定設定自己為 ${date} 的代理人?`)) return;
  
  const res = await callApi('setDutyProxy', { dateStr: date, dept: user.deptName, proxyName: user.userName });
  if (res.success) {
    alert("設定成功");
    // 本地更新後重畫即可，不必再打一次 API 把整個月拉回來
    if (updateLocalDuty(date, d => {
      if (user.deptName === '機械') d.mech.proxy = user.userName;
      else if (user.deptName === '設備') d.equip.proxy = user.userName;
      else if (user.deptName === '行政') d.admin.proxy = user.userName;
    })) {
      paintCalendar();
    } else {
      renderCalendar();   // 設定的日期不在目前顯示的月份，才需要重新取得
    }
  } else { alert(res.message); }
}

// 就地修改當月快取中的某一天。回傳 false 代表那天不在目前顯示的月份。
function updateLocalDuty(dateStr, mutate) {
  const info = currentMonthData[dateStr];
  if (!info) return false;
  mutate(info);
  return true;
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
  
  if (res.success) {
    alert("儲存成功！");

    // 有填內容 → 必定不再是「缺」，本地改一下重畫就好，省掉一趟往返。
    // 清空內容 → 是否算「缺」還要看日期是否已過、當天是否為假日，
    //            這些規則在後端 (getDutyCalendarData)，前端不重算以免判斷不一致。
    const hasContent = String(t1 || "").trim() !== "" || String(t2 || "").trim() !== "";
    const painted = hasContent && updateLocalDuty(dateStr, d => {
      if (user.deptName === '機械') d.mech.missing = false;
      else if (user.deptName === '設備') d.equip.missing = false;
    });

    if (painted) paintCalendar();
    else renderCalendar();
  } else { alert(res.message); }
}
