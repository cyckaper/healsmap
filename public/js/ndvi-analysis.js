/* ============================================================================
 * ndvi-analysis.js
 * NDVI 植群分析 · NDVI Vegetation Analysis —— HEALS 基地分析工作站
 *
 * 以 ESA Copernicus Sentinel-2 L2A(10 m)影像計算基地範圍 / 焦點半徑內的 NDVI:
 *   1) 向 Element 84 Earth Search(STAC API,免金鑰、支援 CORS)查近一年、
 *      場景雲量較低的影像;
 *   2) 逐一讀取候選影像在基地處的 SCL 場景分類(20 m),挑「基地上空晴空比例」
 *      最高且最新的一景(雲、雲影、缺值不計);
 *   3) 以 HTTP Range 只讀基地所在的 B04(紅光)、B08(近紅外)COG 圖塊(AWS Open Data
 *      sentinel-cogs,支援 CORS),套用 STAC raster:bands 的 scale/offset 轉反射率後計算
 *      NDVI = (NIR − Red) ÷ (NIR + Red),並統計分級面積與產生地圖疊圖。
 *
 * 相依:geotiff.js(GeoTIFF 全域,首次使用時由 unpkg 動態載入)。不需 Leaflet / Turf。
 * 暴露 window.NDVIAnalysis:
 *   analyze(opts) -> Promise<Result>
 *     opts = { lat, lng,                 焦點(點模式中心 / 面模式範圍中心)
 *              polygon,                  GeoJSON Feature/Polygon/MultiPolygon(面模式;無則為點模式)
 *              radiusM,                  點模式半徑(公尺,預設 500)
 *              onProgress(stage, info),  進度回呼:search / check / read / compute
 *              signal }                  AbortSignal(可取消)
 *   CLASSES, colorFor(v), legendGradient()   分級定義與色帶(供圖例使用)
 *   utm(lat, lng, zone) -> [E, N]            WGS84 → UTM(北半球)
 * ========================================================================== */
(function (global) {
  "use strict";

  var STAC_SEARCH = "https://earth-search.aws.element84.com/v1/search";
  var COLLECTION = "sentinel-2-l2a";
  var GEOTIFF_CDN = "https://unpkg.com/geotiff@2.1.3/dist-browser/geotiff.js";

  var LOOKBACK_DAYS = 365;     // 只找近一年影像
  var MAX_SCENE_CLOUD = 60;    // 場景雲量(%)上限,先排除整景幾乎全雲者
  var MAX_CANDIDATES = 12;     // 最多逐一檢查幾景的基地晴空比例
  var BATCH = 3;               // 同時檢查幾景
  var GOOD_CLEAR = 0.9;        // 基地晴空 ≥ 90% 即採用(依日期由新到舊)
  var MIN_CLEAR = 0.5;         // 全部候選都不足 90% 時,取最佳者,但至少需 50%
  var MAX_PX = 600;            // 讀取視窗邊長上限(像元);超過改用較粗的金字塔層
  var VEG_MIN = 0.2;           // 植被覆蓋門檻(NDVI ≥ 0.2)
  var DENSE_MIN = 0.6;         // 高植生門檻(NDVI ≥ 0.6,樹冠/濃密植被代理)

  // SCL(Scene Classification)無效類別:0 缺值、1 飽和/瑕疵、3 雲影、8/9 中/高機率雲、10 薄卷雲
  var SCL_INVALID = { 0: 1, 1: 1, 3: 1, 8: 1, 9: 1, 10: 1 };

  // NDVI 分級(慣用門檻,屬概略分級;可依研究目的調整)
  var CLASSES = [
    { key: "water",    min: -1,  max: 0,   color: "#4a7bb7" }, // 水體 / 陰影
    { key: "bare",     min: 0,   max: 0.2, color: "#b08a5a" }, // 裸露 / 建成(不透水)
    { key: "sparse",   min: 0.2, max: 0.4, color: "#d9c76a" }, // 低植生(草地、灌叢、行道樹稀疏)
    { key: "moderate", min: 0.4, max: 0.6, color: "#8cc152" }, // 中植生
    { key: "dense",    min: 0.6, max: 1.01, color: "#2e7d32" } // 高植生(喬木樹冠、林地)
  ];

  // 連續色帶(地圖疊圖用):低 NDVI 褐 → 高 NDVI 深綠
  var RAMP = [
    [-0.2, [74, 123, 183]],
    [0.0, [160, 120, 80]],
    [0.2, [217, 199, 106]],
    [0.4, [140, 193, 82]],
    [0.6, [62, 145, 60]],
    [0.85, [20, 83, 35]]
  ];

  // ---------- 小工具 ----------
  function sleep0() { return new Promise(function (r) { setTimeout(r, 0); }); }

  function abortError() {
    var e = new Error("aborted");
    e.name = "AbortError";
    return e;
  }

  function fetchJSON(url, init, ms, signal) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = null;
    if (ctrl) {
      timer = setTimeout(function () { ctrl.abort(); }, ms || 20000);
      if (signal) {
        if (signal.aborted) ctrl.abort();
        else signal.addEventListener("abort", function () { ctrl.abort(); });
      }
      init = Object.assign({}, init, { signal: ctrl.signal });
    }
    return fetch(url, init).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).finally(function () { if (timer) clearTimeout(timer); });
  }

  // 首次使用時才載入 geotiff.js(約 300 KB),不拖慢一般使用者
  var geotiffPromise = null;
  function ensureGeoTIFF() {
    if (global.GeoTIFF && global.GeoTIFF.fromUrl) return Promise.resolve(global.GeoTIFF);
    if (geotiffPromise) return geotiffPromise;
    if (typeof document === "undefined") return Promise.reject(new Error("GeoTIFF library unavailable"));
    geotiffPromise = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = GEOTIFF_CDN;
      s.onload = function () {
        global.GeoTIFF && global.GeoTIFF.fromUrl ? resolve(global.GeoTIFF) : reject(new Error("GeoTIFF load failed"));
      };
      s.onerror = function () { geotiffPromise = null; reject(new Error("GeoTIFF CDN error")); };
      document.head.appendChild(s);
    });
    return geotiffPromise;
  }

  // ---------- WGS84 → UTM(橫麥卡托,Snyder 1987;區內誤差遠小於 10 m 像元)----------
  var A = 6378137, F = 1 / 298.257223563, K0 = 0.9996;
  var E2 = F * (2 - F), EP2 = E2 / (1 - E2);
  var E4 = E2 * E2, E6 = E4 * E2;
  function utm(lat, lng, zone) {
    var phi = lat * Math.PI / 180;
    var lam0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;
    var lam = lng * Math.PI / 180;
    var sin = Math.sin(phi), cos = Math.cos(phi), tan = Math.tan(phi);
    var N = A / Math.sqrt(1 - E2 * sin * sin);
    var T = tan * tan;
    var C = EP2 * cos * cos;
    var Aa = cos * (lam - lam0);
    var M = A * ((1 - E2 / 4 - 3 * E4 / 64 - 5 * E6 / 256) * phi -
      (3 * E2 / 8 + 3 * E4 / 32 + 45 * E6 / 1024) * Math.sin(2 * phi) +
      (15 * E4 / 256 + 45 * E6 / 1024) * Math.sin(4 * phi) -
      (35 * E6 / 3072) * Math.sin(6 * phi));
    var x = K0 * N * (Aa + (1 - T + C) * Math.pow(Aa, 3) / 6 +
      (5 - 18 * T + T * T + 72 * C - 58 * EP2) * Math.pow(Aa, 5) / 120) + 500000;
    var y = K0 * (M + N * tan * (Aa * Aa / 2 + (5 - T + 9 * C + 4 * C * C) * Math.pow(Aa, 4) / 24 +
      (61 - 58 * T + T * T + 600 * C - 330 * EP2) * Math.pow(Aa, 6) / 720));
    return [x, y];
  }

  function zoneFromEpsg(props) {
    var code = props && (props["proj:epsg"] || props["proj:code"]);
    var n = parseInt(String(code || "").replace(/[^0-9]/g, ""), 10);
    if (n >= 32601 && n <= 32660) return n - 32600; // 北半球 UTM
    return null;
  }

  // ---------- 範圍幾何 ----------
  // 取出 GeoJSON 的所有環(外環 + 內洞),供偶奇規則判斷點是否在範圍內
  function polygonRings(gj) {
    var g = gj && (gj.geometry || gj);
    if (!g) return [];
    if (g.type === "Polygon") return g.coordinates;
    if (g.type === "MultiPolygon") {
      var out = [];
      g.coordinates.forEach(function (p) { p.forEach(function (r) { out.push(r); }); });
      return out;
    }
    return [];
  }

  // 經緯度範圍框 [W, S, E, N]
  function scopeBBox(opts) {
    if (opts.polygon) {
      var w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
      polygonRings(opts.polygon).forEach(function (ring) {
        ring.forEach(function (p) {
          if (p[0] < w) w = p[0]; if (p[0] > e) e = p[0];
          if (p[1] < s) s = p[1]; if (p[1] > n) n = p[1];
        });
      });
      return [w, s, e, n];
    }
    var r = opts.radiusM || 500;
    var dLat = r / 111320, dLng = r / (111320 * Math.cos(opts.lat * Math.PI / 180));
    return [opts.lng - dLng, opts.lat - dLat, opts.lng + dLng, opts.lat + dLat];
  }

  // 建立「像元中心是否在分析範圍內」的判斷函式(在 UTM 平面上計算)
  function makeScopeTest(opts, zone) {
    if (opts.polygon) {
      var rings = polygonRings(opts.polygon).map(function (ring) {
        return ring.map(function (p) { return utm(p[1], p[0], zone); });
      });
      return function (x, y) {
        var inside = false;
        for (var k = 0; k < rings.length; k++) {
          var ring = rings[k];
          for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
          }
        }
        return inside;
      };
    }
    var c = utm(opts.lat, opts.lng, zone), r2 = Math.pow(opts.radiusM || 500, 2);
    return function (x, y) {
      var dx = x - c[0], dy = y - c[1];
      return dx * dx + dy * dy <= r2;
    };
  }

  // 範圍框四角 + 邊中點轉 UTM 後取外包矩形(經緯網在 UTM 上略有旋轉,多取幾點較穩)
  function utmBounds(bb, zone) {
    var pts = [];
    for (var i = 0; i <= 2; i++) {
      for (var j = 0; j <= 2; j++) {
        var lng = bb[0] + (bb[2] - bb[0]) * i / 2, lat = bb[1] + (bb[3] - bb[1]) * j / 2;
        pts.push(utm(lat, lng, zone));
      }
    }
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach(function (p) {
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    });
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }

  // ---------- STAC 查詢 ----------
  function searchScenes(bb, signal) {
    var now = new Date();
    var from = new Date(now.getTime() - LOOKBACK_DAYS * 86400000);
    var body = {
      collections: [COLLECTION],
      intersects: {
        type: "Polygon",
        coordinates: [[[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]], [bb[0], bb[1]]]]
      },
      datetime: from.toISOString() + "/" + now.toISOString(),
      query: { "eo:cloud_cover": { lt: MAX_SCENE_CLOUD } },
      sortby: [{ field: "properties.datetime", direction: "desc" }],
      limit: 30
    };
    return fetchJSON(STAC_SEARCH, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/geo+json" },
      body: JSON.stringify(body)
    }, 25000, signal).then(function (fc) {
      var feats = (fc && fc.features) || [];
      return feats.map(function (f) {
        var p = f.properties || {}, as = f.assets || {};
        var red = as.red || as.B04, nir = as.nir || as.B08, scl = as.scl || as.SCL;
        if (!red || !nir || !scl) return null;
        var zone = zoneFromEpsg(p);
        if (!zone) return null;
        var rb = (red["raster:bands"] && red["raster:bands"][0]) || {};
        var nb = (nir["raster:bands"] && nir["raster:bands"][0]) || {};
        // 處理基準 04.00(2022-01-25)起 ESA 的 L2A 數值加上 BOA_ADD_OFFSET(+1000)。
        // 但 sentinel-cogs 的 COG 在轉檔時已扣回(earthsearch:boa_offset_applied = true),
        // 像元值即「反射率 × 10000」;此時 STAC raster:bands 雖仍列 offset −0.1,不可再套一次
        // (2021–2026 實測:SCL 植生像元紅光中位數 229–582 DN,即反射率 2–6%,確認未含 +1000)。
        var pb = parseFloat(p["s2:processing_baseline"] || "0");
        var harmonized = p["earthsearch:boa_offset_applied"] === true;
        var defOffset = pb >= 4 ? -0.1 : 0;
        var redOff = harmonized ? 0 : (rb.offset != null ? rb.offset : defOffset);
        var nirOff = harmonized ? 0 : (nb.offset != null ? nb.offset : defOffset);
        return {
          id: f.id,
          datetime: p.datetime,
          date: String(p.datetime || "").slice(0, 10),
          platform: p.platform || "",
          cloud: p["eo:cloud_cover"],
          baseline: p["s2:processing_baseline"] || null,
          zone: zone,
          tile: (p["mgrs:utm_zone"] ? String(p["mgrs:utm_zone"]) + (p["mgrs:latitude_band"] || "") + (p["mgrs:grid_square"] || "") : null),
          red: red.href, nir: nir.href, scl: scl.href,
          redScale: rb.scale != null ? rb.scale : 0.0001, redOffset: redOff,
          nirScale: nb.scale != null ? nb.scale : 0.0001, nirOffset: nirOff
        };
      }).filter(function (s) { return s && /^https:/.test(s.red) && /^https:/.test(s.nir) && /^https:/.test(s.scl); });
    });
  }

  // ---------- COG 視窗讀取 ----------
  // 依範圍(UTM 外包矩形)選金字塔層並換算像元視窗;超出影像範圍回 null
  function pickLevel(tiff, ub, maxPx) {
    return tiff.getImageCount().then(function (n) {
      return tiff.getImage(0).then(function (base) {
        var origin = base.getOrigin(), res0 = base.getResolution(); // res0[1] 為負
        var W0 = base.getWidth(), H0 = base.getHeight();
        var levels = [];
        for (var i = 0; i < n; i++) levels.push(i);
        return levels.reduce(function (p, i) {
          return p.then(function (found) {
            if (found) return found;
            return (i === 0 ? Promise.resolve(base) : tiff.getImage(i)).then(function (img) {
              var W = img.getWidth(), H = img.getHeight();
              var rx = res0[0] * W0 / W, ry = Math.abs(res0[1]) * H0 / H;
              var c0 = Math.floor((ub.x0 - origin[0]) / rx), c1 = Math.ceil((ub.x1 - origin[0]) / rx);
              var r0 = Math.floor((origin[1] - ub.y1) / ry), r1 = Math.ceil((origin[1] - ub.y0) / ry);
              if (c0 < 0 || r0 < 0 || c1 > W || r1 > H) return { outside: true };
              if ((c1 - c0) > maxPx || (r1 - r0) > maxPx) {
                return i === n - 1 ? { img: img, level: i, rx: rx, ry: ry, origin: origin, win: [c0, r0, c1, r1] } : null;
              }
              return { img: img, level: i, rx: rx, ry: ry, origin: origin, win: [c0, r0, c1, r1] };
            });
          });
        }, Promise.resolve(null));
      });
    });
  }

  function readWindow(GeoTIFF, href, ub, maxPx, signal) {
    return GeoTIFF.fromUrl(href, { allowFullFile: false }, signal).then(function (tiff) {
      return pickLevel(tiff, ub, maxPx).then(function (lv) {
        if (!lv || lv.outside) return { outside: true };
        return lv.img.readRasters({ window: lv.win, samples: [0], interleave: true, signal: signal }).then(function (data) {
          return {
            data: data, width: lv.win[2] - lv.win[0], height: lv.win[3] - lv.win[1],
            x0: lv.origin[0] + lv.win[0] * lv.rx, y0: lv.origin[1] - lv.win[1] * lv.ry,
            rx: lv.rx, ry: lv.ry, level: lv.level
          };
        });
      });
    });
  }

  // 依 SCL 計算範圍內晴空比例
  function sclClearFraction(scl, inScope, ub) {
    var tot = 0, ok = 0;
    for (var r = 0; r < scl.height; r++) {
      var y = scl.y0 - (r + 0.5) * scl.ry;
      if (y < ub.y0 - scl.ry || y > ub.y1 + scl.ry) continue;
      for (var c = 0; c < scl.width; c++) {
        var x = scl.x0 + (c + 0.5) * scl.rx;
        if (!inScope(x, y)) continue;
        tot++;
        if (!SCL_INVALID[scl.data[r * scl.width + c]]) ok++;
      }
    }
    if (!tot) {
      // 範圍小於一個 SCL 像元(20 m):改取範圍中心所在像元
      var cc = Math.floor(((ub.x0 + ub.x1) / 2 - scl.x0) / scl.rx), cr = Math.floor((scl.y0 - (ub.y0 + ub.y1) / 2) / scl.ry);
      if (cc < 0 || cr < 0 || cc >= scl.width || cr >= scl.height) return 0;
      return SCL_INVALID[scl.data[cr * scl.width + cc]] ? 0 : 1;
    }
    return ok / tot;
  }

  // 檢查一景:讀 SCL 視窗 → 範圍內晴空比例
  function checkScene(GeoTIFF, sc, opts, bb, signal) {
    var ub = utmBounds(bb, sc.zone);
    var inScope = makeScopeTest(opts, sc.zone);
    return readWindow(GeoTIFF, sc.scl, ub, MAX_PX, signal).then(function (scl) {
      if (scl.outside) return { scene: sc, clear: -1, outside: true };
      return { scene: sc, clear: sclClearFraction(scl, inScope, ub), scl: scl };
    }).catch(function (e) {
      if (e && e.name === "AbortError") throw e;
      return { scene: sc, clear: -1, error: e };
    });
  }

  function pickScene(GeoTIFF, scenes, opts, bb, signal, progress) {
    var list = scenes.slice(0, MAX_CANDIDATES);
    var best = null, checked = 0, idx = 0, lastError = null, nOutside = 0;
    function nextBatch() {
      if (signal && signal.aborted) return Promise.reject(abortError());
      if (idx >= list.length) return Promise.resolve(null);
      var batch = list.slice(idx, idx + BATCH);
      idx += batch.length;
      progress("check", { i: Math.min(idx, list.length), n: list.length, date: batch[0].date });
      return Promise.all(batch.map(function (sc) { return checkScene(GeoTIFF, sc, opts, bb, signal); }))
        .then(function (res) {
          checked += res.length;
          for (var k = 0; k < res.length; k++) { // batch 內依日期新→舊
            var r = res[k];
            if (r.error) lastError = r.error;
            if (r.outside) nOutside++;
            if (r.clear < 0) continue;
            if (!best || r.clear > best.clear + 1e-9) best = r;
            if (r.clear >= GOOD_CLEAR) return r;
          }
          return nextBatch();
        });
    }
    return nextBatch().then(function (good) {
      // 沒有任何一景成功讀到基地:是連線問題就回報連線錯誤,是範圍超出單一圖塊就回報範圍問題,
      // 不要誤報成「雲量過多」
      if (!best) {
        if (lastError) throw lastError;
        if (nOutside) { var e = new Error("site outside a single tile"); e.code = "OUTSIDE"; throw e; }
      }
      var chosen = good || (best && best.clear >= MIN_CLEAR ? best : null);
      return { chosen: chosen, best: best, checked: checked };
    });
  }

  // ---------- 色帶 ----------
  function colorFor(v) {
    if (v <= RAMP[0][0]) return RAMP[0][1];
    for (var i = 1; i < RAMP.length; i++) {
      if (v <= RAMP[i][0]) {
        var a = RAMP[i - 1], b = RAMP[i], t = (v - a[0]) / (b[0] - a[0]);
        return [
          Math.round(a[1][0] + (b[1][0] - a[1][0]) * t),
          Math.round(a[1][1] + (b[1][1] - a[1][1]) * t),
          Math.round(a[1][2] + (b[1][2] - a[1][2]) * t)
        ];
      }
    }
    return RAMP[RAMP.length - 1][1];
  }

  // 圖例用 CSS 漸層(-0.2 → 0.85)
  function legendGradient() {
    var lo = RAMP[0][0], hi = RAMP[RAMP.length - 1][0];
    return "linear-gradient(to right," + RAMP.map(function (s) {
      return "rgb(" + s[1].join(",") + ") " + Math.round((s[0] - lo) / (hi - lo) * 100) + "%";
    }).join(",") + ")";
  }

  // ---------- 疊圖:重投影到 Web Mercator 網格(最近鄰),回傳 PNG data URL + 經緯度範圍 ----------
  function mercY(lat) { return Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)); }
  function invMercY(y) { return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI; }

  function renderOverlay(grid, bb, zone) {
    if (typeof document === "undefined") return null;
    var pad = Math.max(grid.rx, grid.ry) * 1.5 / 111320; // 外擴約 1.5 像元
    var w = bb[0] - pad, e = bb[2] + pad, s = bb[1] - pad, n = bb[3] + pad;
    var srcW = (e - w) * 111320 * Math.cos((s + n) / 2 * Math.PI / 180) / grid.rx;
    var scale = Math.max(1, Math.min(4, Math.floor(900 / Math.max(srcW, 1))));
    var outW = Math.max(2, Math.round(srcW * scale));
    var my0 = mercY(n), my1 = mercY(s);
    var outH = Math.max(2, Math.round(outW * (my0 - my1) / ((e - w) * Math.PI / 180)));
    var cv = document.createElement("canvas");
    cv.width = outW; cv.height = outH;
    var ctx = cv.getContext("2d");
    var img = ctx.createImageData(outW, outH), px = img.data;
    for (var i = 0; i < outH; i++) {
      var lat = invMercY(my0 - (i + 0.5) / outH * (my0 - my1));
      for (var j = 0; j < outW; j++) {
        var lng = w + (j + 0.5) / outW * (e - w);
        var xy = utm(lat, lng, zone);
        var c = Math.floor((xy[0] - grid.x0) / grid.rx), r = Math.floor((grid.y0 - xy[1]) / grid.ry);
        if (c < 0 || r < 0 || c >= grid.width || r >= grid.height) continue;
        var k = r * grid.width + c;
        if (!grid.scope[k]) continue;
        var o = (i * outW + j) * 4;
        var v = grid.ndvi[k];
        if (isNaN(v)) { px[o] = 150; px[o + 1] = 150; px[o + 2] = 150; px[o + 3] = 120; continue; } // 雲/缺值
        var rgb = colorFor(v);
        px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; px[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return { url: cv.toDataURL("image/png"), bounds: [[s, w], [n, e]] };
  }

  // ---------- 主流程 ----------
  function analyze(opts) {
    opts = opts || {};
    var signal = opts.signal;
    var progress = typeof opts.onProgress === "function" ? opts.onProgress : function () {};
    var bb = scopeBBox(opts);
    var GeoTIFF;

    progress("search", {});
    return ensureGeoTIFF().then(function (lib) {
      GeoTIFF = lib;
      return searchScenes(bb, signal);
    }).then(function (scenes) {
      if (!scenes.length) { var e = new Error("no scenes"); e.code = "NO_SCENE"; throw e; }
      return pickScene(GeoTIFF, scenes, opts, bb, signal, progress).then(function (pick) {
        if (!pick.chosen) {
          var e2 = new Error("cloudy"); e2.code = "CLOUDY";
          e2.bestClear = pick.best ? pick.best.clear : null; e2.checked = pick.checked;
          throw e2;
        }
        return { scenes: scenes, pick: pick };
      });
    }).then(function (ctx) {
      var sc = ctx.pick.chosen.scene, scl = ctx.pick.chosen.scl;
      var ub = utmBounds(bb, sc.zone), inScope = makeScopeTest(opts, sc.zone);
      progress("read", { date: sc.date });
      return Promise.all([
        readWindow(GeoTIFF, sc.red, ub, MAX_PX, signal),
        readWindow(GeoTIFF, sc.nir, ub, MAX_PX, signal)
      ]).then(function (bands) {
        var red = bands[0], nir = bands[1];
        if (red.outside || nir.outside || red.width !== nir.width || red.height !== nir.height) {
          throw new Error("band window mismatch");
        }
        progress("compute", {});
        return sleep0().then(function () {
          return compute(sc, red, nir, scl, inScope, ub, bb, opts, ctx);
        });
      });
    });
  }

  function compute(sc, red, nir, scl, inScope, ub, bb, opts, ctx) {
    var W = red.width, H = red.height, N = W * H;
    var ndvi = new Float32Array(N), scope = new Uint8Array(N);
    var vals = [];
    var nScope = 0, nValid = 0, nCloud = 0;
    var cls = CLASSES.map(function () { return 0; });
    var hist = []; for (var hb = 0; hb < 12; hb++) hist.push(0); // -0.2..1.0,每 0.1 一格
    var sum = 0, sum2 = 0, nVeg = 0, nDense = 0;
    var rs = sc.redScale, ro = sc.redOffset, ns = sc.nirScale, no = sc.nirOffset;

    // 經驗檢核偏移:視窗內 SCL 植生(類別 4)像元的紅光 DN 中位數。植生紅光反射率約 2–8%,
    // 若中位數 < 900 DN 必未含 +1000 偏移;> 1200 DN 則必含。避免 STAC 中繼資料與像元值不一致。
    var offsetCheck = "metadata", vegRed = [];
    for (var vr = 0; vr < H; vr++) {
      var vy = red.y0 - (vr + 0.5) * red.ry, vsr = Math.floor((scl.y0 - vy) / scl.ry);
      if (vsr < 0 || vsr >= scl.height) continue;
      for (var vc = 0; vc < W; vc++) {
        var vsc = Math.floor((red.x0 + (vc + 0.5) * red.rx - scl.x0) / scl.rx);
        if (vsc < 0 || vsc >= scl.width) continue;
        var dv = red.data[vr * W + vc];
        if (dv > 0 && scl.data[vsr * scl.width + vsc] === 4) vegRed.push(dv);
      }
    }
    if (vegRed.length >= 30) {
      vegRed.sort(function (a, b) { return a - b; });
      var vmed = vegRed[Math.floor(vegRed.length / 2)];
      if ((ro !== 0 || no !== 0) && vmed < 900) { ro = 0; no = 0; offsetCheck = "empirical_none"; }
      else if (ro === 0 && no === 0 && vmed > 1200) { ro = -0.1; no = -0.1; offsetCheck = "empirical_minus_1000"; }
      else offsetCheck = "metadata_confirmed";
    }

    for (var r = 0; r < H; r++) {
      var y = red.y0 - (r + 0.5) * red.ry;
      var sr = Math.floor((scl.y0 - y) / scl.ry);
      for (var c = 0; c < W; c++) {
        var k = r * W + c;
        ndvi[k] = NaN;
        var x = red.x0 + (c + 0.5) * red.rx;
        if (!inScope(x, y)) continue;
        scope[k] = 1; nScope++;
        var sc2 = Math.floor((x - scl.x0) / scl.rx);
        var cl = (sr >= 0 && sr < scl.height && sc2 >= 0 && sc2 < scl.width) ? scl.data[sr * scl.width + sc2] : 0;
        var dr = red.data[k], dn = nir.data[k];
        if (SCL_INVALID[cl] || dr === 0 || dn === 0) { nCloud++; continue; }
        // DN → 地表反射率(套用 scale / offset);負值截為 0
        var pr = Math.max(0, dr * rs + ro), pn = Math.max(0, dn * ns + no);
        if (pr + pn <= 0) { nCloud++; continue; }
        var v = (pn - pr) / (pn + pr);
        ndvi[k] = v;
        nValid++;
        sum += v; sum2 += v * v;
        vals.push(v);
        for (var q = 0; q < CLASSES.length; q++) {
          if (v >= CLASSES[q].min && v < CLASSES[q].max) { cls[q]++; break; }
        }
        if (v >= VEG_MIN) nVeg++;
        if (v >= DENSE_MIN) nDense++;
        var bi = Math.floor((v + 0.2) / 0.1);
        hist[Math.max(0, Math.min(11, bi))]++;
      }
    }
    if (!nScope) { var e0 = new Error("scope smaller than one pixel"); e0.code = "TOO_SMALL"; throw e0; }
    if (!nValid) { var e = new Error("no valid pixels"); e.code = "CLOUDY"; e.bestClear = 0; throw e; }

    vals.sort(function (a, b) { return a - b; });
    function pct(p) { return vals[Math.min(vals.length - 1, Math.max(0, Math.round(p * (vals.length - 1))))]; }
    var mean = sum / nValid;
    var std = Math.sqrt(Math.max(0, sum2 / nValid - mean * mean));
    var pxArea = red.rx * red.ry; // m²
    var round3 = function (v) { return +v.toFixed(3); };
    var round1 = function (v) { return +v.toFixed(1); };

    var grid = { ndvi: ndvi, scope: scope, width: W, height: H, x0: red.x0, y0: red.y0, rx: red.rx, ry: red.ry };
    var overlay = null;
    try { overlay = renderOverlay(grid, bb, sc.zone); } catch (err) { overlay = null; }
    // 地圖點查:回傳該點像元 NDVI;範圍外回 undefined、雲遮/缺值回 null
    var zone = sc.zone;
    function valueAt(lat, lng) {
      var xy = utm(lat, lng, zone);
      var c = Math.floor((xy[0] - grid.x0) / grid.rx), r = Math.floor((grid.y0 - xy[1]) / grid.ry);
      if (c < 0 || r < 0 || c >= W || r >= H) return undefined;
      var k = r * W + c;
      if (!scope[k]) return undefined;
      return isNaN(ndvi[k]) ? null : ndvi[k];
    }

    return {
      scene: {
        id: sc.id, date: sc.date, datetime: sc.datetime, platform: sc.platform, tile: sc.tile,
        scene_cloud_pct: sc.cloud != null ? round1(sc.cloud) : null,
        processing_baseline: sc.baseline, utm_zone: sc.zone,
        reflectance_offset: ro, offset_check: offsetCheck
      },
      mode: opts.polygon ? "within_site" : "radius",
      radius_m: opts.polygon ? null : (opts.radiusM || 500),
      pixel_size_m: Math.round(red.rx),
      pixels_in_scope: nScope,
      pixels_valid: nValid,
      clear_sky_pct: round1(nValid / nScope * 100),
      analyzed_area_ha: +(nValid * pxArea / 10000).toFixed(2),
      scope_area_ha: +(nScope * pxArea / 10000).toFixed(2),
      mean: round3(mean), median: round3(pct(0.5)), std: round3(std),
      p10: round3(pct(0.1)), p90: round3(pct(0.9)), min: round3(vals[0]), max: round3(vals[vals.length - 1]),
      veg_cover_pct: round1(nVeg / nValid * 100),
      dense_veg_pct: round1(nDense / nValid * 100),
      classes: CLASSES.map(function (c, i) {
        return { key: c.key, min: c.min, max: Math.min(1, c.max), pct: round1(cls[i] / nValid * 100), color: c.color };
      }),
      histogram: { start: -0.2, step: 0.1, counts: hist },
      candidates_checked: ctx.pick.checked,
      candidates_found: ctx.scenes.length,
      overlay: overlay,
      valueAt: valueAt
    };
  }

  function classOf(v) {
    if (v == null || isNaN(v)) return null;
    for (var i = 0; i < CLASSES.length; i++) if (v >= CLASSES[i].min && v < CLASSES[i].max) return CLASSES[i].key;
    return v < 0 ? "water" : "dense";
  }

  global.NDVIAnalysis = {
    analyze: analyze,
    CLASSES: CLASSES,
    VEG_MIN: VEG_MIN,
    DENSE_MIN: DENSE_MIN,
    classOf: classOf,
    colorFor: colorFor,
    legendGradient: legendGradient,
    utm: utm,
    _internals: { searchScenes: searchScenes, scopeBBox: scopeBBox, makeScopeTest: makeScopeTest, utmBounds: utmBounds, readWindow: readWindow, pickScene: pickScene }
  };
})(typeof window !== "undefined" ? window : this);
