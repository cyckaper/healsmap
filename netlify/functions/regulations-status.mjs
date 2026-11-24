/* Netlify Function:GET /api/regulations/status?id=jobId
 * 回傳法規檢索工作的進度 / 結果(由 regulations-start 背景函式寫入 Netlify Blobs)。
 * 尚未寫入(背景函式剛啟動)時回 { state: "queued" }。
 */
import { getStore } from "@netlify/blobs";
import { isValidJobId, STORE_NAME } from "../lib/regulations-core.mjs";

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

export default async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!isValidJobId(id)) return json({ error: "invalid id" }, 400);
  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  const data = await store.get(id, { type: "json" });
  return json(data || { state: "queued", jobId: id });
};

export const config = { path: "/api/regulations/status" };
