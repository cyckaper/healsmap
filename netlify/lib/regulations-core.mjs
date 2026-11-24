/* 法規檢索 · 影響分析:核心邏輯(由 netlify/functions/regulations-start.mjs 呼叫)
 *
 * 流程:Claude 以伺服器端 web_search / web_fetch 只在官方法規網站(全國法規資料庫、
 * 國土管理署、基地所在縣市政府)檢索 → 讀取條文頁 → 整理「對本基地未來規劃設計有影響
 * 的法條」與影響分析(Markdown)。進度與結果寫入 Netlify Blobs,前端輪詢讀取。
 *
 * 執行時間常超過 Netlify 同步 / 串流 Function 的 60 秒上限,所以由背景 Function
 * (上限 15 分鐘)執行;本檔不依賴 Netlify 執行環境,client / store 由呼叫端注入,方便測試。
 */

export const MODEL = "claude-opus-5-5";
export const STORE_NAME = "regulation-jobs";
export const JOB_TTL_MS = 7 * 24 * 3600 * 1000; // 工作紀錄保留 7 天,之後於下一次執行時清除

// 工作代號:前端產生「時間戳(base36)-隨機字串」,後端只接受此格式(避免任意 key)
const JOB_ID_RE = /^[0-9a-z]{6,12}-[0-9a-z]{6,24}$/;
export function isValidJobId(id) { return typeof id === "string" && JOB_ID_RE.test(id); }
export function jobAgeMs(id, now) {
  const ts = parseInt(String(id).split("-")[0], 36);
  return isFinite(ts) ? now - ts : Infinity;
}

// 只允許官方網站:全國法規資料庫、內政部國土管理署(營建法規、函釋),以及基地所在縣市政府網域
// (含其法規查詢系統等子網域;allowed_domains 會一併涵蓋子網域)
const CENTRAL_DOMAINS = ["law.moj.gov.tw", "nlma.gov.tw"];
const COUNTY_DOMAINS = {
  "臺北市": "gov.taipei", "新北市": "ntpc.gov.tw", "桃園市": "tycg.gov.tw", "臺中市": "taichung.gov.tw",
  "臺南市": "tainan.gov.tw", "高雄市": "kcg.gov.tw", "基隆市": "klcg.gov.tw", "新竹市": "hccg.gov.tw",
  "新竹縣": "hsinchu.gov.tw", "苗栗縣": "miaoli.gov.tw", "彰化縣": "chcg.gov.tw", "南投縣": "nantou.gov.tw",
  "雲林縣": "yunlin.gov.tw", "嘉義市": "chiayi.gov.tw", "嘉義縣": "cyhg.gov.tw", "屏東縣": "pthg.gov.tw",
  "宜蘭縣": "e-land.gov.tw", "花蓮縣": "hl.gov.tw", "臺東縣": "taitung.gov.tw", "澎湖縣": "penghu.gov.tw",
  "金門縣": "kinmen.gov.tw", "連江縣": "matsu.gov.tw"
};
export function normCounty(s) { return String(s || "").replace(/台/g, "臺").trim(); }
export function allowedDomainsFor(county) {
  const d = COUNTY_DOMAINS[normCounty(county)];
  return d ? CENTRAL_DOMAINS.concat([d]) : CENTRAL_DOMAINS.slice();
}

// ---- 輸入整理:只取需要的欄位、限制長度,避免把整包資料或超長文字送進模型 ----
const clip = (v, n) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim().slice(0, n));
const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
function pick(obj, keys) {
  const out = {};
  if (!obj || typeof obj !== "object") return out;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
    else if (typeof v === "string" && v.trim()) out[k] = clip(v, 60);
  }
  return out;
}
export function sanitizeRequest(body) {
  const b = body && typeof body === "object" ? body : {};
  const s = b.site || {};
  const ind = b.indicators || {};
  const inp = b.inputs || {};
  const site = {
    county: normCounty(clip(s.county, 10)),
    town: clip(s.town, 12),
    village: clip(s.village, 12),
    place: clip(s.place, 80),
    lat: num(s.lat), lng: num(s.lng),
    mode: s.mode === "site" ? "site" : "point",
    area_ha: num(s.area_ha),
    radius_m: num(s.radius_m)
  };
  const indicators = {
    population: pick(ind.population, ["pop", "density", "aging_index", "elderly_share", "child_share"]),
    green: pick(ind.green, ["green_coverage_pct", "site_green_coverage_pct", "nearest_park_dist_m", "park_count_500m",
      "park_count_in_site", "has_300m_park_access"]),
    ndvi: pick(ind.ndvi, ["dense_veg_pct_ndvi_ge_0_6", "veg_cover_pct_ndvi_ge_0_2", "scene_date"]),
    heat: pick(ind.heat, ["vulnerability_level", "green_coverage_pct"]),
    healing_green_intervention: pick(ind.healing_green_intervention, ["index", "priority_level", "dominant_factor"]),
    openspace_service_level: pick(ind.openspace_service_level, ["overall", "band"])
  };
  for (const k of Object.keys(indicators)) if (!Object.keys(indicators[k]).length) delete indicators[k];
  const inputs = { zoning: clip(inp.zoning, 60), use: clip(inp.use, 80), notes: clip(inp.notes, 300) };
  return { lang: b.lang === "en" ? "en" : "zh", site, indicators, inputs };
}

// ---- 提示詞 ----
const SYSTEM_ZH = `你是臺灣的都市計畫、建築與景觀規劃法規研究助理。使用者在做基地分析與規劃,請你檢索與這個基地「未來開發與規劃設計」相關的現行法規,找出會實際影響規劃設計的法條,並逐條分析其影響。

檢索方法:
1. 用 web_search 搜尋法規;搜尋範圍已限制在官方網站(全國法規資料庫 law.moj.gov.tw、內政部國土管理署、基地所在縣市政府網域,含其法規查詢系統)。中央法規以全國法規資料庫為準;地方自治條例(土地使用分區管制、都市設計審議、樹木保護、公園管理等)查所在縣市網域。
2. 引用任何條文前,先用 web_fetch 讀取該條文頁面(例:全國法規資料庫的單條頁 LawSingle.aspx?pcode=…&flno=…,或法規全文頁),確認條號與現行內容。
3. 依基地條件判斷適用性:所在縣市、使用分區 / 用地(使用者提供者為準;未提供時不可自行假設,改列為「需確認」)、預定用途、基地面積(點模式為半徑範圍、非基地面積)、以及分析指標透露的設計重點(綠地不足、高齡比例高、熱脆弱度高等)。
4. 可考慮的面向(只挑真正相關的):土地使用分區管制(容許使用、建蔽率、容積率)、公共設施用地與通盤檢討標準(公園、綠地、兒童遊樂場)、都市設計審議、建築基地綠化與保水(綠建築)、無障礙設施、樹木保護、公園管理、環境影響評估(依開發類型與規模門檻)、山坡地 / 水土保持 / 地質敏感區、文化資產、都市更新與容積獎勵、與預定用途相關的設施設置標準(例:長照、托育、社福設施)。
5. 搜尋次數有限,先查最關鍵的 3–5 部法規,再補地方自治條例;同一部法規的多個條文可一次讀取全文頁。

嚴格規則:
- 只能引用你在本次搜尋 / 讀取結果中實際看到條文內容的法條;數字(建蔽率、面積門檻、比例)必須來自讀到的條文,不可憑記憶補數字。
- 認為相關但沒有讀到條文的法規,不要寫條號與內容,只列在「需進一步確認的事項」。
- 每條附上來源連結(Markdown 連結,指向你讀到的官方頁面)。
- 地方法規以基地所在縣市為準,不要套用其他縣市的規定。
- 寫明是法規「要求」(強制)、「審議 / 審查」(程序)、還是「準則 / 獎勵」(參考 / 選擇性)。

輸出格式(繁體中文、Markdown,不要輸出 H1 / H2 大標題,也不要在開頭寫搜尋過程):
### 檢索範圍與適用前提
2–4 點:基地位置、使用分區 / 用地(未提供就寫「未提供,需以都市計畫書圖確認」)、預定用途、面積與分析重點;說明你據此判斷的適用前提。
### 影響規劃設計的法條
依面向分組(#### 1. 土地使用與開發強度 等,只列有內容的面向),每一條:
- **法規名稱 第 N 條**([來源](網址))· 性質:強制 / 審議 / 參考
  - 規定要旨:1–2 句,關鍵數字與條件照條文。
  - 對本基地的影響:1–2 句,扣回基地條件與分析數據。
  - 規劃設計因應:1–2 句,具體可執行的設計或程序對策。
共 6–12 條,依影響程度排序(影響大者在前)。
### 需進一步確認的事項
2–5 點:例如實際使用分區與都市計畫書圖、是否位於地質敏感區或山坡地(可開本工具的地質疊圖)、是否達環評或都市設計審議門檻、未能讀到條文的法規。
### 說明
原文照抄這一句:「本分析由 AI 檢索官方法規網站整理,僅供規劃初期參考,不構成法律意見;法規可能修正,實際適用請以主管機關公告及最新條文為準。」

全文約 1000–1600 字,精煉、具體,不要重複基地數據。`;

const SYSTEM_EN = `You are a research assistant for Taiwan's urban planning, building and landscape regulations. The user is analysing and planning a site. Search the current regulations that bear on this site's future development and design, find the articles that would actually affect planning and design, and analyse each one.

Method:
1. Use web_search to find regulations; searches are restricted to official sites (the Laws & Regulations Database law.moj.gov.tw, the National Land Management Agency, and the site's city/county government domain including its local regulations system). Central laws: use the Laws & Regulations Database; local ordinances (zoning control, urban design review, tree protection, park management, etc.): use the city/county domain.
2. Before citing any article, use web_fetch to read its page (e.g. a single-article page LawSingle.aspx?pcode=…&flno=… or the full-text page) to confirm the article number and current wording.
3. Judge applicability from the site: city/county, zoning / land designation (use what the user supplied; if none, do not assume—list it under items to confirm), intended use, area (in point mode the radius is a study area, not the site area), and design priorities suggested by the indicators (green-space deficit, high elderly share, heat vulnerability, etc.).
4. Candidate topics (only those that truly apply): zoning control (permitted uses, building coverage, floor-area ratio), public-facility land and plan-review standards (parks, green space, playgrounds), urban design review, site greening and water retention (green building), accessibility, tree protection, park management, environmental impact assessment (by project type and size thresholds), slope land / soil and water conservation / geologically sensitive areas, cultural heritage, urban renewal and FAR bonuses, facility standards tied to the intended use (e.g. long-term care, childcare, social welfare).
5. Searches are limited: cover the 3–5 most important laws first, then local ordinances; read a law's full-text page once to cover several of its articles.

Strict rules:
- Cite only articles whose text you actually saw in this session's search or fetch results; numbers (coverage ratios, area thresholds, percentages) must come from the text you read, never from memory.
- If you think a regulation applies but did not read its text, do not give article numbers or content—list it under items to confirm.
- Give a source link for every article (Markdown link to the official page you read).
- Use the local ordinances of the site's own city/county only.
- State whether each article is a requirement (mandatory), a review / approval procedure, or a guideline / incentive (optional).

Output (English, Markdown; Taiwanese law names in Chinese with an English gloss; no H1/H2 headings; do not narrate the search):
### Scope and assumptions
2–4 bullets: location, zoning / land designation (if not supplied: "not supplied—confirm with the urban plan maps"), intended use, area and analysis priorities; the assumptions you applied.
### Articles affecting planning and design
Grouped by topic (#### 1. Land use and development intensity, etc.; only topics with content), each article:
- **Law name, Article N** ([source](url)) · Type: mandatory / review / guideline
  - Requirement: 1–2 sentences, key figures and conditions as written.
  - Effect on this site: 1–2 sentences, tied to the site's conditions and data.
  - Planning and design response: 1–2 sentences, concrete design or procedural actions.
6–12 articles, most influential first.
### Items to confirm
2–5 bullets: e.g. actual zoning and urban plan maps, whether the site lies in a geologically sensitive area or slope land (see this tool's geology overlays), whether EIA or urban design review thresholds are met, laws whose text could not be read.
### Note
Copy this sentence verbatim: "This analysis was compiled by AI from official regulation websites for early-stage planning reference only and is not legal advice; regulations may be amended—confirm applicability with the competent authority and the latest text."

About 700–1100 words; concise and specific; do not repeat the site data.`;

export function buildUserContent(req, today) {
  const { lang, site, indicators, inputs } = req;
  const zh = lang !== "en";
  const loc = [site.county, site.town, site.village].filter(Boolean).join(" ");
  const L = [];
  if (zh) {
    L.push("查詢日期:" + today);
    L.push("基地位置:" + (loc || "未知") + (site.place ? "(" + site.place + ")" : ""));
    if (site.lat != null && site.lng != null) L.push("座標:" + site.lat + "°N, " + site.lng + "°E");
    L.push(site.mode === "site"
      ? "範圍:使用者繪製之基地範圍" + (site.area_ha != null ? ",面積約 " + site.area_ha + " 公頃" : "")
      : "範圍:點位(周邊 " + (site.radius_m || 500) + " m 分析範圍,非基地面積)");
    L.push("使用分區 / 用地(使用者提供):" + (inputs.zoning || "未提供"));
    L.push("預定開發 / 規劃用途(使用者提供):" + (inputs.use || "未提供"));
    if (inputs.notes) L.push("補充說明(使用者提供):" + inputs.notes);
  } else {
    L.push("Date of search: " + today);
    L.push("Site location: " + (loc || "unknown") + (site.place ? " (" + site.place + ")" : ""));
    if (site.lat != null && site.lng != null) L.push("Coordinates: " + site.lat + "°N, " + site.lng + "°E");
    L.push(site.mode === "site"
      ? "Extent: user-drawn site boundary" + (site.area_ha != null ? ", about " + site.area_ha + " ha" : "")
      : "Extent: point (" + (site.radius_m || 500) + " m study radius, not the site area)");
    L.push("Zoning / land designation (user supplied): " + (inputs.zoning || "not supplied"));
    L.push("Intended development / use (user supplied): " + (inputs.use || "not supplied"));
    if (inputs.notes) L.push("Notes (user supplied): " + inputs.notes);
  }
  const head = zh
    ? "請檢索並分析與這個基地未來規劃設計相關的法規。\n\n"
    : "Please search and analyse the regulations relevant to this site's future planning and design.\n\n";
  const tail = Object.keys(indicators).length
    ? (zh ? "\n\n基地分析指標(供判斷設計重點,JSON):\n" : "\n\nSite indicators (to judge design priorities, JSON):\n") +
      "```json\n" + JSON.stringify(indicators, null, 1) + "\n```"
    : "";
  return head + L.join("\n") + tail;
}

export function buildParams(req, messages) {
  const domains = allowedDomainsFor(req.site.county);
  return {
    model: MODEL,
    max_tokens: 16000,
    // 拒答時由 API 依類別自動改用建議的備援模型(伺服器端 fallback,同一次請求內完成)
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium" },
    system: [{ type: "text", text: req.lang === "en" ? SYSTEM_EN : SYSTEM_ZH, cache_control: { type: "ephemeral" } }],
    tools: [
      { type: "web_search_20260209", name: "web_search", max_uses: 6, allowed_domains: domains },
      { type: "web_fetch_20260209", name: "web_fetch", max_uses: 8, allowed_domains: domains, max_content_tokens: 8000 }
    ],
    messages
  };
}

// ---- 從回應整理來源:實際讀取的頁面(web_fetch)+ 文字引用的搜尋結果 ----
export function collectSources(contents) {
  const seen = new Map();
  const add = (url, title) => {
    if (!url || !/^https?:\/\//i.test(url)) return;
    if (!seen.has(url)) seen.set(url, { url, title: clip(title, 120) || url });
    else if (title && seen.get(url).title === url) seen.get(url).title = clip(title, 120);
  };
  for (const content of contents) {
    for (const b of content || []) {
      if (b.type === "web_fetch_tool_result" && b.content && b.content.type === "web_fetch_result") {
        add(b.content.url, b.content.content && b.content.content.title);
      } else if (b.type === "text" && Array.isArray(b.citations)) {
        for (const c of b.citations) if (c && c.type === "web_search_result_location") add(c.url, c.title);
      }
    }
  }
  return Array.from(seen.values()).slice(0, 40);
}

// 最終回覆 = 最後一次工具呼叫 / 結果之後的文字(避免把檢索途中的過場文字混進報告);
// 找不到工具區塊時取全部文字
const isToolBlock = (b) => b && (b.type === "server_tool_use" || /_tool_result$/.test(b.type || ""));
export function finalText(contents) {
  const blocks = [].concat(...contents.map((c) => c || []));
  let last = -1;
  blocks.forEach((b, i) => { if (isToolBlock(b)) last = i; });
  const pick = (arr) => arr.filter((b) => b.type === "text" && b.text).map((b) => b.text).join("").trim();
  return pick(blocks.slice(last + 1)) || pick(blocks);
}

// Claude Opus 5.5 牌價(US$ / 百萬 token)與 web search(US$10 / 千次);僅供顯示估算
const PRICE = { in: 4, out: 20, cacheWrite: 5, cacheRead: 0.2, search: 0.01 };
function addUsage(acc, u) {
  if (!u) return;
  acc.input_tokens += u.input_tokens || 0;
  acc.output_tokens += u.output_tokens || 0;
  acc.cache_creation_input_tokens += u.cache_creation_input_tokens || 0;
  acc.cache_read_input_tokens += u.cache_read_input_tokens || 0;
  if (u.server_tool_use) {
    acc.web_search_requests += u.server_tool_use.web_search_requests || 0;
    acc.web_fetch_requests += u.server_tool_use.web_fetch_requests || 0;
  }
}
function estimateUsd(u) {
  return +((u.input_tokens * PRICE.in + u.output_tokens * PRICE.out +
    u.cache_creation_input_tokens * PRICE.cacheWrite + u.cache_read_input_tokens * PRICE.cacheRead) / 1e6 +
    u.web_search_requests * PRICE.search).toFixed(3);
}

const MAX_CONTINUATIONS = 4; // 伺服器端工具迴圈達上限時回 pause_turn,最多續跑 4 次

/* 執行一次法規檢索工作。
 * deps: { client: Anthropic, store: { setJSON(key, value) }, now?: () => number, log?: fn }
 * 回傳最後寫入的狀態物件。 */
export async function runRegulationJob(jobId, body, deps) {
  const { client, store } = deps;
  const now = deps.now || (() => Date.now());
  const log = deps.log || (() => {});
  const req = sanitizeRequest(body);
  const startedAt = new Date(now()).toISOString();
  const state = {
    state: "running", jobId, startedAt, lang: req.lang,
    domains: allowedDomainsFor(req.site.county), steps: []
  };
  let lastWrite = 0, writing = Promise.resolve();
  const save = (force) => {
    const t = now();
    if (!force && t - lastWrite < 1500) return writing; // 進度寫入節流
    lastWrite = t;
    const snapshot = JSON.parse(JSON.stringify(state));
    writing = writing.then(() => store.setJSON(jobId, snapshot)).catch((e) => log("blob write failed", e));
    return writing;
  };
  await save(true);

  const today = new Date(now()).toISOString().slice(0, 10);
  const messages = [{ role: "user", content: buildUserContent(req, today) }];
  const contents = [];
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
    web_search_requests: 0, web_fetch_requests: 0 };
  let final = null;

  try {
    for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
      const stream = client.beta.messages.stream(buildParams(req, messages));
      stream.on("contentBlock", (block) => {
        if (block && block.type === "server_tool_use" && (block.name === "web_search" || block.name === "web_fetch")) {
          const inp = block.input || {};
          state.steps.push({ tool: block.name, q: clip(inp.query || inp.url || "", 160) });
          if (state.steps.length > 40) state.steps.shift();
          save(false);
        }
      });
      const msg = await stream.finalMessage();
      addUsage(usage, msg.usage);
      contents.push(msg.content);
      final = msg;
      if (msg.stop_reason === "pause_turn") {
        // 伺服器端工具迴圈暫停:把助理回合原樣送回,伺服器會從中斷處繼續(不要另加 user 訊息)
        messages.push({ role: "assistant", content: msg.content });
        continue;
      }
      break;
    }

    if (final && final.stop_reason === "refusal") {
      state.state = "error";
      state.error = req.lang === "en" ? "The model declined this request." : "模型拒絕處理這個請求。";
    } else {
      const markdown = finalText(contents);
      if (!markdown) throw new Error(final && final.stop_reason === "pause_turn"
        ? "search did not finish (pause_turn limit)" : "empty response");
      state.state = "done";
      state.markdown = markdown;
      state.truncated = !!(final && final.stop_reason === "max_tokens");
      state.sources = collectSources(contents);
    }
  } catch (e) {
    state.state = "error";
    state.error = String((e && e.message) || e).slice(0, 400);
    log("regulation job failed", e);
  }

  state.finishedAt = new Date(now()).toISOString();
  state.model = final && final.model ? final.model : MODEL;
  state.usage = Object.assign({}, usage, { est_usd: estimateUsd(usage) });
  log("[regulations usage] " + JSON.stringify({ jobId, model: state.model, state: state.state, ...state.usage }));
  await save(true);
  return state;
}
