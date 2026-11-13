/* Netlify Function: POST /api/reviews
 * 以 Google Places API (New) 取得基地周邊(或指定名稱)地點的 Google 地圖評論。
 *   - 未填名稱:Nearby Search,以基地為圓心、戶外 / 公共場所類型、依熱門度取最多 20 個地點
 *   - 有填名稱:Text Search,以基地為中心偏好搜尋該名稱,取最多 5 個地點
 *   每個地點最多 5 則評論(Google 依相關度挑選,API 無法取得更多)。
 * 金鑰存於環境變數 GOOGLE_MAPS_API_KEY(Netlify 後台設定,前端不外露)。
 * 欄位名稱依 googleapis google/maps/places/v1 protos(SearchNearbyRequest / SearchTextRequest /
 * Place / Review / AuthorAttribution)。
 * 回應一律不快取(Google Maps Platform 條款不允許快取 Places 內容)。
 */

const NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby";
const TEXT_URL = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK = [
  "places.id", "places.displayName", "places.primaryType", "places.primaryTypeDisplayName",
  "places.rating", "places.userRatingCount", "places.googleMapsUri", "places.reviews"
].join(",");

// 戶外 / 公共場所類型(Places API Table A)。較新的類型若不被接受(INVALID_ARGUMENT),
// 依序退回 BASIC,再退回不限類型。
const TYPES_BASIC = [
  "park", "dog_park", "hiking_area", "national_park", "playground", "tourist_attraction",
  "zoo", "campground", "marina", "athletic_field", "sports_complex", "stadium", "swimming_pool",
  "historical_landmark", "community_center", "cultural_center", "library", "university"
];
const TYPES_EXTENDED = TYPES_BASIC.concat(["garden", "botanical_garden", "plaza", "picnic_ground", "observation_deck"]);

// 只允許本站網域呼叫(避免他站借用金鑰額度);瀏覽器的 POST 一律帶 Origin
const ALLOWED_HOSTS = [
  /(^|\.)healsdesign\.org$/,
  /^healsmap\.netlify\.app$/,
  /--healsmap\.netlify\.app$/,
  /^localhost$/,
  /^127\.0\.0\.1$/
];

const CALL_TIMEOUT_MS = 7000; // Netlify Function 有 10 秒執行上限

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function hostAllowed(req) {
  const src = req.headers.get("origin") || req.headers.get("referer") || "";
  let host = "";
  try { host = new URL(src).hostname; } catch (e) { return false; }
  return ALLOWED_HOSTS.some((re) => re.test(host));
}

async function callPlaces(url, key, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": FIELD_MASK
      },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

function errInfo(r) {
  const e = r && r.data && r.data.error;
  return { status: (e && e.status) || "", message: (e && e.message) || ("HTTP " + (r ? r.status : "?")) };
}

function clampNum(v, lo, hi, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

function slimPlace(p) {
  const reviews = Array.isArray(p.reviews) ? p.reviews : [];
  return {
    name: (p.displayName && p.displayName.text) || "",
    type: (p.primaryTypeDisplayName && p.primaryTypeDisplayName.text) || p.primaryType || "",
    rating: typeof p.rating === "number" ? p.rating : null,
    user_rating_count: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
    maps_uri: p.googleMapsUri || "",
    reviews: reviews.map((r) => {
      const t = r.text || {}, o = r.originalText || {};
      const text = t.text || o.text || "";
      return {
        rating: typeof r.rating === "number" ? r.rating : null,
        text: text,
        // text 為依 languageCode 翻譯後的文字;與原文語言不同即為 Google 翻譯
        translated: !!(t.languageCode && o.languageCode && t.languageCode !== o.languageCode),
        author: (r.authorAttribution && r.authorAttribution.displayName) || "",
        author_uri: (r.authorAttribution && r.authorAttribution.uri) || "",
        relative_time: r.relativePublishTimeDescription || "",
        publish_time: r.publishTime || "",
        maps_uri: r.googleMapsUri || ""
      };
    }).filter((r) => r.text)
  };
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "僅支援 POST。" }, 405);
  if (!hostAllowed(req)) return json({ error: "不允許的來源網域。" }, 403);

  const key = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    return json({ error: "伺服器尚未設定 GOOGLE_MAPS_API_KEY(請於 Netlify 後台設定 Google Maps Platform 金鑰並啟用 Places API (New))。" }, 500);
  }

  let data;
  try { data = await req.json(); } catch (e) { return json({ error: "請求格式錯誤(需為 JSON)。" }, 400); }

  const lat = Number(data && data.lat), lng = Number(data && data.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return json({ error: "座標不正確。" }, 400);
  }
  const lang = data.lang === "en" ? "en" : "zh-TW";
  const query = typeof data.query === "string" ? data.query.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  const center = { latitude: lat, longitude: lng };

  let r, mode, radius, typesUsed = null;
  if (query) {
    // 名稱搜尋:以基地為中心偏好(bias)該區域,取相關度最高的幾個地點
    mode = "text";
    radius = clampNum(data.radius, 200, 50000, 2000);
    r = await callPlaces(TEXT_URL, key, {
      textQuery: query,
      languageCode: lang,
      regionCode: "TW",
      rankPreference: "RELEVANCE",
      maxResultCount: 5,
      locationBias: { circle: { center, radius } }
    });
  } else {
    mode = "nearby";
    radius = clampNum(data.radius, 50, 5000, 500);
    const base = {
      languageCode: lang,
      regionCode: "TW",
      maxResultCount: 20,
      rankPreference: "POPULARITY",
      locationRestriction: { circle: { center, radius } }
    };
    for (const [label, types] of [["extended", TYPES_EXTENDED], ["basic", TYPES_BASIC], ["none", null]]) {
      r = await callPlaces(NEARBY_URL, key, types ? Object.assign({ includedTypes: types }, base) : base);
      typesUsed = label;
      // 只有「類型不被接受」才換下一組類型重試;其他錯誤(金鑰、配額、帳單)直接回報
      if (r.ok || errInfo(r).status !== "INVALID_ARGUMENT" || !/type/i.test(errInfo(r).message)) break;
    }
  }

  if (!r.ok) {
    const e = errInfo(r);
    const status = r.status >= 400 && r.status < 600 ? r.status : 502;
    return json({ error: "Google Places API:" + e.message, status: e.status }, status);
  }

  const places = ((r.data && r.data.places) || []).map(slimPlace);
  const reviewCount = places.reduce((s, p) => s + p.reviews.length, 0);
  console.log("[reviews] " + JSON.stringify({ mode, radius, typesUsed, places: places.length, reviews: reviewCount }));
  return json({
    source: "google_places",
    attribution: "Google Maps",
    mode,
    radius,
    types_used: typesUsed,
    query: query || null,
    places,
    review_count: reviewCount
  });
};

// Netlify Functions 2.0:掛在 /api/reviews
export const config = { path: "/api/reviews" };
