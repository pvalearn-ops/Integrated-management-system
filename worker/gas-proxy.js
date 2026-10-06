/**
 * Cloudflare Worker — GAS API 代理
 *
 * 【為什麼需要這個】
 * GAS 的 /exec 收到請求後不會直接回資料，而是回 302 轉址到 script.googleusercontent.com，
 * 由呼叫端再抓一次才拿到 JSON。當呼叫端是瀏覽器時，第二段屬於跨站請求，
 * Safari 的 ITP 與 Edge 的追蹤防護會偶發攔截，出現 HTTP 404 或連線失敗 ——
 * 但後端其實已經執行成功了（GAS 執行記錄看得到）。
 *
 * 這個 Worker 把整段轉址搬到伺服器端完成。瀏覽器只跟 Worker 溝通，
 * 完全不會接觸 script.googleusercontent.com，那類瀏覽器防護就再也影響不到。
 */

// ── 設定 ──────────────────────────────────────────────
// GAS 網頁應用程式的 /exec 網址（與 js/api.js 原本用的那一組相同）
const GAS_URL = "https://script.google.com/macros/s/AKfycbzGTJtcHdC1OpAjQITREnM2nywRrGNHLh6nDgojrMCTcpMte5gnlSC1U07FECBafase/exec";

// 允許呼叫這個 Worker 的來源。之後若換網域，加在這個陣列裡即可。
const ALLOWED_ORIGINS = [
  "https://pvalearn-ops.github.io"
];

// 伺服器端重試次數。
// 注意：前端 js/api.js 也有重試，兩層會相乘 —— 這裡設 2、前端設 2，
// 最壞情況就是 4 次 GAS 呼叫。不要再往上調，否則失敗時會慢到無法接受。
// 真正會偶發失敗的是 GAS→googleusercontent 那一段，就在這個函式裡面，
// 所以重試放在這裡最有效。
const MAX_ATTEMPTS = 2;
// ─────────────────────────────────────────────────────

// 本機開發用：允許 localhost / 127.0.0.1 的任意連接埠
// (VS Code 的 Live Server 預設是 5500，但換專案時常會變動)。
// 不想開放本機測試時，把這個函式的 return 直接改成 false 即可。
function isLocalOrigin(origin) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function corsHeaders(origin) {
  // 來源不在名單內時，回填名單第一個，瀏覽器會自行擋下不符的回應
  const allow = (ALLOWED_ORIGINS.indexOf(origin) !== -1 || isLocalOrigin(origin))
    ? origin
    : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function jsonResponse(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: Object.assign({}, cors, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    })
  });
}

// 呼叫 GAS。redirect:"follow" 讓轉址在伺服器端完成。
async function callGas(body) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const upstream = await fetch(GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: body,
        redirect: "follow"
      });

      if (upstream.ok) return upstream;
      lastError = new Error("GAS 回應 HTTP " + upstream.status);
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error("未知錯誤");
}

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);

    // CORS 預檢
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    // 健康檢查：用瀏覽器直接打開 Worker 網址時走這裡。
    // 對 GAS 發一次 GET 並原樣回傳，可確認「瀏覽器 → Worker → GAS」整條路是通的。
    // 前端實際運作只會用 POST，這段純粹是給人工測試用。
    if (request.method === "GET") {
      try {
        const upstream = await fetch(GAS_URL, { method: "GET", redirect: "follow" });
        const text = await upstream.text();
        return new Response(text, {
          status: 200,
          headers: Object.assign({}, cors, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
          })
        });
      } catch (err) {
        return jsonResponse({
          success: false,
          message: "健康檢查失敗，Worker 連不到 GAS：" + ((err && err.message) || err)
        }, 502, cors);
      }
    }

    if (request.method !== "POST") {
      return jsonResponse({ success: false, message: "只接受 POST 請求" }, 405, cors);
    }

    try {
      const body = await request.text();
      const upstream = await callGas(body);

      // 直接串流回傳，不在 Worker 內緩衝 ——
      // 會簽 PDF 經 base64 後可能有十幾 MB，緩衝會浪費記憶體與 CPU 時間。
      return new Response(upstream.body, {
        status: 200,
        headers: Object.assign({}, cors, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store"
        })
      });
    } catch (err) {
      return jsonResponse({
        success: false,
        message: "代理呼叫 GAS 失敗：" + ((err && err.message) || err)
      }, 502, cors);
    }
  }
};
