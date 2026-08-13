// GAS 網頁應用程式的直連網址。瀏覽器直接打這裡會經過一次跨站 302 轉址，
// 在 Safari / Edge 下偶發被攔截 (見下方說明)，所以正式環境改走 Worker 代理。
const GAS_DIRECT_URL = "https://script.google.com/macros/s/AKfycbzGTJtcHdC1OpAjQITREnM2nywRrGNHLh6nDgojrMCTcpMte5gnlSC1U07FECBafase/exec";

// Cloudflare Worker 代理 (holy-wood-3958.pvalearn.workers.dev)。
// 實測結論 (2026/08)：Edge 對 workers.dev 的請求會不定期延遲 5~13 秒
// (狀態 200、GAS 端僅 0.5 秒，時間耗在瀏覽器與 workers.dev 之間)，
// 反而比直連 GAS 更糟，因此停用、退回直連。偶發 404 由下方的重試機制吸收。
// Worker 保留部署著沒有成本；若日後掛上自訂網域 (與前端同站) 可再啟用。
const WORKER_URL = "";

const API_URL = WORKER_URL || GAS_DIRECT_URL;

// GAS 的 /exec 收到 POST 後不會直接回資料，而是回 302 轉址到 script.googleusercontent.com，
// 瀏覽器再抓一次才拿到 JSON。第二段是跨站請求，在 Safari (ITP) 與 Edge (追蹤防護) 下
// 偶發會拿不到，出現 HTTP 404 / 連線失敗 —— 但後端其實已經執行成功了。
// 這種偶發失敗重送一次通常就會過，所以這裡加上重試與逾時保護。

// 單次嘗試的逾時。大部分動作 1~2 秒就該回來，20 秒還沒回等於已經出事了，
// 沒必要讓使用者乾等。只有大檔 PDF 預覽需要放寬。
const API_TIMEOUT_MS = 20000;
const API_TIMEOUT_LARGE_MS = 60000;
const LARGE_ACTIONS = ['getFileBase64'];

// 注意：Worker (worker/gas-proxy.js) 內部也會重試 2 次，兩層是相乘的。
// 這裡設 2，最壞情況共 4 次 GAS 呼叫。不要再往上調。
const API_MAX_ATTEMPTS = 2;

// 可安全重送的動作：讀取，或「寫入同樣的值」這種重複執行也不會出錯的寫入。
// createSurvey 與 deleteResponseRow 刻意不在名單內 ——
// 前者重送會重複建立問卷，後者以列號刪除，重送會刪到別人的資料。
const RETRYABLE_ACTIONS = [
  'login',
  'getFileList', 'getFileBase64', 'markAsRead',
  'getDutyCalendarData', 'getDutyLog', 'setDutyProxy', 'saveDutyLog',
  'getDashboardData', 'getDispatchData',
  'getSurveyList', 'getSurveyStats', 'deleteSurvey'
];

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// 共用的 API 呼叫函式
async function callApi(action, payload = {}) {
  const attempts = RETRYABLE_ACTIONS.indexOf(action) !== -1 ? API_MAX_ATTEMPTS : 1;
  const timeoutMs = LARGE_ACTIONS.indexOf(action) !== -1 ? API_TIMEOUT_LARGE_MS : API_TIMEOUT_MS;
  const startedAt = Date.now();
  let lastError = "未知錯誤";

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: action, ...payload }),
        redirect: 'follow',
        cache: 'no-store',
        signal: controller.signal
      });

      if (response.ok) {
        const text = await response.text();
        try {
          const data = JSON.parse(text);
          // 把每次呼叫的實際耗時印出來，方便對照 GAS 執行記錄找出時間花在哪一段
          console.log(`[API] ${action} ${Date.now() - startedAt}ms (第 ${attempt} 次嘗試)`);
          return data;
        } catch (parseErr) {
          // 收到 200 卻不是 JSON，通常是 Google 的登入頁或錯誤頁面，
          // 代表部署權限不是「任何人」，或瀏覽器的 Google 登入狀態不同。
          lastError = '伺服器回傳非預期內容，請確認部署權限設為「任何人」';
        }
      } else {
        lastError = `伺服器回應異常 (HTTP ${response.status})`;
      }
    } catch (error) {
      lastError = (error && error.name === 'AbortError')
        ? `伺服器逾時未回應 (超過 ${timeoutMs / 1000} 秒)`
        : `伺服器連線失敗 (${(error && error.message) || error})`;
    } finally {
      clearTimeout(timer);
    }

    if (attempt < attempts) {
      console.warn(`API 重試 (${action}) 第 ${attempt + 1} 次；上次失敗：${lastError}`);
      await delay(600 * attempt);   // 600ms → 1200ms
    }
  }

  console.error(`API 錯誤 (${action}): ${lastError}`);
  return { success: false, message: lastError };
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
