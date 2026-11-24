/* Netlify 背景 Function:POST /api/regulations/start
 * 法規檢索 · 影響分析。前端送出 { jobId, lang, site, indicators, inputs } 後立即得到 202;
 * 本函式在背景(上限 15 分鐘)呼叫 Claude(伺服器端 web_search / web_fetch,只限官方法規網站),
 * 把進度與結果寫入 Netlify Blobs(store: regulation-jobs, key: jobId),
 * 前端以 GET /api/regulations/status?id=jobId 輪詢讀取。
 * 金鑰:環境變數 ANTHROPIC_API_KEY(與 /api/analyze 共用)。
 */
import Anthropic from "@anthropic-ai/sdk";
import { getStore } from "@netlify/blobs";
import { runRegulationJob, isValidJobId, jobAgeMs, STORE_NAME, JOB_TTL_MS } from "../lib/regulations-core.mjs";

const envGet = (k) => (globalThis.Netlify && Netlify.env ? Netlify.env.get(k) : process.env[k]);

// 清除超過保留期的舊工作(key 開頭為建立時間,無需逐筆讀取 metadata)
async function cleanup(store) {
  try {
    const { blobs } = await store.list();
    const now = Date.now();
    await Promise.all(blobs
      .filter((b) => jobAgeMs(b.key, now) > JOB_TTL_MS)
      .slice(0, 50)
      .map((b) => store.delete(b.key)));
  } catch (e) {
    console.warn("[regulations] cleanup failed:", (e && e.message) || e);
  }
}

export default async (req) => {
  if (req.method !== "POST") return; // 背景函式的回傳值不會送到前端
  let body;
  try { body = await req.json(); } catch (e) { console.warn("[regulations] bad JSON body"); return; }
  const jobId = body && body.jobId;
  if (!isValidJobId(jobId)) { console.warn("[regulations] invalid jobId"); return; }

  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  const apiKey = envGet("ANTHROPIC_API_KEY");
  if (!apiKey) {
    await store.setJSON(jobId, {
      state: "error", jobId,
      error: "伺服器尚未設定 ANTHROPIC_API_KEY(請於 Netlify 後台設定環境變數)。",
      finishedAt: new Date().toISOString()
    });
    return;
  }

  const client = new Anthropic({ apiKey });
  await runRegulationJob(jobId, body, {
    client, store,
    log: (...a) => console.log(...a.map((x) => (x instanceof Error ? x.message : x)))
  });
  await cleanup(store);
};

export const config = { background: true, path: "/api/regulations/start" };
