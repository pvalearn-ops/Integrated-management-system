window.onload = () => {
  const user = getCurrentUser();
  if (!user.userName) {
    window.location.href = "index.html";
    return;
  }

  document.getElementById('menuUser').innerText = user.userName;
  document.getElementById('menuDept').innerText = user.deptName;

  // 依帳號表 E~L 欄的分項權限顯示/隱藏各功能。
  // 每個功能卡片以 data-perm="key" 標記，key 對應後端 PERMISSION_COLS。
  const perms = user.permissions || {};
  // 相容：若後端尚未回傳權限資料 (舊版部署)，則維持原本全部顯示，避免整個選單消失。
  const hasPerms = Object.keys(perms).length > 0;
  document.querySelectorAll('[data-perm]').forEach((el) => {
    const key = el.getAttribute('data-perm');
    el.style.display = (!hasPerms || perms[key]) ? '' : 'none';
  });
};

function logout() {
  sessionStorage.clear();
  window.location.href = "index.html";
}
