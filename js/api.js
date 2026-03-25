const API_URL = "https://script.google.com/macros/s/AKfycbzGTJtcHdC1OpAjQITREnM2nywRrGNHLh6nDgojrMCTcpMte5gnlSC1U07FECBafase/exec";

// 共用的 API 呼叫函式
async function callApi(action, payload = {}) {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      // 注意：故意不設 'Content-Type': 'application/json' 以避開 CORS 預檢機制
      body: JSON.stringify({ action: action, ...payload })
    });
    return await response.json();
  } catch (error) {
    console.error(`API 錯誤 (${action}):`, error);
    return { success: false, message: "伺服器連線失敗" };
  }
}

// 取得當前使用者的 Session 資訊 (各頁面共用)
function getCurrentUser() {
  return {
    userName: sessionStorage.getItem('userName'),
    deptName: sessionStorage.getItem('currentDept')
  };
}
