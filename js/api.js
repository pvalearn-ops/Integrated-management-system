const API_URL = "https://script.google.com/macros/s/AKfycbzGTJtcHdC1OpAjQITREnM2nywRrGNHLh6nDgojrMCTcpMte5gnlSC1U07FECBafase/exec";

// 共用的 API 呼叫函式
async function callApi(action, payload = {}) {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, ...payload }),
      redirect: 'follow'
    });
    if (!response.ok) {
      return { success: false, message: `伺服器回應異常 (HTTP ${response.status})` };
    }
    return await response.json();
  } catch (error) {
    console.error(`API 錯誤 (${action}):`, error);
    return { success: false, message: "伺服器連線失敗 (" + (error.message || error) + ")" };
  }
}

// 取得當前使用者的 Session 資訊 (各頁面共用)
function getCurrentUser() {
  let permissions = {};
  try {
    permissions = JSON.parse(sessionStorage.getItem('permissions')) || {};
  } catch (e) {
    permissions = {};
  }
  return {
    userName: sessionStorage.getItem('userName'),
    deptName: sessionStorage.getItem('currentDept'),
    permissions: permissions
  };
}
