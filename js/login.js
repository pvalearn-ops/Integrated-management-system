// js/login.js

// 頁面載入時，檢查是否有記憶帳密
window.onload = () => {
  // 已有登入紀錄 → 直接進選單，完全不等 API (選單頁會在背景重新驗證權限)
  try {
    const saved = JSON.parse(localStorage.getItem('savedSession') || 'null');
    if (saved && saved.userName) {
      window.location.href = "menu.html";
      return;
    }
  } catch (e) {}

  // 預熱：趁使用者輸入帳密的空檔先叫醒 GAS 並載入帳號快取，
  // 避免按下登入時才遇到冷啟動 (閒置後第一次呼叫常要 3~8 秒)。不等結果、失敗也無所謂。
  try {
    fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'warmup' }),
      cache: 'no-store'
    }).catch(() => {});
  } catch (e) {}

  const savedAcc = localStorage.getItem('savedAcc');
  const savedPwd = localStorage.getItem('savedPwd');
  const accInput = document.getElementById('acc');
  const pwdInput = document.getElementById('pwd');

  if (savedAcc && savedPwd) {
    accInput.value = savedAcc;
    pwdInput.value = savedPwd;
  }

  // === 新增：監聽 Enter 鍵觸發登入 ===
  const triggerLoginOnEnter = (e) => {
    if (e.key === 'Enter') {
      handleLogin();
    }
  };

  accInput.addEventListener('keydown', triggerLoginOnEnter);
  pwdInput.addEventListener('keydown', triggerLoginOnEnter);
};

async function handleLogin() {
  const acc = document.getElementById('acc').value.trim();
  const pwd = document.getElementById('pwd').value.trim();
  const loginBtn = document.getElementById('loginBtn');
  const msgLabel = document.getElementById('loginMsg');

  if(!acc || !pwd) { msgLabel.innerText = "請輸入帳號密碼"; return; }
  
  loginBtn.disabled = true; 
  loginBtn.innerText = "驗證中...";
  msgLabel.innerText = "";

  // 瞬間登入：帳密與這台電腦上次驗證成功的相同 → 直接用上次的資料進選單，不等 GAS。
  // 選單頁會在背景重新驗證，若密碼已在帳號表被改掉會自動踢回登入頁。
  try {
    const last = JSON.parse(localStorage.getItem('lastSession') || 'null');
    if (last && last.userName &&
        acc.toLowerCase() === String(localStorage.getItem('savedAcc') || '').toLowerCase() &&
        pwd === localStorage.getItem('savedPwd')) {
      saveSession(last);
      window.location.href = "menu.html";
      return;
    }
  } catch (e) {}

  // 呼叫我們封裝好的 API 函式
  const res = await callApi('login', { account: acc, password: pwd });

  if (res.success && res.userName && res.department) {
    // 登入成功：記憶帳密到 LocalStorage (跨關閉瀏覽器保留)
    localStorage.setItem('savedAcc', acc);
    localStorage.setItem('savedPwd', pwd);

    // 寫入 session + localStorage 登入紀錄 (下次開網頁直接跳過登入頁)
    saveSession(res);
    // 剛剛才驗證過，選單頁不必再背景驗證一次
    sessionStorage.setItem('justVerified', '1');

    // 導向選單頁面
    window.location.href = "menu.html";
  } else {
    msgLabel.innerText = res.message || "登入資訊驗證不完整，請重試";
    loginBtn.disabled = false; 
    loginBtn.innerText = "登入";
  }
}
