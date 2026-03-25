// 頁面載入時，檢查是否有記憶帳密
window.onload = () => {
  const savedAcc = localStorage.getItem('savedAcc');
  const savedPwd = localStorage.getItem('savedPwd');
  if (savedAcc && savedPwd) {
    document.getElementById('acc').value = savedAcc;
    document.getElementById('pwd').value = savedPwd;
  }
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

  if (res.success) {
    // 登入成功：記憶帳密到 LocalStorage (跨關閉瀏覽器保留)
    localStorage.setItem('savedAcc', acc);
    localStorage.setItem('savedPwd', pwd);
    
    // 將使用者名稱與部門存入 SessionStorage (當次分頁保留)
    sessionStorage.setItem('userName', res.userName);
    sessionStorage.setItem('currentDept', res.department);

    // 導向選單頁面
    window.location.href = "menu.html";
  } else {
    msgLabel.innerText = res.message;
    loginBtn.disabled = false; 
    loginBtn.innerText = "登入";
  }
}
