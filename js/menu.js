window.onload = () => {
  const user = getCurrentUser();
  if (!user.userName) {
    window.location.href = "index.html";
    return;
  }

  document.getElementById('menuUser').innerText = user.userName;
  document.getElementById('menuDept').innerText = user.deptName;
  applyPerms(user.permissions || {});

  // 背景重新驗證：登入頁已改成有紀錄就直接跳過，權限的更新改在這裡默默做。
  // 不阻塞畫面 —— 選單先用上次的權限顯示，驗證結果回來後才修正 (通常沒有變化)。
  refreshSessionInBackground();
};

// 依帳號表 E~L 欄的分項權限顯示/隱藏各功能卡片 (data-perm 對應後端 PERMISSION_COLS)
function applyPerms(perms) {
  // 相容：若無權限資料 (舊版部署)，維持全部顯示，避免整個選單消失
  const hasPerms = Object.keys(perms).length > 0;
  document.querySelectorAll('[data-perm]').forEach((el) => {
    const key = el.getAttribute('data-perm');
    el.style.display = (!hasPerms || perms[key]) ? '' : 'none';
  });
}

function refreshSessionInBackground() {
  const acc = localStorage.getItem('savedAcc');
  const pwd = localStorage.getItem('savedPwd');
  if (!acc || !pwd) return;

  callApi('login', { account: acc, password: pwd }).then(res => {
    if (res && res.success) {
      saveSession(res);
      applyPerms(res.permissions || {});
    } else if (res && res.message === '帳號或密碼錯誤') {
      // 密碼已在帳號表被改掉 → 清除紀錄，回登入頁重新輸入。
      // 只認這個明確訊息；網路暫時失敗不能把人踢出去。
      localStorage.removeItem('savedSession');
      sessionStorage.clear();
      window.location.href = "index.html";
    }
  });
}

function logout() {
  sessionStorage.clear();
  localStorage.removeItem('savedSession');   // 清掉免登入紀錄，回到帳密畫面 (帳密欄位仍會預填)
  window.location.href = "index.html";
}
