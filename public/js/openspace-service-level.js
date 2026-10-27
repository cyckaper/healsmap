/* ============================================================================
 * openspace-service-level.js
 * 開放空間服務水準 · Open Space Service Level —— 可併入 map.healsdesign.org
 *
 * 相依：無。只在 drawCatchment() 用到 Leaflet 全域 L（你的站本來就有）。
 * 計分邏輯與 openspace_service_level.html 完全一致。
 *
 * 暴露 window.OpenSpaceServiceLevel：
 *   await OSSL.compute(lat, lng[, opts])   → 回傳結果物件（見底部 typedef）
 *   OSSL.renderHTML(result)                → 回傳面板 HTML 字串
 *   OSSL.summaryForAI(result)              → 回傳給「AI 解讀」用的精簡文字
 *   OSSL.drawCatchment(map, lat, lng)      → 在地圖畫 10 分鐘步行涵蓋圈，回傳 layer
 *
 * 四個接入點（對應你站上的 UI）：
 *   1) 放標記 / 分析按鈕的 handler 內：const r = await OSSL.compute(lat,lng);
 *   2) 把面板插進結果區：panelEl.innerHTML = OSSL.renderHTML(r);
 *   3) 畫涵蓋圈：OSSL.drawCatchment(map, lat, lng);
 *   4) 產 AI 報告前：把 OSSL.summaryForAI(r) 併進送給 Claude 的內容。
 * ========================================================================== */
(function (global) {
  "use strict";

  const DETOUR = 1.3;        // 直線→路網步行 繞路係數
  const WALK_CATCH = 800;    // 涵蓋範圍（公尺步行，≈10 分鐘）
  const QUERY_RADIUS = 1000; // Overpass 查詢半徑（公尺，直線）
  const PV = { p: 0.6, v: 0.4 };
  // 走棲共生站的共用代查（有 overpass.ch 專屬金鑰額度與共用快取）；
  // 公用伺服器壅塞時常常查不到，代查失敗才退回它。
  const OVERPASS = "https://eco4design.healsdesign.org/api/osm";
  const OVERPASS_FALLBACK = "https://overpass-api.de/api/interpreter";

  const CATS = [
    { key:"green",   label:"綠地 / 公園",      lambda:400, k:2, weight:0.35,
      sel:['nwr["leisure"="park"]','nwr["leisure"="garden"]','nwr["landuse"="recreation_ground"]','nwr["leisure"="nature_reserve"]','nwr["leisure"="common"]'] },
    { key:"sports",  label:"運動 / 遊憩設施",  lambda:500, k:3, weight:0.20,
      sel:['nwr["leisure"="pitch"]','nwr["leisure"="sports_centre"]','nwr["leisure"="stadium"]','nwr["leisure"="fitness_station"]','nwr["leisure"="track"]','nwr["leisure"="playground"]'] },
    { key:"active",  label:"自行車 / 步道連結", lambda:400, k:3, weight:0.15,
      sel:['nwr["amenity"="bicycle_rental"]','way["highway"="cycleway"]','way["highway"="path"]["bicycle"="designated"]'] },
    { key:"transit", label:"大眾運輸",         lambda:300, k:4, weight:0.15,
      sel:['node["highway"="bus_stop"]','nwr["railway"="station"]','node["railway"="subway_entrance"]','node["railway"="tram_stop"]'] },
    { key:"toilet",  label:"公廁",             lambda:250, k:2, weight:0.15,
      sel:['nwr["amenity"="toilets"]'] },
  ];

  const BANDS = [[80,"優","#2f6f3a"],[60,"良","#5f8f2f"],[40,"普通","#9a7a2e"],[20,"不足","#bd5a2a"],[0,"匱乏","#9a3b2e"]];

  function haversine(a, b) {
    const R = 6371000, t = Math.PI / 180;
    const dLat = (b[0]-a[0])*t, dLng = (b[1]-a[1])*t;
    const s = Math.sin(dLat/2)**2 + Math.cos(a[0]*t)*Math.cos(b[0]*t)*Math.sin(dLng/2)**2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  function coordOf(el) {
    if (el.lat != null && el.lon != null) return [el.lat, el.lon];
    if (el.center) return [el.center.lat, el.center.lon];
    return null;
  }
  function bandOf(v) { for (const [t,name,col] of BANDS) if (v >= t) return {name,color:col}; return {name:"匱乏",color:"#9a3b2e"}; }
  function matches(el, c) {
    const tags = el.tags || {};
    for (const s of c.sel) {
      const m = [...s.matchAll(/\["([^"]+)"="([^"]+)"\]/g)];
      if (m.length && m.every(x => tags[x[1]] === x[2])) return true;
    }
    return false;
  }
  function buildQuery(lat, lng) {
    let body = "[out:json][timeout:25];(";
    for (const c of CATS) for (const s of c.sel) body += s + `(around:${QUERY_RADIUS},${lat},${lng});`;
    body += ");out center tags;";
    return body;
  }

  /**
   * 計算服務水準。
   * opts.overpassUrl  自訂 Overpass endpoint（預設走共用代查 /api/osm；
   *                    指定時不自動改道，由呼叫端自行負責備援）
   * opts.elements     若你已用自己的查詢拿到 elements，可直接傳入，省一次請求
   * opts.weights      {green,sports,active,transit,toilet} 覆寫預設權重
   */
  async function compute(lat, lng, opts = {}) {
    let elements = opts.elements;
    if (!elements) {
      const body = "data=" + encodeURIComponent(buildQuery(lat, lng));
      const post = async (url) => {
        const res = await fetch(url, { method: "POST", body });
        if (!res.ok) throw new Error("Overpass " + res.status);
        return (await res.json()).elements || [];
      };
      try {
        elements = await post(opts.overpassUrl || OVERPASS);
      } catch (e) {
        // 代查掛掉時仍能運作，不會比改動前更糟
        if (opts.overpassUrl) throw e;   // 呼叫端指定了端點就尊重它，不自行改道
        console.warn("[OSSL] 共用代查失敗，改試公用伺服器:", e.message || e);
        elements = await post(OVERPASS_FALLBACK);
      }
    }
    const site = [lat, lng];
    const categories = CATS.map(c => {
      let nearest = Infinity, count = 0;
      for (const el of elements) {
        if (!matches(el, c)) continue;
        const p = coordOf(el); if (!p) continue;
        const walk = haversine(site, p) * DETOUR;
        if (walk < nearest) nearest = walk;
        if (walk <= WALK_CATCH) count++;
      }
      const P = nearest === Infinity ? 0 : 100 * Math.exp(-nearest / c.lambda);
      const V = 100 * (1 - Math.exp(-count / c.k));
      const S = PV.p * P + PV.v * V;
      const weight = (opts.weights && opts.weights[c.key] != null) ? opts.weights[c.key] : c.weight;
      return { key:c.key, label:c.label, nearestMeters:(nearest===Infinity?null:Math.round(nearest)),
               count, P:+P.toFixed(1), V:+V.toFixed(1), S:+S.toFixed(1), weight };
    });
    let wsum = 0, acc = 0;
    for (const c of categories) { wsum += c.weight; acc += c.weight * c.S; }
    const overall = wsum > 0 ? +(acc / wsum).toFixed(1) : 0;
    return { lat, lng, overall, band: bandOf(overall),
             catchmentRadiusMeters: Math.round(WALK_CATCH / DETOUR), categories };
  }

  function renderHTML(r) {
    const col = r.band.color;
    const rows = r.categories.map(c => `
      <tr>
        <td class="ossl-cat">${c.label}<div class="ossl-bar" style="width:${Math.round(c.S)}%;background:${col}"></div></td>
        <td>${c.nearestMeters == null ? "—" : c.nearestMeters + " m"}</td>
        <td>${c.count}</td>
        <td class="ossl-s">${Math.round(c.S)}</td>
      </tr>`).join("");
    return `
      <div class="ossl">
        <div class="ossl-hero">
          <span class="ossl-num" style="color:${col}">${Math.round(r.overall)}</span>
          <span class="ossl-band" style="color:${col}">服務水準 · ${r.band.name}</span>
          <span class="ossl-cap">涵蓋：步行 10 分鐘（≈${r.catchmentRadiusMeters} m 直線）</span>
        </div>
        <table class="ossl-table">
          <thead><tr><th>面向</th><th>最近</th><th>數量</th><th>分數</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="ossl-note">分數＝0.6×鄰近度＋0.4×供給度；總分＝Σ(權重×分數)/Σ權重。資料：OSM / Overpass 即時查詢，屬下限估計。</p>
      </div>`;
  }

  function summaryForAI(r) {
    const parts = r.categories.map(c =>
      `${c.label}（最近 ${c.nearestMeters == null ? "無" : c.nearestMeters + "m"}、範圍內 ${c.count} 處、得分 ${Math.round(c.S)}）`);
    return `開放空間服務水準：總分 ${Math.round(r.overall)}（${r.band.name}）。`
         + `以步行 10 分鐘可及性評估，五面向為 ${parts.join("、")}。`
         + `方法：直線距離×1.3 近似路網步行，鄰近度採距離衰減、供給度採飽和函數，資料為 OSM/Overpass 即時查詢（下限估計）。`;
  }

  function drawCatchment(map, lat, lng, o = {}) {
    return L.circle([lat, lng], {
      radius: WALK_CATCH / DETOUR, color: o.color || "#436b34",
      weight: 1.5, fillColor: o.color || "#436b34", fillOpacity: 0.06, dashArray: "4 4",
    }).addTo(map);
  }

  global.OpenSpaceServiceLevel = { compute, renderHTML, summaryForAI, drawCatchment, CATS };
})(typeof window !== "undefined" ? window : this);

/* @typedef Result {
 *   lat, lng, overall:Number, band:{name,color},
 *   catchmentRadiusMeters:Number,
 *   categories:[{key,label,nearestMeters,count,P,V,S,weight}]
 * } */
