/* Netlify Function: POST /api/analyze
 * 與 Cloudflare 版同邏輯,改用 Netlify Functions 2.0(標準 Request/Response + process.env)。
 * 金鑰存於環境變數 ANTHROPIC_API_KEY(於 Netlify 後台設定,前端不外露)。
 */

// 用 Haiku 4.5:Netlify 免費方案 Function 有 10 秒「總執行時間」硬上限,
// 七節報告以 Sonnet 串流常超時被砍斷(連尾端用量都送不出);Haiku 4.5 速度約
// 2-3 倍且品質足夠此結構化任務,可在 10 秒內穩定完成。
const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `你是台灣的都市規劃與基地分析助理。請依使用者提供的「真實數值(JSON)」撰寫一份基地分析報告。輸出語言:依使用者指示(繁體中文或 English),未指定時用繁體中文。

嚴格規則:
1. 只能根據提供的數值與下列法規/準則進行解讀,不可自行編造任何數字、人口、面積或法條。
2. 數值缺漏(null 或「—」)時,明白指出「資料不足」,不要臆測。
3. 綠地、綠覆率來自 OpenStreetMap 即時查詢,屬「下限估計」,可能不完整;熱環境/健康為「研判」,非實測氣溫或疾病數據——報告中須明確標示這些限制。
4. 引用法規時使用下方提供的條文,不要引用未提供的細部數字或地方自治條例。

可引用的法規與準則:
- 都市計畫法 §45:公園、綠地、廣場、兒童遊樂場用地占用土地總面積不得少於全部計畫面積 10%。
- 都市計畫定期通盤檢討實施辦法:兒童遊樂場每處 ≥0.1 公頃;閭鄰公園每處 ≥0.5 公頃;社區公園(10萬人以上計畫處所)≥4 公頃。
- 3-30-300 綠地準則(實證導向):住家可見 3 棵樹、鄰里 30% 樹冠覆蓋、住家 300 公尺內有綠地/公園。
- 老化指數 = 65歲以上人口 ÷ 0-14歲人口 ×100;扶養比、扶幼比、扶老比為人口依賴負擔指標。

5. 若提供 biodiversity 欄位,以其物種數、觀測筆數、受脅物種數、分類群組成評估生態現況。【重要】詳細的物種名錄(代表性物種、受脅物種清單)已另以表格完整呈現,你在敘述中「不要」逐一列舉或複製物種名單;僅就整體生態特徵做定性說明(分類群是否均衡、是否有指標性類群、受脅物種數量所反映的保育意義),至多點到 1-2 種最具代表性者即可。iNaturalist 為社群觀測,涵蓋度依地區而異,屬參考性指標而非完整生態調查,須標示此限制。
6. 若提供 climate 欄位(Open-Meteo ERA5 重分析之多年平均背景值,非即時天氣),依年均溫、最熱月均溫、高溫日數、年降雨量、盛行風向、日均日射量,推導對基地設計的微氣候意涵:通風廊道與開窗方位(對應盛行風向)、遮蔭與植栽(對應高溫日數與日射量)、排水/滯洪(對應年降雨量)、氣候韌性。引用時標明為「氣候背景值」。
7. 若提供 openspace_service_level 欄位(開放空間服務水準),以其總分(overall,0-100)、等級(band)及五面向(綠地公園、運動遊憩、自行車步道、大眾運輸、公廁)的最近距離與數量,評估步行 10 分鐘生活圈的開放空間可及性與服務完整度;指出短板面向並對應規劃建議。此為 OSM/Overpass 即時查詢之下限估計,須標示限制。
8. 若提供 healing_green_intervention 欄位(療癒綠地介入需求指數),以其 index(0-100)、priority_level 與 dominant_factor(主導因子:green=綠地匱乏、vuln=脆弱族群、heat=熱壓力、access=可及性不足)研判此基地導入「療癒性綠地/療癒景觀」的優先程度,並針對主導因子提出對應的療癒景觀設計策略(如:面向高齡與幼童的療癒花園、林蔭降溫廊道、可及的鄰里口袋綠地、感官與復癒性植栽)。此為多因子加權之研判性指標,非實測健康數據,須標示為研判。
9. 若提供 air_quality 欄位(環境部最近測站即時空氣品質),以其 aqi、status、pm25、main_pollutant 與測站距離(distance_km)說明基地周邊空氣品質現況,並結合綠地/植栽提出對應建議(如:臨路綠籬與喬木對微粒的攔截、避免在高污染時段的開放活動設計)。須標示為「最近測站」之即時參考(每小時更新),測站距基地有距離、非基地實測。
10. 若提供 ndvi 欄位(Copernicus Sentinel-2 L2A 衛星影像、10 m 像元計算之 NDVI),以 scene_date、mean/median、veg_cover_pct_ndvi_ge_0_2(植被覆蓋率)、dense_veg_pct_ndvi_ge_0_6(高植生比例,可作喬木樹冠的粗略代理,對照 3-30-300 的 30% 樹冠目標)與 class_pct(分級面積比例)評估植群量與分布;並與 green 欄位的 OSM 綠覆率比較(OSM 多為下限估計,NDVI 另能涵蓋行道樹、私有庭園與零星植栽,兩者落差可點出未納入正式綠地的植栽)。須標示:單一日期影像(受季節、物候影響)、10 m 像元會混合地物、NDVI 反映植生量與活力而非樹冠覆蓋率;clear_sky_pct 低於 90% 時提醒部分像元受雲遮。
11. 若提供 site_reviews 欄位(使用者自行提供之評論文字的分析:review_count、avg_rating、aspect_mentions 為各景觀/健康面向被提及的則數、top_keywords、sample_reviews、ai_summary),將使用者觀點納入評估與規劃建議(正面要素保留強化、痛點優先改善,並扣回綠地、遮蔭、設施等數據);須標示評論為自發性、非隨機樣本,不代表全體使用者,aspect_mentions 只表示被提及、不分正負評;不要大量逐字引用評論,也不要提及任何評論者身分。

報告結構(用簡短段落與條列,務求精煉好讀):
一、基地概述(位置、所在行政區、人口結構重點)
二、開放空間與綠地評估(可及性、綠覆、對照法規/準則,符合或不足;若有 openspace_service_level 資料,納入步行 10 分鐘服務水準總分與短板面向;若有 ndvi 資料,納入衛星 NDVI 植被覆蓋率與高植生比例,並與 OSM 綠覆率對照)
三、氣候背景與微氣候(若有 climate 資料:氣溫、雨量、盛行風向、日射量及其設計意涵;無資料則略過)
四、熱環境與健康研判(高溫脆弱度與成因、敏感族群,結合氣候與綠覆綜合研判;若有 air_quality 資料,簡述最近測站空氣品質與綠化對策;若有 healing_green_intervention 資料,提出療癒綠地介入優先度與對應療癒景觀設計策略;標示為研判)
五、生態與生物多樣性(若有 biodiversity 資料:物種豐富度、分類群、受脅物種數的定性說明,標示 iNaturalist 涵蓋度限制;切勿列舉物種清單;無資料則略過)
六、規劃建議(2-4 點,具體、可行,扣回前述數據與法規;若有 site_reviews 資料,回應評論中的主要痛點與受肯定之處)
七、資料與限制說明(資料來源、代理指標、不確定性)

語氣:專業、客觀、精準。全文控制在約 450-600 字(英文版約 300-450 words),寧可精煉也不要冗長;各節 2-3 句即可,務必完整寫到「資料與限制說明」一節作結,不可中途停筆或在列舉清單處打住。`;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type"
    }
  });
}

export default async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ error: "僅支援 POST。" }, 405);

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return json({ error: "伺服器尚未設定 ANTHROPIC_API_KEY(請於 Netlify 後台設定環境變數)。" }, 500);
  }

  let data;
  try {
    data = await req.json();
  } catch (e) {
    return json({ error: "請求格式錯誤(需為 JSON)。" }, 400);
  }

  const lang = data && data.lang === "en" ? "en" : "zh";

  // 意見摘要模式:只摘要使用者上傳之意見主題,不走完整基地報告
  const isComments = data && data.mode === "comments_summary";
  // 在地評價模式:分析使用者自行提供的評論文字(Google 地圖評論、PTT、問卷等)
  const isReviews = data && data.mode === "reviews_analysis";
  let systemPrompt = SYSTEM_PROMPT;
  let userContent;
  if (isComments) {
    const comments = Array.isArray(data.comments) ? data.comments.filter(function (c) { return c && String(c).trim(); }) : [];
    const totalInScope = (typeof data.total_in_scope === "number") ? data.total_in_scope : comments.length;
    const truncated = data.truncated === true && totalInScope > comments.length;
    // 依實際情況產生「準確」的免責句(不讓模型自行編造筆數或抽樣方式)
    const caveat = lang === "en"
      ? (truncated
          ? ("Caveat: this reflects only the first " + comments.length + " of " + totalInScope + " text comments within the selected area (taken in file order, not sampled), and does not represent all visitors.")
          : ("Caveat: this reflects only the " + comments.length + " text comments within the selected area, and does not represent all visitors."))
      : (truncated
          ? ("提醒:本摘要僅反映選定範圍內 " + totalInScope + " 則文字意見中、依檔案順序的前 " + comments.length + " 則(非抽樣),不代表所有訪客。")
          : ("提醒:本摘要僅反映選定範圍內所上傳的 " + comments.length + " 則文字意見,不代表所有訪客。"));
    systemPrompt = lang === "en"
      ? ("You are an analyst summarizing community/user comments about a place. From the provided list of comments, identify the main recurring themes (3-6), each with a short label, how common it is, and 1-2 representative quotes. Note overall sentiment if discernible. Be concise, use Markdown lists. Only use the provided comments; do not invent. Do NOT output a top-level title or H1/H2 heading (the page already shows a title); start directly with the themes. Do NOT state any comment count yourself. End with EXACTLY this caveat line verbatim: " + caveat)
      : ("你是分析地點使用者意見的助理。請從提供的意見清單中,歸納出主要、反覆出現的主題(3-6 個),每個主題給簡短標題、常見程度,以及 1-2 句代表性原句引用;若可判斷請點出整體情緒傾向。務求精煉,使用 Markdown 條列。只能根據提供的意見,不可杜撰。請「不要」輸出整體大標題(頁面已有標題),直接從主題開始寫。請勿自行宣稱任何意見筆數。結尾請「原文照抄」以下這句免責提醒:" + caveat);
    const head = lang === "en"
      ? ("Comments" + (data.region ? " near " + data.region : "") + " (" + comments.length + " items):\n\n")
      : ("以下為" + (data.region ? data.region + "附近" : "選定範圍內") + "的使用者意見(共 " + comments.length + " 則):\n\n");
    userContent = head + comments.map(function (c, i) { return (i + 1) + ". " + String(c).replace(/\n/g, " ").trim(); }).join("\n");
  } else if (isReviews) {
    // 後端同樣設上限(則數 / 每則字數 / 總字數),控制 token 成本與 Function 執行時間
    const MAX_N = 150, MAX_LEN = 600, BUDGET = 32000;
    const reviews = [];
    let used = 0;
    for (const r of (Array.isArray(data.reviews) ? data.reviews : [])) {
      let s = String(r == null ? "" : r).replace(/\s+/g, " ").trim();
      if (!s) continue;
      if (s.length > MAX_LEN) s = s.slice(0, MAX_LEN) + "…";
      if (reviews.length >= MAX_N || (used + s.length > BUDGET && reviews.length)) break;
      used += s.length;
      reviews.push(s);
    }
    if (!reviews.length) return json({ error: lang === "en" ? "No reviews to analyze." : "沒有可分析的評論。" }, 400);
    const total = (typeof data.total === "number" && data.total >= reviews.length) ? data.total : reviews.length;
    const truncated = total > reviews.length;
    const clip = (v, n) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim().slice(0, n));
    const place = clip(data.place, 80), region = clip(data.region, 80);
    // 依實際情況產生「準確」的免責句(不讓模型自行編造則數或抽樣方式)
    const caveat = lang === "en"
      ? (truncated
          ? ("Caveat: based on the first " + reviews.length + " of " + total + " reviews supplied by the user (in the order given, not sampled). Reviews are a self-selected sample and do not represent all users.")
          : ("Caveat: based on the " + reviews.length + " reviews supplied by the user. Reviews are a self-selected sample and do not represent all users."))
      : (truncated
          ? ("提醒:本分析僅依使用者提供之 " + total + " 則評論中、依原順序的前 " + reviews.length + " 則(非抽樣);評論為自發性樣本,不代表全體使用者。")
          : ("提醒:本分析僅依使用者提供之 " + reviews.length + " 則評論;評論為自發性樣本,不代表全體使用者。"));
    systemPrompt = lang === "en"
      ? ("You analyze user reviews of a place for landscape planning and healthy-environment design. The reviews (some prefixed with a [N★] rating) were supplied by the user. Write, in English, using Markdown H3 (###) headings and bullet lists:\n" +
         "### Overall impression\n1-2 sentences on overall sentiment—describe the positive/neutral/negative balance qualitatively (\"most\", \"about half\", \"a few\"), no exact percentages; cite the average rating if a rating summary is given.\n" +
         "### What people value\n2-4 bullets: short label, how common, and one short verbatim quote.\n" +
         "### Pain points\n2-4 bullets in the same format; say so plainly if there are hardly any complaints.\n" +
         "### Design implications\n3-4 specific, actionable recommendations tied to the reviews (e.g. shade and thermal comfort, planting and greenery, seating, toilets and cleaning/maintenance, walking and exercise, child- and senior-friendliness, accessibility, safety lighting, mosquitoes, crowd management, relaxation and restoration).\n" +
         "Rules: use only the provided reviews and never invent content; quotes must be short verbatim excerpts (≤ 20 words) with no reviewer names or personal data; do not state the total number of reviews yourself; no H1/H2 title; about 250-400 words. End with EXACTLY this caveat line verbatim: " + caveat)
      : ("你是景觀規劃與健康環境的使用者評論分析助理。以下是使用者提供、關於某基地或場所的評論(部分開頭有 [N★] 星等標記)。請以繁體中文、Markdown 小標(###)與條列整理:\n" +
         "### 整體評價\n1-2 句說明整體情緒傾向:以「多數、約半數、少數」等定性方式描述正面、中性、負面的比例,不要給精確百分比;若有星等摘要可引用平均評分。\n" +
         "### 受肯定的面向\n2-4 點:每點一個簡短標題、常見程度,並附 1 句評論原文中的代表性短引述。\n" +
         "### 痛點與抱怨\n2-4 點,格式同上;若評論幾乎沒有負面內容就直說。\n" +
         "### 對景觀規劃設計的意涵\n3-4 點具體、可執行的建議,須扣回評論內容(可涉及遮蔭與熱舒適、植栽與綠意、休憩座椅、廁所與清潔維護、步行與運動、兒童與高齡友善、無障礙、安全照明、蚊蟲、人潮管理、放鬆與療癒等)。\n" +
         "規則:只能根據提供的評論,不可杜撰;引述須為評論原文中的短句(30 字以內),不要附作者名或任何個人資料;不要自行宣稱評論總則數;不要輸出 H1 / H2 大標題;全文約 350-500 字。結尾請「原文照抄」以下這句免責提醒:" + caveat);
    const head = lang === "en"
      ? ((place ? "Reviewed place: " + place + (region ? " (" + region + ")" : "") + "\n" : (region ? "Area: " + region + "\n" : "")) +
         "Reviews supplied by the user (" + reviews.length + " items):\n\n")
      : ((place ? "評論對象:" + place + (region ? "(" + region + ")" : "") + "\n" : (region ? "所在地區:" + region + "\n" : "")) +
         "以下為使用者提供的評論(共 " + reviews.length + " 則):\n\n");
    let extra = "";
    const rs = data.rating_summary;
    if (rs && typeof rs.average === "number" && typeof rs.rated === "number") {
      const dist = Array.isArray(rs.distribution_1_to_5) ? rs.distribution_1_to_5.slice(0, 5).map(Number).join(", ") : "";
      extra += lang === "en"
        ? ("\n\nRating summary (computed locally): " + rs.rated + " rated reviews, average " + rs.average + "★" + (dist ? ", counts for 1–5★: [" + dist + "]" : "") + ".")
        : ("\n\n星等摘要(本地計算):含星等 " + rs.rated + " 則,平均 " + rs.average + "★" + (dist ? ",1–5 星則數:[" + dist + "]" : "") + "。");
    }
    if (Array.isArray(data.aspect_mentions) && data.aspect_mentions.length) {
      const asp = data.aspect_mentions.slice(0, 12).map(function (a) { return clip(a && a.aspect, 30) + " " + (Number(a && a.reviews) || 0); }).join("、");
      extra += lang === "en"
        ? ("\nKeyword-based aspect mentions (reviews mentioning; not sentiment, for reference only): " + asp)
        : ("\n本地關鍵詞面向統計(提及則數,不分正負,僅供參考):" + asp);
    }
    userContent = head + reviews.map(function (c, i) { return (i + 1) + ". " + c; }).join("\n") + extra;
  } else {
    userContent = lang === "en"
      ? "Below are the real analysis figures (JSON) for a site. Write the site analysis report in English, following the required structure and rules. Keep Taiwanese place names and species names; you may keep scientific names as-is.\n\n```json\n" + JSON.stringify(data, null, 2) + "\n```"
      : "以下是某基地的分析真實數值(JSON)。請據此撰寫繁體中文基地分析報告:\n\n```json\n" + JSON.stringify(data, null, 2) + "\n```";
  }

  let upstream;
  try {
    upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000, // 提高上限:報告含氣候+生態共七節,1500 不足會在生態段被截斷
        stream: true, // 串流:邊產生邊回傳,避免 Netlify 閒置逾時(504)
        system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userContent }]
      })
    });
  } catch (e) {
    return json({ error: "呼叫 AI 服務失敗:" + (e && e.message ? e.message : String(e)) }, 502);
  }

  if (!upstream.ok || !upstream.body) {
    let msg = "AI 服務回應錯誤(HTTP " + upstream.status + ")。";
    try { const j = await upstream.json(); if (j && j.error && j.error.message) msg = j.error.message; } catch (e) {}
    return json({ error: msg }, upstream.status || 502);
  }

  // 解析 Anthropic SSE,逐塊把文字 delta 以純文字串流回前端;同時擷取 token 用量
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const reqMode = isComments ? "comments_summary" : isReviews ? "reviews_analysis" : "site_report";
  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body.getReader();
      let buf = "";
      // 用量累計(message_start 帶 input/cache;message_delta 帶 output)
      const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") continue;
            try {
              const evt = JSON.parse(payload);
              if (evt.type === "content_block_delta" && evt.delta && evt.delta.text) {
                controller.enqueue(encoder.encode(evt.delta.text));
              } else if (evt.type === "message_start" && evt.message && evt.message.usage) {
                const u = evt.message.usage;
                usage.input_tokens = u.input_tokens || 0;
                usage.cache_creation_input_tokens = u.cache_creation_input_tokens || 0;
                usage.cache_read_input_tokens = u.cache_read_input_tokens || 0;
              } else if (evt.type === "message_delta" && evt.usage) {
                usage.output_tokens = evt.usage.output_tokens || usage.output_tokens;
              }
            } catch (e) { /* 忽略非 JSON 行 */ }
          }
        }
      } catch (e) {
        controller.enqueue(encoder.encode("\n\n(串流中斷:" + (e.message || e) + ")"));
      }
      const meta = {
        model: MODEL, mode: reqMode, ts: new Date().toISOString(),
        input_tokens: usage.input_tokens, output_tokens: usage.output_tokens,
        cache_creation_input_tokens: usage.cache_creation_input_tokens,
        cache_read_input_tokens: usage.cache_read_input_tokens
      };
      // 伺服器端記錄(Netlify Function logs 可查每一次)
      try { console.log("[analyze usage] " + JSON.stringify(meta)); } catch (e) {}
      // 串流尾端附機器可讀標記;前端會擷取並移除後再渲染
      controller.enqueue(encoder.encode("\n␞ USAGE ␞" + JSON.stringify(meta)));
      controller.close();
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-cache",
      "access-control-allow-origin": "*"
    }
  });
};

// Netlify Functions 2.0:直接把此函式掛在 /api/analyze
export const config = { path: "/api/analyze" };
