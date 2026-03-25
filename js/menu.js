window.onload = () => {
  const user = getCurrentUser();
  if (!user.userName) {
    window.location.href = "index.html";
    return;
  }
  
  document.getElementById('menuUser').innerText = user.userName;
  document.getElementById('menuDept').innerText = user.deptName;

  if (user.deptName === "行政") {
    document.getElementById('menuBtnDashboard').style.display = 'none';
  }
};

function logout() {
  sessionStorage.clear();
  window.location.href = "index.html";
}
