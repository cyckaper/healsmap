/* 都市計畫土地使用分區 · 自動查詢(瀏覽器直接查詢各縣市政府的 ArcGIS REST 圖資服務)
 *
 * 為什麼在瀏覽器端查:部分縣市伺服器會擋海外 IP(實測臺中回 "Server Unavailable" 封鎖頁、
 * 桃園 / 苗栗連線逾時),Netlify Function 位於美國會被擋;使用者多在臺灣,直接查較可靠。
 * 已驗證的服務都允許跨來源請求(CORS,回應帶 Access-Control-Allow-Origin)。
 *
 * 查詢方式:
 *  - 點:以點位查詢(inSR=4326);落在道路或分區縫隙查無時,改查周邊約 15 m 範圍,標示為「鄰近分區」
 *  - 面:以基地多邊形查詢並取回分區圖形(outSR=4326),用 turf 計算各分區占基地面積比例
 *  一律用 POST(application/x-www-form-urlencoded 為「簡單請求」,不需 CORS 預檢,也不受網址長度限制)
 *
 * 另一種來源:縣市只提供整份 SHP 開放資料(新北市)時,由 scripts/build-zoning.mjs 轉成
 * public/zoning/<key>/ 的 0.05° 圖磚(GeoJSON,properties: i=唯一 id、z=分區名稱),
 * 點位只載入所在圖磚、基地載入相交圖磚,在瀏覽器以 turf 判斷,輸出格式與即時查詢相同。
 *
 * 暴露 window.ZoningLookup:{ SERVICES, supported(county), lookup(opts) → Promise<result>, summary(result) }
 */
(function () {
  "use strict";

  // 分區名稱欄位只接受「明確是分區名稱」的欄位;找不到就視為查無(寧可請使用者手填,也不顯示錯的值)
  var NAME_CANDIDATES = ["使用分區", "ZONENAME", "LUSE", "ZoningName", "ZONE_NAME", "分區名稱"];

  // verified:2026-11-24 實際查詢確認回應欄位;未驗證者(海外 IP 被擋)以候選欄位嘗試
  var SERVICES = {
    "臺北市": {
      agency: "臺北市政府都市發展局", layer: "都市計畫使用分區圖",
      url: "https://www.historygis.udd.gov.taipei/arcgis/rest/services/UrbanPlan2/UrbanPlan2/MapServer/2",
      name: ["使用分區"], short: ["分區簡稱"], code: ["分區代碼"], bcr: ["建蔽率"], far: ["容積率"], plan: [],
      verified: true
    },
    "新竹市": {
      agency: "新竹市政府都市發展處", layer: "都市計畫使用分區",
      url: "https://urbanmap.hccg.gov.tw/server/rest/services/UrbanPlan/Landuse_NoCache/MapServer/1",
      name: ["LUSE"], short: [], code: ["LUSE_CODE"], bcr: [], far: [], plan: [],
      verified: true
    },
    "彰化縣": {
      agency: "彰化縣政府", layer: "都市計畫使用分區(USEZONE_FULL)",
      url: "https://urbangis.chcg.gov.tw/arcgis/rest/services/CHCGMap/CITYPLANS/MapServer/19",
      name: ["ZONENAME"], short: ["ZONE"], code: [], bcr: ["BULID_CR"], far: ["BULID_AR"], plan: ["URBAN"],
      verified: true
    },
    "桃園市": {
      agency: "桃園市政府都市發展局", layer: "都市計畫使用分區",
      url: "https://urbandatasrv.tycg.gov.tw/server/rest/services/TY_UPGIS/TYMap_SDE/MapServer/2",
      name: NAME_CANDIDATES, short: [], code: [], bcr: [], far: [], plan: [],
      verified: false
    },
    "臺中市": {
      agency: "臺中市政府都市發展局", layer: "都市計畫使用分區",
      url: "https://mcgbm.taichung.gov.tw/arcgis/rest/services/URBAN97/MapServer/1",
      name: NAME_CANDIDATES, short: [], code: [], bcr: [], far: [], plan: [],
      verified: false
    },
    "新北市": {
      agency: "新北市政府城鄉發展局", layer: "都市計畫土地使用分區圖",
      type: "static", base: "./zoning/ntpc/",
      verified: true
    },
    "高雄市": {
      // 民國 105 年版圖層(使用分區105,顯示欄位 NAME);伺服器擋海外連線未能實測欄位
      agency: "高雄市政府", layer: "使用分區105(民國105年資料,可能未含其後變更)",
      url: "https://pipegis3d.kcg.gov.tw/server/rest/services/BasicMap/%E5%9C%9F%E5%9C%B0%E4%BD%BF%E7%94%A8%E5%88%86%E5%8D%80/MapServer/1",
      name: ["NAME"].concat(NAME_CANDIDATES), short: [], code: [], bcr: [], far: [], plan: [],
      verified: false
    },
    "苗栗縣": {
      agency: "苗栗縣政府", layer: "都市計畫使用分區",
      url: "https://ailand.miaoli.gov.tw/server/rest/services/Dynamic/Urban_Planning/MapServer/0",
      name: NAME_CANDIDATES, short: [], code: [], bcr: [], far: [], plan: [],
      verified: false
    }
  };
  var TIMEOUT_MS = 15000;
  var NEAR_DEG = 0.00015; // 約 15 m

  function normCounty(s) { return String(s || "").replace(/台/g, "臺").trim(); }
  function serviceFor(county) { return SERVICES[normCounty(county)] || null; }

  function firstVal(attrs, keys) {
    for (var i = 0; i < keys.length; i++) {
      var v = attrs[keys[i]];
      if (v === null || v === undefined) continue;
      if (typeof v === "string") { v = v.trim(); if (!v) continue; }
      return v;
    }
    return null;
  }

  function post(url, params, signal) {
    var body = new URLSearchParams();
    Object.keys(params).forEach(function (k) { body.append(k, params[k]); });
    return fetch(url + "/query", { method: "POST", body: body, signal: signal })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (j) {
        if (j && j.error) throw new Error((j.error.message || "ArcGIS error") + (j.error.code ? " (" + j.error.code + ")" : ""));
        return j;
      });
  }

  // ESRI rings → GeoJSON(順時針為外環、逆時針為內環 / 洞)
  function esriToGeoJSON(geom) {
    if (!geom || !geom.rings || !geom.rings.length || !window.turf) return null;
    var polys = [];
    geom.rings.forEach(function (ring) {
      if (!ring || ring.length < 4) return;
      var cw = false;
      try { cw = turf.booleanClockwise(ring); } catch (e) { cw = true; }
      if (cw || !polys.length) polys.push([ring]);
      else polys[polys.length - 1].push(ring);
    });
    if (!polys.length) return null;
    return polys.length === 1 ? turf.polygon(polys[0]) : turf.multiPolygon(polys);
  }

  // 依分區名稱彙整(面模式附面積比例)
  function aggregate(svc, features, site) {
    var byName = {}, order = [];
    var siteArea = site ? turf.area(site) : 0;
    features.forEach(function (f) {
      var a = f.attributes || {};
      var name = firstVal(a, svc.name);
      if (!name) return;
      name = String(name);
      var z = byName[name];
      if (!z) {
        z = byName[name] = { name: name, count: 0, area_m2: 0, short: null, code: null, bcr: null, far: null, plan: null };
        order.push(name);
      }
      z.count++;
      z.short = z.short || firstVal(a, svc.short);
      z.code = z.code || firstVal(a, svc.code);
      z.bcr = z.bcr != null ? z.bcr : firstVal(a, svc.bcr);
      z.far = z.far != null ? z.far : firstVal(a, svc.far);
      z.plan = z.plan || firstVal(a, svc.plan);
      if (site && f.geometry) {
        try {
          var g = esriToGeoJSON(f.geometry);
          var x = g ? turf.intersect(site, g) : null;
          if (x) z.area_m2 += turf.area(x);
        } catch (e) { /* 單一圖形交集失敗:只計筆數 */ }
      }
    });
    var zones = order.map(function (n) { return byName[n]; });
    var withArea = siteArea > 0 && zones.some(function (z) { return z.area_m2 > 0; });
    zones.forEach(function (z) {
      z.share = withArea ? +(z.area_m2 / siteArea).toFixed(3) : null;
      z.area_m2 = withArea ? Math.round(z.area_m2) : null;
      if (z.short === z.name) z.short = null;
    });
    if (withArea) zones.sort(function (a, b) { return b.share - a.share; });
    return zones.filter(function (z) { return !withArea || z.share >= 0.005; }); // 面模式:忽略 <0.5% 的邊緣碎片
  }

  // ---- 靜態圖磚(開放資料預先切好的 GeoJSON)----
  var staticCache = {}; // url → Promise<json>
  function getJSON(url, signal) {
    if (!staticCache[url]) {
      staticCache[url] = fetch(url, { signal: signal }).then(function (r) {
        if (r.status === 404) return null; // 該格無分區資料
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      });
      staticCache[url].catch(function () { delete staticCache[url]; }); // 失敗不快取,下次重試
    }
    return staticCache[url];
  }
  function tileKeys(index, bbox) {
    var d = index.tile_deg, keys = [];
    for (var ix = Math.floor(bbox[0] / d); ix <= Math.floor(bbox[2] / d); ix++) {
      for (var iy = Math.floor(bbox[1] / d); iy <= Math.floor(bbox[3] / d); iy++) {
        var k = ix + "_" + iy;
        if (index.tiles.indexOf(k) >= 0) keys.push(k);
      }
    }
    return keys;
  }
  function bboxHit(a, b) { return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]; }
  // 載入相交圖磚、依 id 去重,回傳 [{f, bb}]
  function staticCandidates(svc, bbox, signal) {
    return getJSON(svc.base + "index.json", signal).then(function (index) {
      if (!index) throw new Error("zoning index missing");
      svc.dataDate = index.downloaded;
      var keys = tileKeys(index, bbox);
      var partial = keys.length > 16;
      return Promise.all(keys.slice(0, 16).map(function (k) { return getJSON(svc.base + "t_" + k + ".json", signal); }))
        .then(function (fcs) {
          var seen = {}, out = [];
          fcs.forEach(function (fc) {
            ((fc && fc.features) || []).forEach(function (f) {
              var id = f.properties && f.properties.i;
              if (seen[id]) return;
              seen[id] = 1;
              var bb = f.bbox || (f.bbox = turf.bbox(f));
              if (bboxHit(bb, bbox)) out.push(f);
            });
          });
          return { feats: out, partial: partial };
        });
    });
  }
  // 轉成與 ArcGIS 結果相同的彙整格式
  function staticZones(feats, site) {
    var byName = {}, order = [], siteArea = site ? turf.area(site) : 0;
    feats.forEach(function (f) {
      var name = String(f.properties.z || "");
      if (!name) return;
      var z = byName[name];
      if (!z) { z = byName[name] = { name: name, count: 0, area_m2: 0, short: null, code: null, bcr: null, far: null, plan: null }; order.push(name); }
      z.count++;
      if (site) { try { var x = turf.intersect(site, f); if (x) z.area_m2 += turf.area(x); } catch (e) { /* 只計筆數 */ } }
    });
    var zones = order.map(function (n) { return byName[n]; });
    var withArea = siteArea > 0 && zones.some(function (z) { return z.area_m2 > 0; });
    zones.forEach(function (z) { z.share = withArea ? +(z.area_m2 / siteArea).toFixed(3) : null; z.area_m2 = withArea ? Math.round(z.area_m2) : null; });
    if (withArea) { zones = zones.filter(function (z) { return z.share >= 0.005; }); zones.sort(function (a, b) { return b.share - a.share; }); }
    return zones;
  }
  function staticLookup(svc, opts, signal) {
    if (opts.polygon) {
      var bb = turf.bbox(opts.polygon);
      return staticCandidates(svc, bb, signal).then(function (c) {
        var hits = c.feats.filter(function (f) { try { return turf.booleanIntersects(opts.polygon, f); } catch (e) { return false; } });
        return { zones: staticZones(hits, opts.polygon), partial: c.partial };
      });
    }
    var lng = +opts.lng, lat = +opts.lat, pt = turf.point([lng, lat]);
    return staticCandidates(svc, [lng - NEAR_DEG, lat - NEAR_DEG, lng + NEAR_DEG, lat + NEAR_DEG], signal).then(function (c) {
      var inside = c.feats.filter(function (f) {
        return f.bbox[0] <= lng && lng <= f.bbox[2] && f.bbox[1] <= lat && lat <= f.bbox[3] && turf.booleanPointInPolygon(pt, f);
      });
      if (inside.length) return { zones: staticZones(inside, null) };
      // 點位落在道路 / 分區縫隙:取約 15 m 範圍內的分區
      var box = turf.bboxPolygon([lng - NEAR_DEG, lat - NEAR_DEG, lng + NEAR_DEG, lat + NEAR_DEG]);
      var near = c.feats.filter(function (f) { try { return turf.booleanIntersects(box, f); } catch (e) { return false; } });
      return { zones: staticZones(near, null), nearby: true };
    });
  }

  /* opts: { county, lat, lng, polygon (GeoJSON Feature, 面模式), signal }
   * result: { status: ok|none|unsupported|error, county, agency, layer, url, verified,
   *           mode: point|site, nearby, zones:[{name, share, area_m2, count, short, code, bcr, far, plan}],
   *           plans:[], partial, error, queried_at } */
  function lookup(opts) {
    var county = normCounty(opts.county);
    var svc = serviceFor(county);
    var base = { county: county, mode: opts.polygon ? "site" : "point", nearby: false, zones: [], plans: [],
      queried_at: new Date().toISOString() };
    if (!svc) return Promise.resolve(Object.assign(base, { status: "unsupported" }));
    Object.assign(base, { agency: svc.agency, layer: svc.layer, url: svc.url, verified: svc.verified });

    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;
    if (ctrl && opts.signal) opts.signal.addEventListener("abort", function () { ctrl.abort(); });
    var signal = ctrl ? ctrl.signal : undefined;
    var common = { f: "json", inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: "*" };

    var p;
    if (svc.type === "static") {
      p = staticLookup(svc, opts, signal);
    } else if (opts.polygon) {
      var ring = opts.polygon.geometry.coordinates[0];
      p = post(svc.url, Object.assign({}, common, {
        geometry: JSON.stringify({ rings: [ring], spatialReference: { wkid: 4326 } }),
        geometryType: "esriGeometryPolygon",
        returnGeometry: "true", outSR: "4326", geometryPrecision: "6", maxAllowableOffset: "0.00002"
      }), signal).then(function (j) {
        var zones = aggregate(svc, j.features || [], opts.polygon);
        return { zones: zones, partial: !!j.exceededTransferLimit };
      });
    } else {
      var pt = function (geom, type) {
        return post(svc.url, Object.assign({}, common, {
          geometry: JSON.stringify(geom), geometryType: type, returnGeometry: "false"
        }), signal);
      };
      var lng = +opts.lng, lat = +opts.lat;
      p = pt({ x: lng, y: lat, spatialReference: { wkid: 4326 } }, "esriGeometryPoint").then(function (j) {
        var zones = aggregate(svc, j.features || [], null);
        if (zones.length) return { zones: zones };
        // 點位落在道路 / 分區縫隙:查周邊約 15 m
        return pt({ xmin: lng - NEAR_DEG, ymin: lat - NEAR_DEG, xmax: lng + NEAR_DEG, ymax: lat + NEAR_DEG,
          spatialReference: { wkid: 4326 } }, "esriGeometryEnvelope").then(function (j2) {
          return { zones: aggregate(svc, j2.features || [], null), nearby: true };
        });
      });
    }

    return p.then(function (r) {
      var plans = [];
      r.zones.forEach(function (z) { if (z.plan && plans.indexOf(z.plan) < 0) plans.push(String(z.plan).trim()); });
      if (svc.type === "static" && svc.dataDate) base.data_date = svc.dataDate;
      return Object.assign(base, {
        status: r.zones.length ? "ok" : "none", zones: r.zones.slice(0, 12), plans: plans,
        nearby: !!r.nearby && r.zones.length > 0, partial: !!r.partial
      });
    }).catch(function (e) {
      return Object.assign(base, { status: "error",
        error: (e && e.name === "AbortError") ? "timeout" : String((e && e.message) || e) });
    }).finally(function () { if (timer) clearTimeout(timer); });
  }

  // 精簡摘要:「第三種住宅區 62%、公園用地 30%」或「大專用地」
  function summary(res, max) {
    if (!res || res.status !== "ok") return "";
    return res.zones.slice(0, max || 4).map(function (z) {
      return z.name + (z.share != null ? " " + Math.round(z.share * 100) + "%" : "");
    }).join("、");
  }

  window.ZoningLookup = {
    SERVICES: SERVICES,
    supported: function (county) { return !!serviceFor(county); },
    lookup: lookup,
    summary: summary
  };
})();
