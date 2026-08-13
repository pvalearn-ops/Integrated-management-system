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

  // 呼叫我們封裝好的 API 函式
  const res = await callApi('login', { account: acc, password: pwd });

  if (res.success && res.userName && res.department) {
    // 登入成功：記憶帳密到 LocalStorage (跨關閉瀏覽器保留)
    localStorage.setItem('savedAcc', acc);
    localStorage.setItem('savedPwd', pwd);

    // 寫入 session + localStorage 登入紀錄 (下次開網頁直接跳過登入頁)
    saveSession(res);

    // 導向選單頁面
    window.location.href = "menu.html";
  } else {
    msgLabel.innerText = res.message || "登入資訊驗證不完整，請重試";
    loginBtn.disabled = false; 
    loginBtn.innerText = "登入";
  }
}
