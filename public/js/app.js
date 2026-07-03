/* 基地分析工作站 — 第一階段
 * 純 JS + Leaflet + Turf.js + Leaflet.draw
 * 圖磚:內政部國土測繪中心 (NLSC) WMTS
 */
(function () {
  "use strict";

  // ---- 常數 ----
  // NLSC WMTS:GoogleMapsCompatible 等同標準 XYZ,Leaflet 直接可用
  var NLSC_TPL =
    "https://wmts.nlsc.gov.tw/wmts/{layer}/default/GoogleMapsCompatible/{z}/{y}/{x}";
  var NLSC_ATTR = "圖磚 © 內政部國土測繪中心 (NLSC)";

  // 下游「景觀規劃分區與動線」工具(深連結接收基地範圍;指向正式網域)
  var ZONING_TOOL_URL = "https://zoning8circulation.healsdesign.org";

  // 預設視野:台北 · 台灣大學附近
  var DEFAULT_CENTER = [25.0174, 121.5398];
  var DEFAULT_ZOOM = 16;

  function nlscLayer(layer, opts) {
    opts = opts || {};
    return L.tileLayer(NLSC_TPL.replace("{layer}", layer), {
      maxZoom: 20,
      minZoom: 6,
      attribution: NLSC_ATTR,
      opacity: opts.opacity != null ? opts.opacity : 1
    });
  }

  // ---- 地圖初始化 ----
  var map = L.map("map", {
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    zoomControl: true
  });

  // 視窗縮放/旋轉時讓地圖重算尺寸,避免圖磚只填半屏
  function refreshMapSize() {
    map.invalidateSize();
  }
  window.addEventListener("resize", refreshMapSize);
  window.addEventListener("orientationchange", function () {
    setTimeout(refreshMapSize, 250);
  });

  // 底圖
  var baseLayers = {
    EMAP: nlscLayer("EMAP"),
    PHOTO_MIX: nlscLayer("PHOTO_MIX"), // 正射影像 + 道路/地名註記套疊
    PHOTO2: nlscLayer("PHOTO2")
  };
  var currentBase = "EMAP";
  baseLayers.EMAP.addTo(map);

  // 疊圖圖層(NLSC WMTS + 地質調查所 WMS,可多選 + 共用透明度)
  var GEO_WMS = "https://geomap.gsmma.gov.tw/mapguide/mapagent/mapagent.fcgi";
  var overlayOpacity = 0.55;

  function warnOverlay(id) {
    var w = document.getElementById("ovwarn-" + id);
    if (w) w.textContent = t("ov.warn");
  }
  function clearOverlayWarn(id) {
    var w = document.getElementById("ovwarn-" + id);
    if (w) w.textContent = "";
  }

  // NLSC 圖磚疊圖(標準 XYZ tile)
  function nlscOverlay(layerId, def) {
    var layer = nlscLayer(layerId, { opacity: overlayOpacity });
    // 只有「完全載不出任何一塊圖磚」才視為失敗。
    // 部分圖磚 404(非都市/海面/山區本就無分區圖資)屬正常,不應誤報。
    var loadedOnce = false;
    layer.on("tileload", function () {
      if (!loadedOnce) { loadedOnce = true; clearOverlayWarn(def.id); }
    });
    layer.on("tileerror", function () { if (!loadedOnce) warnOverlay(def.id); });
    return {
      active: false,
      add: function () {
        loadedOnce = false; clearOverlayWarn(def.id);
        layer.addTo(map); layer.bringToFront(); this.active = true;
      },
      remove: function () { map.removeLayer(layer); this.active = false; },
      setOpacity: function (o) { layer.setOpacity(o); },
      front: function () { if (map.hasLayer(layer)) layer.bringToFront(); }
    };
  }

  // 地質 WMS:改用「單張影像疊圖」(複製確認可用的 GetMap 請求),
  // 避免 Leaflet 切磚式 WMS 在 MapGuide 回空白圖磚
  function geoOverlay(layerName, def) {
    var img = null;
    var self = { active: false };
    function refresh() {
      if (!self.active) return;
      var b = map.getBounds(), s = map.getSize();
      var url = GEO_WMS + "?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&STYLES=" +
        "&CRS=EPSG:4326&FORMAT=image/png&TRANSPARENT=true" +
        "&WIDTH=" + s.x + "&HEIGHT=" + s.y +
        "&LAYERS=" + encodeURIComponent(layerName) +
        "&BBOX=" + b.getSouth() + "," + b.getWest() + "," + b.getNorth() + "," + b.getEast();
      if (img) map.removeLayer(img);
      img = L.imageOverlay(url, b, { opacity: overlayOpacity, interactive: false });
      img.on("error", function () { warnOverlay(def.id); });
      img.addTo(map);
    }
    self.add = function () { self.active = true; refresh(); map.on("moveend", refresh); };
    self.remove = function () {
      self.active = false; map.off("moveend", refresh);
      if (img) { map.removeLayer(img); img = null; }
    };
    self.setOpacity = function (o) { if (img) img.setOpacity(o); };
    self.front = function () { if (img) img.bringToFront(); };
    return self;
  }

  var OVERLAY_DEFS = [
    { id: "LUIMAP", label: "國土利用調查(綠地/土地利用)", type: "nlsc" },
    { id: "SCHOOL", label: "各級學校範圍(學區)", type: "nlsc" },
    { id: "LANDSECT", label: "段籍圖(地籍)", type: "nlsc" },
    { id: "PUBLICLAND", label: "公有土地地籍圖(公私有判讀)", type: "nlsc", layer: "LAND_OPENDATA" },
    { id: "LIQUEFACTION", label: "土壤液化潛勢", type: "geo", layer: "WMS/Geomap_Envi_Soil_liquefatcion_2021" },
    { id: "FAULT", label: "活動斷層分布線(2021)", type: "geo", layer: "WMS/25K_Geomap_fault_2021" },
    { id: "FAULT_ZONE", label: "活動斷層地質敏感區(帶狀)", type: "geo", layer: "WMS/Sensitive_area_fault" }
  ];
  var overlays = {};
  OVERLAY_DEFS.forEach(function (def) {
    overlays[def.id] = def.type === "geo"
      ? geoOverlay(def.layer, def)
      : nlscOverlay(def.layer || def.id, def);
  });
  function bringOverlaysToFront() {
    OVERLAY_DEFS.forEach(function (def) {
      if (overlays[def.id].active) overlays[def.id].front();
    });
  }

  // ---- 圖層群組 ----
  var markersGroup = L.layerGroup().addTo(map);
  var drawnItems = new L.FeatureGroup().addTo(map);

  // 最近一次分析焦點(放標記或畫基地時更新),供綠地分析使用
  var lastFocus = null;
  // 最近一次畫的基地多邊形(GeoJSON);有值時綠地分析改為「範圍內」模式
  var lastSitePolygon = null;
  // 最近一次對應到的行政區指標(供熱環境/健康研判使用)
  var lastRegionProps = null;
  // 最近一次基地面積(公頃)與彙整分析資料(供 AI 解讀使用)
  var lastSiteAreaHa = null;
  var lastAnalysis = null;
  var lastRegionTitle = "";
  var lastBiodiv = null;

  // =========================================================
  //  底圖切換
  // =========================================================
  document.getElementById("basemap-group").addEventListener("change", function (e) {
    if (e.target.name !== "basemap") return;
    var next = e.target.value;
    if (next === currentBase) return;
    map.removeLayer(baseLayers[currentBase]);
    baseLayers[next].addTo(map);
    // 確保疊圖保持在底圖之上
    bringOverlaysToFront();
    currentBase = next;
  });

  // =========================================================
  //  疊圖圖層清單 + 共用透明度
  // =========================================================
  var overlayListEl = document.getElementById("overlay-list");
  OVERLAY_DEFS.forEach(function (def) {
    var row = document.createElement("label");
    row.className = "switch-row";
    row.innerHTML = "<input type='checkbox' data-ov='" + def.id + "'> " +
      "<span class='ov-label' data-ovkey='ov." + def.id + "'>" + t("ov." + def.id) + "</span>" +
      " <span class='ovwarn' id='ovwarn-" + def.id + "'></span>";
    overlayListEl.appendChild(row);
  });
  overlayListEl.addEventListener("change", function (e) {
    var id = e.target.getAttribute && e.target.getAttribute("data-ov");
    if (!id) return;
    var rec = overlays[id];
    if (e.target.checked) { rec.add(); } else { rec.remove(); }
  });

  var ovOpacity = document.getElementById("ov-opacity");
  var ovOpacityVal = document.getElementById("ov-opacity-val");
  ovOpacity.addEventListener("input", function () {
    overlayOpacity = parseFloat(ovOpacity.value);
    ovOpacityVal.textContent = overlayOpacity.toFixed(2);
    OVERLAY_DEFS.forEach(function (def) { overlays[def.id].setOpacity(overlayOpacity); });
  });

  // =========================================================
  //  工具:標記 / 多邊形 / 清除
  // =========================================================
  var toolMarkerBtn = document.getElementById("tool-marker");
  var toolPolygonBtn = document.getElementById("tool-polygon");
  var toolClearBtn = document.getElementById("tool-clear");
  var toolHint = document.getElementById("tool-hint");

  var markerMode = false;
  var polygonDrawer = null;

  function setMarkerBtnState(active) {
    toolMarkerBtn.classList.toggle("active", active);
  }
  function setPolygonBtnState(active) {
    toolPolygonBtn.classList.toggle("active", active);
  }

  // --- 標記模式 ---
  function enableMarkerMode() {
    if (markerMode) {
      disableMarkerMode();
      return;
    }
    cancelPolygonDraw();
    markerMode = true;
    setMarkerBtnState(true);
    map.getContainer().style.cursor = "crosshair";
    toolHint.textContent = t("t.markerOn");
  }
  function disableMarkerMode() {
    markerMode = false;
    setMarkerBtnState(false);
    map.getContainer().style.cursor = "";
    toolHint.innerHTML = t("tools.hint"); // tools.hint 含 <b> 富文字
  }

  toolMarkerBtn.addEventListener("click", enableMarkerMode);

  map.on("click", function (e) {
    if (!markerMode) return;
    var m = L.marker(e.latlng).addTo(markersGroup);
    m.bindPopup(
      t("t.marker") + "<br>" + t("t.lat") + " " +
        e.latlng.lat.toFixed(5) +
        "<br>" + t("t.lng") + " " +
        e.latlng.lng.toFixed(5)
    ).openPopup();
    lastFocus = e.latlng;
    lastSitePolygon = null; // 點模式
    // 點 → 查村里人口指標
    lookupVillage(e.latlng.lat, e.latlng.lng);
    if (cmState.allPoints.length) refreshCommentScope(); // 已載入意見:重新依新焦點篩選
  });

  // --- 多邊形繪製 ---
  function cancelPolygonDraw() {
    if (polygonDrawer) {
      polygonDrawer.disable();
      polygonDrawer = null;
    }
    setPolygonBtnState(false);
  }

  toolPolygonBtn.addEventListener("click", function () {
    if (polygonDrawer) {
      cancelPolygonDraw();
      toolHint.textContent = t("t.drawCancel");
      return;
    }
    disableMarkerMode();
    polygonDrawer = new L.Draw.Polygon(map, {
      shapeOptions: { color: "#3ba88f", weight: 2, fillOpacity: 0.2 },
      allowIntersection: false,
      showArea: false
    });
    polygonDrawer.enable();
    setPolygonBtnState(true);
    toolHint.textContent = t("t.drawStart");
  });

  map.on(L.Draw.Event.CREATED, function (e) {
    drawnItems.addLayer(e.layer);
    polygonDrawer = null;
    setPolygonBtnState(false);
    computeArea();
    toolHint.textContent = t("t.drawDone");
    // 面 → 取範圍中心,查所在鄉鎮市區指標
    try {
      var c = turf.centroid(e.layer.toGeoJSON());
      var xy = c.geometry.coordinates; // [lng, lat]
      lastFocus = L.latLng(xy[1], xy[0]);
      lastSitePolygon = e.layer.toGeoJSON(); // 面模式:分析範圍內綠地
      updateZoningBtnState(); // 已有範圍:啟用「送到分區與動線工具」
      lookupTown(xy[1], xy[0]);
      if (cmState.allPoints.length) refreshCommentScope(); // 已載入意見:依範圍篩選
    } catch (err) {
      /* 忽略 */
    }
  });

  map.on(L.Draw.Event.DRAWSTOP, function () {
    setPolygonBtnState(false);
  });

  // --- 面積計算(公頃)---
  var areaValueEl = document.getElementById("area-value");
  var areaDetailEl = document.getElementById("area-detail");

  function computeArea() {
    var totalSqm = 0;
    var count = 0;
    drawnItems.eachLayer(function (layer) {
      if (typeof layer.getLatLngs !== "function") return;
      var gj = layer.toGeoJSON();
      try {
        totalSqm += turf.area(gj);
        count++;
      } catch (err) {
        /* 忽略無法計算的圖形 */
      }
    });

    if (count === 0) {
      areaValueEl.textContent = "—";
      areaDetailEl.textContent = "";
      lastSiteAreaHa = null;
      return;
    }
    lastSiteAreaHa = +(totalSqm / 10000).toFixed(2);
    var ha = totalSqm / 10000;
    areaValueEl.textContent = ha.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    areaDetailEl.textContent =
      t("area.about") +
      Math.round(totalSqm).toLocaleString() +
      t("area.sqm") +
      count +
      t("area.shapes");
  }

  // --- 清除 ---
  toolClearBtn.addEventListener("click", function () {
    markersGroup.clearLayers();
    drawnItems.clearLayers();
    cancelPolygonDraw();
    disableMarkerMode();
    computeArea();
    resetInfoPanel();
    lastFocus = null;
    lastSitePolygon = null;
    lastBiodiv = null;
    updateZoningBtnState(); // 範圍已清:停用「送到分區與動線工具」
    resetGreenPanel();
    resetBiodivPanel();
    cmMarkers.clearLayers(); // 清意見圖層標示(保留已上傳資料,可重新選範圍篩選)
    if (cmState.allPoints.length) cmRegionEl.textContent = t("cm.reselect");
    toolHint.textContent = t("t.cleared");
  });

  // =========================================================
  //  地名搜尋 (Nominatim) + 退回處理
  // =========================================================
  var searchForm = document.getElementById("search-form");
  var searchInput = document.getElementById("search-input");
  var searchStatus = document.getElementById("search-status");
  var searchMarker = null;

  function setStatus(msg, kind) {
    searchStatus.textContent = msg;
    searchStatus.className = "status" + (kind ? " " + kind : "");
  }

  function fetchWithTimeout(url, ms, opts) {
    opts = opts || {};
    var init = {
      method: opts.method || "GET",
      headers: opts.headers || { Accept: "application/json" }
    };
    if (opts.body != null) init.body = opts.body;
    if (typeof AbortController === "undefined") {
      return fetch(url, init); // 舊瀏覽器退回,無逾時控制
    }
    var ctrl = new AbortController();
    var t = setTimeout(function () {
      ctrl.abort();
    }, ms);
    init.signal = ctrl.signal;
    return fetch(url, init).finally(function () {
      clearTimeout(t);
    });
  }

  searchForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var q = searchInput.value.trim();
    if (!q) {
      setStatus(t("s.needKw"), "error");
      return;
    }
    setStatus(t("s.searching"), null);

    // 偏向台灣結果
    var url =
      "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=tw&accept-language=zh-TW&q=" +
      encodeURIComponent(q);

    fetchWithTimeout(url, 8000)
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data || data.length === 0) {
          setStatus(t("s.notFound", {q: q}), "error");
          return;
        }
        var hit = data[0];
        var lat = parseFloat(hit.lat);
        var lon = parseFloat(hit.lon);
        map.setView([lat, lon], 16);

        if (searchMarker) markersGroup.removeLayer(searchMarker);
        searchMarker = L.marker([lat, lon]).addTo(markersGroup);
        searchMarker
          .bindPopup("<b>" + (hit.display_name || q) + "</b>")
          .openPopup();
        setStatus(t("s.located") + (hit.display_name || q), "ok");
      })
      .catch(function (err) {
        // 連線失敗 / 逾時 / 被阻擋 的退回處理
        var aborted = err && err.name === "AbortError";
        setStatus(
          (aborted ? t("s.timeout") : t("s.offline")) + t("s.retry2"),
          "error"
        );
      });
  });

  // =========================================================
  //  第二階段:人口空間對應(點→村里、面→鄉鎮)
  //  資料由 GitHub Actions 於建置時產生於 ./data/
  // =========================================================
  var DATA = {
    towns: null, townsIdx: null,
    villages: null, villagesIdx: null,
    meta: null, villagesLoading: null
  };

  var infoRegionEl = document.getElementById("info-region");
  var indicatorsEl = document.getElementById("indicators");
  var infoSourceEl = document.getElementById("info-source");

  var INDICATOR_DEFS = [
    { key: "pop", unitKey: "unit.person", int: true },
    { key: "households", unitKey: "unit.household", int: true },
    { key: "density", unitKey: "unit.person_km2" },
    { key: "household_size", unitKey: "unit.person_hh" },
    { key: "sex_ratio", unitKey: "unit.male100f" },
    { key: "aging_index", unitKey: "" },
    { key: "dep_ratio", unit: "%" },
    { key: "child_dep", unit: "%" },
    { key: "old_dep", unit: "%" },
    { key: "area_km2", unit: "km²" }
  ];

  function fmtVal(v, def) {
    if (v == null || v === "") return "—";
    if (def.int) return Math.round(v).toLocaleString();
    return Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  // 保存最近一次的人口資料,語言切換時可重繪
  var lastRegionTitleHtml = "";

  function resetInfoPanel() {
    lastRegionProps = null;
    lastRegionTitleHtml = "";
    infoRegionEl.textContent = t("pop.tip");
    indicatorsEl.innerHTML = "";
    infoSourceEl.textContent = "";
  }

  function renderIndicators(props, titleHtml) {
    lastRegionProps = props;
    lastRegionTitleHtml = titleHtml;
    lastRegionTitle = titleHtml.replace(/<[^>]+>/g, "").trim();
    infoRegionEl.innerHTML = titleHtml;
    var html = "";
    for (var i = 0; i < INDICATOR_DEFS.length; i++) {
      var d = INDICATOR_DEFS[i];
      var val = props ? props[d.key] : null;
      var unit = d.unitKey ? t(d.unitKey) : (d.unit || "");
      html +=
        "<div class='ind'><dt>" + t("ind." + d.key) + "</dt><dd>" +
        fmtVal(val, d) +
        (unit ? " <span class='u'>" + unit + "</span>" : "") +
        "</dd></div>";
    }
    indicatorsEl.innerHTML = html;
    var period = DATA.meta && DATA.meta.population_period;
    if (props && props.pop != null) {
      infoSourceEl.textContent = t("pop.period") + (period || "—") + t("pop.sourceMOI");
    } else {
      infoSourceEl.textContent = "";
    }
  }

  function buildIndex(fc) {
    var idx = [];
    for (var i = 0; i < fc.features.length; i++) {
      var f = fc.features[i];
      try {
        idx.push({ f: f, bbox: turf.bbox(f) });
      } catch (e) {
        /* 略過異常幾何 */
      }
    }
    return idx;
  }

  // 點位落在哪個多邊形(bbox 預篩 + 精確判斷)
  function locate(lng, lat, idx) {
    for (var i = 0; i < idx.length; i++) {
      var b = idx[i].bbox;
      if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) continue;
      try {
        if (turf.booleanPointInPolygon([lng, lat], idx[i].f)) return idx[i].f;
      } catch (e) {
        /* 略過 */
      }
    }
    return null;
  }

  function loadJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  // 啟動:載入鄉鎮界線 + meta(村里檔較大,延後到首次需要時才載)
  Promise.all([
    loadJSON("./data/towns.json").catch(function () { return null; }),
    loadJSON("./data/meta.json").catch(function () { return null; })
  ]).then(function (res) {
    DATA.towns = res[0];
    DATA.meta = res[1];
    if (DATA.towns) {
      DATA.townsIdx = buildIndex(DATA.towns);
      resetInfoPanel();
    } else {
      infoRegionEl.textContent =
        t("data.none");
    }
  });

  function ensureVillages() {
    if (DATA.villagesIdx) return Promise.resolve(true);
    if (DATA.villagesLoading) return DATA.villagesLoading;
    infoRegionEl.textContent = t("pop.loadingVil");
    DATA.villagesLoading = loadJSON("./data/villages.json")
      .then(function (fc) {
        DATA.villages = fc;
        DATA.villagesIdx = buildIndex(fc);
        return true;
      })
      .catch(function () {
        infoRegionEl.textContent = t("pop.failVil");
        return false;
      });
    return DATA.villagesLoading;
  }

  function lookupVillage(lat, lng) {
    ensureVillages().then(function (ok) {
      if (!ok || !DATA.villagesIdx) return;
      var f = locate(lng, lat, DATA.villagesIdx);
      if (!f) {
        infoRegionEl.textContent = t("pop.outVil");
        indicatorsEl.innerHTML = "";
        return;
      }
      var p = f.properties;
      renderIndicators(
        p,
        t("pop.village") + " · " + (p.COUNTYNAME || "") + (p.TOWNNAME || "") +
          " <b>" + (p.VILLNAME || "") + "</b>"
      );
    });
  }

  function lookupTown(lat, lng) {
    if (!DATA.townsIdx) {
      infoRegionEl.textContent = t("pop.townNotReady");
      return;
    }
    var f = locate(lng, lat, DATA.townsIdx);
    if (!f) {
      infoRegionEl.textContent = t("pop.outTown");
      indicatorsEl.innerHTML = "";
      return;
    }
    var p = f.properties;
    renderIndicators(
      p,
      t("pop.town") + " · " + (p.COUNTYNAME || "") + " <b>" + (p.TOWNNAME || "") + "</b>"
    );
  }

  // =========================================================
  //  第三階段 3a:開放空間 / 綠地可及性(OSM Overpass,瀏覽器即時查)
  // =========================================================
  var greenBtn = document.getElementById("green-btn");
  var greenRegionEl = document.getElementById("green-region");
  var greenIndEl = document.getElementById("green-indicators");
  var greenSourceEl = document.getElementById("green-source");
  var heatRegionEl = document.getElementById("heat-region");
  var heatIndEl = document.getElementById("heat-indicators");
  var heatSourceEl = document.getElementById("heat-source");
  var climateRegionEl = document.getElementById("climate-region");
  var climateIndEl = document.getElementById("climate-indicators");
  var climateSourceEl = document.getElementById("climate-source");
  var osslRegionEl = document.getElementById("ossl-region");
  var osslOutputEl = document.getElementById("ossl-output");
  var osslSourceEl = document.getElementById("ossl-source");
  var hgipRegionEl = document.getElementById("hgip-region");
  var hgipIndEl = document.getElementById("hgip-indicators");
  var hgipSourceEl = document.getElementById("hgip-source");
  var aqiRegionEl = document.getElementById("aqi-region");
  var aqiIndEl = document.getElementById("aqi-indicators");
  var aqiSourceEl = document.getElementById("aqi-source");

  var OVERPASS = "https://overpass-api.de/api/interpreter";
  var GREEN_RADIUS = 500; // 公尺:服務圈半徑
  var MIN_PARK_M2 = 1000; // 有效公園最小面積(0.1 公頃,兒童遊樂場法定最小規模)
  var greenMarkers = L.layerGroup().addTo(map);

  // Open-Meteo Archive(ERA5):免金鑰、支援瀏覽器 CORS;取近年逐日資料計算氣候背景值
  var OPEN_METEO_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";
  var CLIMATE_REF_START = "2020-01-01"; // 氣候參考期(5 個完整年,平滑單年異常)
  var CLIMATE_REF_END = "2024-12-31";
  var HEAT_DAY_TMAX_C = 32; // 高溫日門檻:單日最高溫 ≥ 32°C

  function resetGreenPanel() {
    greenRegionEl.textContent = t("green.hint");
    greenIndEl.innerHTML = "";
    greenSourceEl.textContent = "";
    greenMarkers.clearLayers();
    heatRegionEl.textContent = t("heat.hint");
    heatIndEl.innerHTML = "";
    heatSourceEl.textContent = "";
    climateRegionEl.textContent = t("climate.hint");
    climateIndEl.innerHTML = "";
    climateSourceEl.textContent = "";
    osslRegionEl.textContent = t("ossl.hint");
    osslOutputEl.innerHTML = "";
    osslSourceEl.textContent = "";
    osslCatchment.clearLayers();
    hgipRegionEl.textContent = t("hgip.hint");
    hgipIndEl.innerHTML = "";
    hgipSourceEl.textContent = "";
    aqiRegionEl.textContent = t("aqi.hint");
    aqiIndEl.innerHTML = "";
    aqiSourceEl.textContent = "";
  }

  // 熱環境/健康研判:綠覆率(對 3-30-300 的 30% 目標)× 脆弱族群(高齡+幼年)
  function renderHeat(greenCoveragePct, props) {
    var elderly = props && props.elderly_share != null ? props.elderly_share : null;
    var child = props && props.child_share != null ? props.child_share : null;
    var greenDeficit = Math.max(0, Math.min(1, (30 - greenCoveragePct) / 30)); // 0..1
    var vulnShare = elderly != null && child != null ? (elderly + child) / 100 : null;
    var vulnNorm = vulnShare != null ? Math.min(1, vulnShare / 0.4) : null; // 40% 視為高
    var heat = vulnNorm != null ? 0.5 * greenDeficit + 0.5 * vulnNorm : greenDeficit;
    var levelKey = heat > 0.66 ? "h.lvHigh" : heat > 0.34 ? "h.lvMid" : "h.lvLow";
    var level = t(levelKey);
    var color = heat > 0.66 ? "#d56456" : heat > 0.34 ? "#d8a657" : "#45c2a4";

    heatRegionEl.innerHTML = t("h.title", { c: color, lv: level });
    var html = "";
    html += ind(t("h.coverage"), greenCoveragePct.toFixed(1), "%");
    html += ind(t("h.target30"), (greenCoveragePct >= 30 ? t("g.met") : t("g.notMet")), "");
    html += ind(t("h.elderly"), elderly != null ? elderly.toFixed(1) : "—", "%");
    html += ind(t("h.child"), child != null ? child.toFixed(1) : "—", "%");
    heatIndEl.innerHTML = html;

    heatSourceEl.innerHTML = t("h.note");
    // 儲存原始 level 鍵供其他語言參考(英文/中文皆存可讀字)
    if (lastAnalysis) {
      lastAnalysis.heat = {
        green_coverage_pct: +greenCoveragePct.toFixed(1),
        meets_30pct_target: greenCoveragePct >= 30,
        elderly_share: elderly,
        child_share: child,
        vulnerability_level: level
      };
    }
    renderHGIP();
  }

  // ---- 療癒綠地介入需求指數(Healing Green Intervention Priority, HGIP)----
  // 綜合四因子(綠地匱乏、脆弱族群、熱壓力、開放空間可及性不足),各 0..1 加權。
  // 因氣候/OSSL 為非同步載入,本函式可重複呼叫:有新資料即重算,缺資料的
  // 因子自動排除並重新正規化權重,確保任一階段都有合理結果。
  function renderHGIP() {
    if (!lastAnalysis) return;
    var h = lastAnalysis.heat || {};
    var cl = lastAnalysis.climate || {};
    var os = lastAnalysis.openspace_service_level || {};

    var factors = [];
    // 1) 綠地匱乏:綠覆率對 30% 目標的缺口
    if (h.green_coverage_pct != null) {
      factors.push({ key: "green", w: 0.35,
        v: clamp01((30 - h.green_coverage_pct) / 30), labelKey: "hg.fGreen" });
    }
    // 2) 脆弱族群:高齡+幼年,40% 視為高
    if (h.elderly_share != null && h.child_share != null) {
      factors.push({ key: "vuln", w: 0.30,
        v: clamp01((h.elderly_share + h.child_share) / 40), labelKey: "hg.fVuln" });
    }
    // 3) 熱壓力:年高溫日數,90 天視為極高
    if (cl.heat_days_per_year_ge32c != null) {
      factors.push({ key: "heat", w: 0.20,
        v: clamp01(cl.heat_days_per_year_ge32c / 90), labelKey: "hg.fHeat" });
    }
    // 4) 開放空間可及性不足:OSSL 總分越低越缺
    if (os.overall != null) {
      factors.push({ key: "access", w: 0.15,
        v: clamp01((100 - os.overall) / 100), labelKey: "hg.fAccess" });
    }

    if (!factors.length) { hgipRegionEl.textContent = t("hgip.hint"); hgipIndEl.innerHTML = ""; hgipSourceEl.textContent = ""; return; }

    var wsum = 0, acc = 0;
    factors.forEach(function (f) { wsum += f.w; acc += f.w * f.v; });
    var index = Math.round((acc / wsum) * 100); // 0..100

    var levelKey = index >= 67 ? "hg.lvHigh" : index >= 34 ? "hg.lvMid" : "hg.lvLow";
    var level = t(levelKey);
    var color = index >= 67 ? "#d56456" : index >= 34 ? "#d8a657" : "#45c2a4";

    hgipRegionEl.innerHTML = t("hg.title", { s: index, lv: level, c: color });
    var html = "";
    // 主導因子(貢獻度 = 權重×值,取最大者)供規劃聚焦
    var top = factors.slice().sort(function (a, b) { return (b.w * b.v) - (a.w * a.v); })[0];
    factors.forEach(function (f) {
      var pct = Math.round(f.v * 100);
      var mark = f.key === top.key ? " ◀" : "";
      html += ind(t(f.labelKey), pct + mark, "%");
    });
    hgipIndEl.innerHTML = html;
    hgipSourceEl.innerHTML = t("hg.note", { f: t(top.labelKey) });

    lastAnalysis.healing_green_intervention = {
      index: index,
      priority_level: level,
      dominant_factor: top.key,
      factors: factors.map(function (f) {
        return { key: f.key, normalized: +f.v.toFixed(2), weight: f.w };
      })
    };
  }

  function clamp01(x) { return Math.max(0, Math.min(1, x)); }

  // ---- 氣候背景(Open-Meteo ERA5)----
  function avg(arr) {
    return arr.length ? arr.reduce(function (s, v) { return s + v; }, 0) / arr.length : 0;
  }

  // 依基地中心點向 Open-Meteo Archive 查近年逐日資料,計算氣候背景值
  function loadClimate(lat, lng) {
    climateRegionEl.textContent = t("cl.loading");
    climateIndEl.innerHTML = "";
    climateSourceEl.textContent = "";
    var params =
      "latitude=" + lat.toFixed(4) + "&longitude=" + lng.toFixed(4) +
      "&start_date=" + CLIMATE_REF_START + "&end_date=" + CLIMATE_REF_END +
      "&daily=temperature_2m_mean,temperature_2m_max,precipitation_sum," +
      "wind_direction_10m_dominant,shortwave_radiation_sum" +
      "&timezone=auto";
    var url = OPEN_METEO_ARCHIVE + "?" + params;

    fetchWithTimeout(url, 25000)
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (data) { renderClimate(data); })
      .catch(function (err) {
        var aborted = err && err.name === "AbortError";
        climateRegionEl.textContent = aborted ? t("cl.timeout") : t("cl.offline");
        climateSourceEl.textContent = "";
      });
  }

  function renderClimate(data) {
    var d = (data && data.daily) || {};
    var time = d.time || [];
    var tmean = d.temperature_2m_mean || [];
    var tmax = d.temperature_2m_max || [];
    var precip = d.precipitation_sum || [];
    var wdir = d.wind_direction_10m_dominant || [];
    var rad = d.shortwave_radiation_sum || [];
    if (!time.length) { climateRegionEl.textContent = t("cl.nodata"); return; }

    // 參考期內年數(平均年值用)
    var yearSet = {};
    time.forEach(function (s) { yearSet[s.slice(0, 4)] = true; });
    var nYears = Object.keys(yearSet).length || 1;

    // 年均溫
    var annualMean = avg(tmean.filter(function (v) { return v != null; }));

    // 最熱月(逐月平均溫取最大)
    var monSum = {}, monN = {};
    time.forEach(function (s, i) {
      var m = s.slice(5, 7), v = tmean[i];
      if (v == null) return;
      monSum[m] = (monSum[m] || 0) + v; monN[m] = (monN[m] || 0) + 1;
    });
    var hotMon = null, hotVal = -Infinity;
    Object.keys(monSum).forEach(function (m) {
      var a = monSum[m] / monN[m];
      if (a > hotVal) { hotVal = a; hotMon = m; }
    });

    // 年降雨量(總和 / 年數)
    var annualPrecip = precip.reduce(function (s, v) { return s + (v || 0); }, 0) / nYears;

    // 高溫日數 / 年(單日最高溫 ≥ 門檻)
    var heatDaysYr =
      tmax.filter(function (v) { return v != null && v >= HEAT_DAY_TMAX_C; }).length / nYears;

    // 盛行風向(來向,8 方位取眾數)
    var sectors = [0, 0, 0, 0, 0, 0, 0, 0];
    wdir.forEach(function (v) { if (v == null) return; sectors[Math.round(v / 45) % 8]++; });
    var domIdx = sectors.indexOf(Math.max.apply(null, sectors));
    var dirKeys = ["cl.N", "cl.NE", "cl.E", "cl.SE", "cl.S", "cl.SW", "cl.W", "cl.NW"];
    var dirLabel = t(dirKeys[domIdx]);

    // 日均日射量(MJ/m²)
    var avgRad = avg(rad.filter(function (v) { return v != null; }));

    climateRegionEl.innerHTML = t("cl.title", { y: nYears });
    var html = "";
    html += ind(t("cl.annualMean"), annualMean.toFixed(1), "°C");
    html += ind(t("cl.hottest"), t("cl.mon" + hotMon) + " " + hotVal.toFixed(1), "°C");
    html += ind(t("cl.heatDays"), heatDaysYr.toFixed(0), t("cl.daysYr"));
    html += ind(t("cl.precip"), annualPrecip.toFixed(0), "mm");
    html += ind(t("cl.wind"), dirLabel, "");
    html += ind(t("cl.solar"), avgRad.toFixed(1), "MJ/m²");
    climateIndEl.innerHTML = html;
    climateSourceEl.innerHTML = t("cl.note", {
      s: CLIMATE_REF_START.slice(0, 4), e: CLIMATE_REF_END.slice(0, 4)
    });

    if (lastAnalysis) {
      lastAnalysis.climate = {
        source: "Open-Meteo ERA5",
        reference_period: CLIMATE_REF_START.slice(0, 4) + "-" + CLIMATE_REF_END.slice(0, 4),
        annual_mean_temp_c: +annualMean.toFixed(1),
        hottest_month: hotMon,
        hottest_month_mean_c: +hotVal.toFixed(1),
        heat_days_per_year_ge32c: +heatDaysYr.toFixed(0),
        annual_precip_mm: +annualPrecip.toFixed(0),
        dominant_wind_dir: dirLabel,
        avg_daily_solar_mj_m2: +avgRad.toFixed(1)
      };
      renderHGIP(); // 氣候(熱壓力)到位,重算介入需求
    }
  }

  // ---- 空氣品質 AQI(環境部,經 /api/aqi 後端代理)----
  // 全站測站清單快取(每小時更新,前端 session 內只取一次)
  var aqiStationsCache = null;

  function aqiBand(aqi) {
    // 依環境部 AQI 分級配色
    if (aqi == null) return { key: "aqi.lvNA", color: "#888" };
    if (aqi <= 50) return { key: "aqi.lvGood", color: "#45c2a4" };
    if (aqi <= 100) return { key: "aqi.lvModerate", color: "#d8c95b" };
    if (aqi <= 150) return { key: "aqi.lvUSG", color: "#e08a47" };
    if (aqi <= 200) return { key: "aqi.lvUnhealthy", color: "#d56456" };
    if (aqi <= 300) return { key: "aqi.lvVeryUnhealthy", color: "#9b59b6" };
    return { key: "aqi.lvHazardous", color: "#7a3b2e" };
  }

  function loadAQI(lat, lng) {
    aqiRegionEl.textContent = t("aqi.loading");
    aqiIndEl.innerHTML = "";
    aqiSourceEl.textContent = "";

    var proceed = function (payload) {
      var stations = (payload && payload.stations) || [];
      if (!stations.length) {
        aqiRegionEl.textContent = t("aqi.nodata");
        // 顯示診斷:原始筆數與欄位名,協助定位欄位不符問題
        if (payload && payload.rawCount != null) {
          aqiSourceEl.textContent = "diag: rawCount=" + payload.rawCount +
            " keys=" + ((payload.sampleKeys || []).join(",") || "—");
        }
        return;
      }
      // 找最近測站
      var best = null, bestD = Infinity;
      stations.forEach(function (s) {
        var d = haversineM(lat, lng, s.lat, s.lng);
        if (d < bestD) { bestD = d; best = s; }
      });
      if (!best) { aqiRegionEl.textContent = t("aqi.nodata"); return; }

      var band = aqiBand(best.aqi);
      var level = t(band.key);
      aqiRegionEl.innerHTML = t("aqi.title", {
        s: best.site, d: (bestD / 1000).toFixed(1), c: band.color,
        aqi: best.aqi == null ? "—" : best.aqi, lv: level
      });
      var html = "";
      html += ind(t("aqi.aqi"), best.aqi == null ? "—" : best.aqi, "");
      html += ind(t("aqi.status"), best.status || level, "");
      html += ind(t("aqi.pm25"), best.pm25 == null ? "—" : best.pm25, "µg/m³");
      html += ind(t("aqi.pm10"), best.pm10 == null ? "—" : best.pm10, "µg/m³");
      html += ind(t("aqi.pollutant"), best.pollutant || "—", "");
      aqiIndEl.innerHTML = html;
      aqiSourceEl.innerHTML = t("aqi.note", { t: best.publishtime || "—" });

      if (lastAnalysis) {
        lastAnalysis.air_quality = {
          nearest_site: best.site,
          county: best.county,
          distance_km: +(bestD / 1000).toFixed(1),
          aqi: best.aqi,
          status: best.status,
          pm25: best.pm25,
          pm10: best.pm10,
          main_pollutant: best.pollutant,
          publish_time: best.publishtime
        };
      }
    };

    if (aqiStationsCache) { proceed(aqiStationsCache); return; }
    // 加 cache-buster(10 分鐘一桶)避開 CDN/瀏覽器對暫時性回應的舊快取,同時仍享有合理快取
    var aqiBust = Math.floor(Date.now() / 600000);
    fetchWithTimeout("./api/aqi?t=" + aqiBust, 20000)
      .then(function (r) {
        if (!r.ok) return r.text().then(function (txt) {
          var msg = txt; try { var j = JSON.parse(txt); if (j && j.error) msg = j.error; } catch (e) {}
          throw new Error(msg);
        });
        return r.json();
      })
      .then(function (data) { aqiStationsCache = data; proceed(aqiStationsCache); })
      .catch(function (e) {
        // 顯示實際錯誤以利診斷(環境變數未設、function 未部署、上游錯誤等)
        var detail = e && e.message ? e.message : String(e);
        aqiRegionEl.textContent = t("aqi.offline");
        aqiSourceEl.textContent = detail;
      });
  }

  // 兩點間距離(公尺,Haversine)
  function haversineM(aLat, aLng, bLat, bLng) {
    var R = 6371000, rad = Math.PI / 180;
    var dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  // ---- 開放空間服務水準(OpenSpaceServiceLevel 模組)----
  var osslCatchment = L.layerGroup().addTo(map);

  // 依基地中心點計算步行 10 分鐘可及性服務水準,並畫涵蓋圈
  function loadOSSL(lat, lng) {
    if (!global_OSSL()) { osslRegionEl.textContent = t("ossl.unavailable"); return; }
    osslRegionEl.textContent = t("ossl.loading");
    osslOutputEl.innerHTML = "";
    osslSourceEl.textContent = "";
    osslCatchment.clearLayers();
    global_OSSL().compute(lat, lng)
      .then(function (r) {
        osslRegionEl.innerHTML = t("ossl.title", { s: Math.round(r.overall), b: r.band.name, c: r.band.color });
        osslOutputEl.innerHTML = global_OSSL().renderHTML(r);
        osslSourceEl.innerHTML = t("ossl.note");
        // 地圖畫 10 分鐘步行涵蓋圈
        try {
          osslCatchment.clearLayers();
          global_OSSL().drawCatchment(osslCatchment, lat, lng);
        } catch (e) { /* 畫圈失敗不影響數據 */ }
        if (lastAnalysis) {
          lastAnalysis.openspace_service_level = {
            overall: r.overall,
            band: r.band.name,
            catchment_radius_m: r.catchmentRadiusMeters,
            ai_summary: global_OSSL().summaryForAI(r),
            categories: r.categories.map(function (c) {
              return { key: c.key, label: c.label, nearest_m: c.nearestMeters, count: c.count, score: c.S };
            })
          };
          renderHGIP(); // 服務水準到位,重算介入需求
        }
      })
      .catch(function () {
        osslRegionEl.textContent = t("ossl.offline");
        osslSourceEl.textContent = "";
      });
  }

  // OSSL 模組可能尚未載入(網路/快取),統一以函式取用避免 ReferenceError
  function global_OSSL() {
    return (typeof window !== "undefined" && window.OpenSpaceServiceLevel) || null;
  }

  // =========================================================
  //  使用者意見圖層(comments-layer 模組)
  // =========================================================
  var cmFileEl = document.getElementById("cm-file");
  var cmUploadBtn = document.getElementById("cm-upload");
  var cmRegionEl = document.getElementById("cm-region");
  var cmMappingEl = document.getElementById("cm-mapping");
  var cmIndEl = document.getElementById("cm-indicators");
  var cmSummaryEl = document.getElementById("cm-summary");
  var cmAiOutputEl = document.getElementById("cm-ai-output");
  var cmActionsEl = document.getElementById("cm-actions");
  var cmAiBtn = document.getElementById("cm-ai");
  var cmSourceEl = document.getElementById("cm-source");
  var cmMarkers = L.layerGroup().addTo(map);
  var CM_RADIUS = 800; // 點模式:意見篩選半徑(公尺)

  var cmState = { allPoints: [], cols: null, columns: [], inScope: [], summary: null };

  function CL() { return (typeof window !== "undefined" && window.CommentsLayer) || null; }

  cmUploadBtn.addEventListener("click", function () { if (CL()) cmFileEl.click(); else cmRegionEl.textContent = t("cm.unavailable"); });

  cmFileEl.addEventListener("change", function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    cmRegionEl.textContent = t("cm.parsing");
    cmMappingEl.style.display = "none";
    CL().parseFile(file)
      .then(function (res) {
        if (!res.rows.length) { cmRegionEl.textContent = t("cm.empty"); return; }
        cmState.columns = res.columns;
        cmState.rows = res.rows;
        cmState.cols = CL().detectColumns(res.columns);
        renderColumnMapping();
        applyCommentMapping(); // 以偵測結果先跑一次
      })
      .catch(function () { cmRegionEl.textContent = t("cm.parseErr"); })
      .finally(function () { cmFileEl.value = ""; });
  });

  // 欄位對應 UI(自動偵測 + 手動指定)
  function renderColumnMapping() {
    var opts = function (sel) {
      return "<option value=''>—</option>" + cmState.columns.map(function (c) {
        return "<option value='" + c.replace(/'/g, "&#39;") + "'" + (c === sel ? " selected" : "") + ">" + c + "</option>";
      }).join("");
    };
    cmMappingEl.innerHTML =
      "<div class='cm-map-row'><label>" + t("cm.colLat") + "</label><select id='cm-sel-lat'>" + opts(cmState.cols.lat) + "</select></div>" +
      "<div class='cm-map-row'><label>" + t("cm.colLng") + "</label><select id='cm-sel-lng'>" + opts(cmState.cols.lng) + "</select></div>" +
      "<div class='cm-map-row'><label>" + t("cm.colComment") + "</label><select id='cm-sel-comment'>" + opts(cmState.cols.comment) + "</select></div>";
    cmMappingEl.style.display = "";
    ["lat", "lng", "comment"].forEach(function (k) {
      document.getElementById("cm-sel-" + k).addEventListener("change", function (ev) {
        cmState.cols[k] = ev.target.value || null;
        applyCommentMapping();
      });
    });
  }

  // 套用欄位對應 → 建點 → 依當前 focus/polygon 篩選 → 標示 + 摘要
  function applyCommentMapping() {
    if (!cmState.cols || !cmState.cols.lat || !cmState.cols.lng) {
      cmRegionEl.textContent = t("cm.needLatLng"); return;
    }
    cmState.allPoints = CL().buildPoints(cmState.rows, cmState.cols);
    refreshCommentScope();
  }

  // 依目前選定範圍(面)或焦點(點)篩選並呈現
  function refreshCommentScope() {
    if (!cmState.allPoints.length) { cmRegionEl.textContent = t("cm.noValid"); return; }
    var scope;
    var scopeDesc;
    if (lastSitePolygon) {
      scope = CL().filterByPolygon(cmState.allPoints, lastSitePolygon);
      scopeDesc = t("cm.scopeSite");
    } else if (lastFocus) {
      scope = CL().filterByRadius(cmState.allPoints, lastFocus.lat, lastFocus.lng, CM_RADIUS);
      scopeDesc = t("cm.scopeRadius", { r: CM_RADIUS });
    } else {
      // 尚未選地點:全部顯示但提示
      scope = cmState.allPoints;
      scopeDesc = t("cm.scopeAll");
    }
    cmState.inScope = scope;

    // 標示點位
    cmMarkers.clearLayers();
    scope.forEach(function (p) {
      L.circleMarker([p.lat, p.lng], {
        radius: 5, color: "#7b4fb5", weight: 1.5, fillColor: "#a87fd6", fillOpacity: 0.7
      }).bindPopup((p.comment ? p.comment : t("cm.noText")) +
        "<br><span style='color:#888'>" + p.lat.toFixed(5) + ", " + p.lng.toFixed(5) + "</span>")
        .addTo(cmMarkers);
    });

    cmRegionEl.innerHTML = t("cm.result", { n: scope.length, total: cmState.allPoints.length, scope: scopeDesc });

    // 範圍變更:清掉舊的 AI 摘要(屬前一範圍,避免殘留誤導)
    cmAiOutputEl.innerHTML = "";
    // 本地詞頻摘要
    var sum = CL().summarize(scope, { topN: 12, sampleN: 5 });
    cmState.summary = sum;
    renderCommentSummary(sum);

    cmActionsEl.style.display = scope.length ? "" : "none";
    cmSourceEl.innerHTML = t("cm.note");

    // 寫入 lastAnalysis 供 AI 報告引用
    if (lastAnalysis) {
      lastAnalysis.user_comments = {
        in_scope_count: sum.total,
        with_comment_count: sum.withComment,
        top_words: sum.topWords.slice(0, 10).map(function (w) { return w.word + "(" + w.count + ")"; }),
        sample_comments: sum.samples
      };
    }
  }

  function renderCommentSummary(sum) {
    cmIndEl.innerHTML =
      ind(t("cm.count"), sum.total, t("cm.unitPt")) +
      ind(t("cm.withText"), sum.withComment, t("cm.unitPt"));
    var html = "";
    html += "<h3 class='cm-sec-title'>" + t("cm.localTitle") + "</h3>";
    if (sum.topWords.length) {
      var max = sum.topWords[0].count;
      html += "<div class='ghdr' style='grid-column:1/-1'>" + t("cm.topWords") + "</div>";
      html += "<div class='cm-words'>";
      sum.topWords.forEach(function (w) {
        var pct = Math.round(w.count / max * 100);
        html += "<div class='cm-word'><span class='cm-word-t'>" + w.word + "</span>" +
          "<span class='cm-word-bar' style='width:" + pct + "%'></span>" +
          "<span class='cm-word-n'>" + w.count + "</span></div>";
      });
      html += "</div>";
    }
    if (sum.samples.length) {
      html += "<div class='ghdr' style='grid-column:1/-1'>" + t("cm.samples") + "</div>";
      html += "<ul class='cm-samples'>" + sum.samples.map(function (s) {
        return "<li>" + s.replace(/</g, "&lt;") + "</li>";
      }).join("") + "</ul>";
    }
    cmSummaryEl.innerHTML = html;
  }

  // AI 主題摘要:把範圍內意見送 /api/analyze(以 comments-only 模式)
  cmAiBtn.addEventListener("click", function () {
    if (!cmState.inScope.length) return;
    if (/github\.io$/i.test(location.hostname)) {
      cmSourceEl.innerHTML = "<span class='ai-err'>" + t("ai.ghPages") + "</span>";
      return;
    }
    cmAiBtn.disabled = true;
    // 固定的 AI 輸出容器:每次按都覆寫,避免重複堆疊多個摘要
    cmAiOutputEl.innerHTML = "<p class='ai-loading'>" + t("cm.aiLoading") + "</p>";
    var CM_AI_LIMIT = 200; // AI 摘要送出上限(避免請求過長)
    var withText = cmState.inScope.map(function (p) { return p.comment; })
      .filter(function (c) { return c && c.trim(); });
    var comments = withText.slice(0, CM_AI_LIMIT); // 超過上限時取依檔案順序的前 N 則(不抽樣)
    var payload = {
      mode: "comments_summary",
      lang: (window.i18nLang ? window.i18nLang() : "zh"),
      comments: comments,
      total_in_scope: withText.length,   // 範圍內有文字意見總數
      sent_count: comments.length,        // 實際送出筆數
      truncated: withText.length > comments.length, // 是否因上限截斷(取前 N 則)
      region: lastRegionTitle || null
    };
    fetchWithTimeout("./api/analyze", 60000, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (r) {
        var ct = r.headers.get("content-type") || "";
        if (!r.ok || ct.indexOf("application/json") >= 0) {
          return r.text().then(function (txt) {
            var msg = txt; try { var j = JSON.parse(txt); if (j && j.error) msg = j.error; } catch (e) {}
            throw new Error(msg);
          });
        }
        return r.text();
      })
      .then(function (txt) {
        var sp = splitUsage(txt);
        // 覆寫固定容器(不累積);加明確的 AI 標題,與本地關鍵詞統計區隔
        cmAiOutputEl.innerHTML =
          "<h3 class='cm-sec-title'>" + t("cm.aiTitle") + "</h3>" +
          "<div class='ai-output'>" + renderReport(sp.text || t("ai.empty")) + "</div>" +
          (sp.usage ? "<p class='hint'>" + renderUsageNote(sp.usage) + "</p>" : "");
        if (lastAnalysis && lastAnalysis.user_comments) lastAnalysis.user_comments.ai_theme_summary = sp.text;
      })
      .catch(function (err) {
        cmAiOutputEl.innerHTML =
          "<p class='ai-err'>" + t("ai.fail") + " " + String(err && err.message || err) + "</p>";
      })
      .finally(function () { cmAiBtn.disabled = false; });
  });

  // 把 Overpass element(way 或 relation)轉成一個或多個帶屬性的 turf polygon
  function elToPolygons(el) {
    var tags = el.tags || {};
    var category = tags.leisure ? "park" : "green";
    var name = tags.name || tags["name:zh"] || (tags.leisure ? t("sp.unnamedPark") : t("sp.incidental"));
    var out = [];

    function pushRing(geom) {
      if (!geom || geom.length < 4) return;
      var ring = geom.map(function (p) { return [p.lon, p.lat]; });
      var f = ring[0], l = ring[ring.length - 1];
      if (f[0] !== l[0] || f[1] !== l[1]) ring.push(f);
      if (ring.length < 4) return;
      try {
        var poly = turf.polygon([ring]);
        poly.properties = { name: name, category: category, area_m2: turf.area(poly) };
        out.push(poly);
      } catch (e) { /* 跳過無效環 */ }
    }

    if (el.type === "way") {
      pushRing(el.geometry);
    } else if (el.type === "relation" && el.members) {
      // 多邊形 relation:取所有 outer 環各自成面(忽略 inner 洞,面積略為高估但足供估算)
      el.members.forEach(function (m) {
        if (m.type === "way" && m.geometry && (m.role === "outer" || !m.role)) pushRing(m.geometry);
      });
    }
    return out;
  }

  function nearestDist(focusPt, park) {
    try {
      if (turf.booleanPointInPolygon(focusPt, park)) return 0;
      var ring = park.geometry.coordinates[0];
      return turf.pointToLineDistance(focusPt, turf.lineString(ring), { units: "meters" });
    } catch (e) {
      try { return turf.distance(focusPt, turf.centroid(park), { units: "meters" }); }
      catch (e2) { return Infinity; }
    }
  }

  function ind(label, value, unit) {
    return "<div class='ind'><dt>" + label + "</dt><dd>" + value +
      (unit ? " <span class='u'>" + unit + "</span>" : "") + "</dd></div>";
  }

  // 基地範圍內綠地分析:查基地外接框內綠地,取與基地相交面積
  function analyzeGreenSite(sitePoly) {
    var bb = turf.bbox(sitePoly); // [minX,minY,maxX,maxY] = [W,S,E,N]
    var siteAreaM2 = turf.area(sitePoly);
    greenRegionEl.textContent = t("g.querySite");
    greenIndEl.innerHTML = "";
    greenSourceEl.textContent = "";

    var le = '["leisure"~"^(park|garden|recreation_ground|nature_reserve|playground)$"]';
    var lu = '["landuse"~"^(grass|forest|meadow|greenfield|village_green)$"]';
    var bbox = "(" + bb[1] + "," + bb[0] + "," + bb[3] + "," + bb[2] + ")";
    // 同時查 way 與 relation(多邊形公園常是 relation),relation 取外環幾何
    var q = "[out:json][timeout:25];(" +
      "way" + le + bbox + ";" + "relation" + le + bbox + ";" +
      "way" + lu + bbox + ";" + "relation" + lu + bbox + ";" +
      ");out geom;";
    var url = OVERPASS + "?data=" + encodeURIComponent(q);

    fetchWithTimeout(url, 25000)
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (data) {
        var parks = [], incid = [], parkM2 = 0, incidM2 = 0, greenM2 = 0;
        (data.elements || []).forEach(function (el) {
          elToPolygons(el).forEach(function (poly) {
            var clip = null;
            try { clip = turf.intersect(poly, sitePoly); } catch (e) { clip = null; }
            // intersect 失敗時退回:只要與基地相交就計入,面積取較小者(估算)
            if (!clip) {
              var overlaps = false;
              try { overlaps = turf.booleanIntersects(poly, sitePoly); } catch (e) { overlaps = false; }
              if (!overlaps) return; // 真的不相交
            }
            var a = 0;
            try { a = clip ? turf.area(clip) : Math.min(poly.properties.area_m2, siteAreaM2); }
            catch (e) { a = 0; }
            if (a <= 0) return;
            poly.properties.clip_area_m2 = a;
            greenM2 += a;
            if (poly.properties.category === "park" && poly.properties.area_m2 >= MIN_PARK_M2) {
              parks.push(poly); parkM2 += a;
            } else {
              incid.push(poly); incidM2 += a;
            }
          });
        });

        greenMarkers.clearLayers();
        L.geoJSON(sitePoly, { style: { color: "#3ba88f", weight: 2, fill: false, dashArray: "4" } }).addTo(greenMarkers);
        parks.concat(incid).forEach(function (f) {
          var isPark = f.properties.category === "park" && f.properties.area_m2 >= MIN_PARK_M2;
          L.geoJSON(f, {
            style: isPark
              ? { color: "#1f6b46", weight: 1.5, fillColor: "#2e8b57", fillOpacity: 0.45 }
              : { color: "#7fae8e", weight: 0.5, fillColor: "#9cc8aa", fillOpacity: 0.25 }
          }).bindPopup(
            (isPark ? "🏞 " : "") + (f.properties.name || "") + "<br>" +
            (f.properties.clip_area_m2 / 10000).toFixed(2) + t("u.ha")).addTo(greenMarkers);
        });

        var siteHa = siteAreaM2 / 10000;
        var coverage = siteAreaM2 > 0 ? (greenM2 / siteAreaM2) * 100 : 0;
        var meets10 = coverage >= 10;

        greenRegionEl.innerHTML = t("g.siteTitle", { a: siteHa.toFixed(2) });
        var ghdr = function (s) { return "<div class='ghdr' style='grid-column:1/-1'>" + s + "</div>"; };
        var html = "";
        html += ghdr(t("g.hdrParkSite"));
        html += ind(t("g.count"), parks.length, t("u.spot"));
        html += ind(t("g.area"), (parkM2 / 10000).toFixed(2), t("u.ha"));
        html += ghdr(t("g.hdrIncidSite"));
        html += ind(t("g.count"), incid.length, t("u.spot"));
        html += ind(t("g.area"), (incidM2 / 10000).toFixed(2), t("u.ha"));
        html += ghdr(t("g.hdrOverall"));
        html += ind(t("g.greenTotal"), (greenM2 / 10000).toFixed(2), t("u.ha"));
        html += ind(t("g.coverageSite"), coverage.toFixed(1), "%");
        html += "<div class='ind' style='grid-column:1/-1'><dt>" + t("g.law45") + "</dt><dd style='font-size:12px;font-weight:400'>" +
          (meets10 ? t("g.site10met", { p: coverage.toFixed(1) }) : t("g.site10no", { p: coverage.toFixed(1) })) +
          "</dd></div>";
        greenIndEl.innerHTML = html;

        lastAnalysis = {
          focus: { lat: +((bb[1] + bb[3]) / 2).toFixed(5), lng: +((bb[0] + bb[2]) / 2).toFixed(5) },
          site_area_ha: +siteHa.toFixed(2),
          population: lastRegionProps,
          green: {
            mode: "within_site",
            site_area_ha: +siteHa.toFixed(2),
            park_count_in_site: parks.length,
            park_area_in_site_ha: +(parkM2 / 10000).toFixed(2),
            incidental_count_in_site: incid.length,
            green_area_in_site_ha: +(greenM2 / 10000).toFixed(2),
            site_green_coverage_pct: +coverage.toFixed(1),
            meets_10pct_ref: meets10
          }
        };
        renderHeat(coverage, lastRegionProps);
        loadClimate((bb[1] + bb[3]) / 2, (bb[0] + bb[2]) / 2);
        loadOSSL((bb[1] + bb[3]) / 2, (bb[0] + bb[2]) / 2);
        loadAQI((bb[1] + bb[3]) / 2, (bb[0] + bb[2]) / 2);

        greenSourceEl.innerHTML = t("g.noteSite");
      })
      .catch(function (err) {
        var aborted = err && err.name === "AbortError";
        greenRegionEl.textContent = (aborted ? t("g.timeout") : t("g.offline")) + t("g.retry");
        greenSourceEl.textContent = "";
      });
  }

  function analyzeGreen() {
    if (lastSitePolygon) { analyzeGreenSite(lastSitePolygon); return; }
    var focus = lastFocus || map.getCenter();
    var lat = focus.lat, lng = focus.lng;
    greenRegionEl.textContent = t("g.queryRadius", { r: GREEN_RADIUS });
    greenIndEl.innerHTML = "";
    greenSourceEl.textContent = "";

    var le = '["leisure"~"^(park|garden|recreation_ground|nature_reserve|playground)$"]';
    var lu = '["landuse"~"^(grass|forest|meadow|greenfield|village_green)$"]';
    var around = "(around:" + GREEN_RADIUS + "," + lat + "," + lng + ")";
    var q = "[out:json][timeout:25];(" +
      "way" + le + around + ";" + "relation" + le + around + ";" +
      "way" + lu + around + ";" + "relation" + lu + around + ";" +
      ");out geom;";
    var url = OVERPASS + "?data=" + encodeURIComponent(q);

    fetchWithTimeout(url, 25000)
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (data) {
        var focusPt = turf.point([lng, lat]);
        var features = [];
        (data.elements || []).forEach(function (el) {
          elToPolygons(el).forEach(function (poly) {
            poly.properties.dist = nearestDist(focusPt, poly);
            features.push(poly);
          });
        });

        greenMarkers.clearLayers();
        // 服務圈
        L.circle([lat, lng], { radius: GREEN_RADIUS, color: "#3ba88f", weight: 1, fill: false, dashArray: "4" }).addTo(greenMarkers);

        if (features.length === 0) {
          greenRegionEl.textContent = t("g.noneRadius", { r: GREEN_RADIUS });
          greenIndEl.innerHTML = "";
          greenSourceEl.textContent = "";
          lastAnalysis = {
            focus: { lat: +lat.toFixed(5), lng: +lng.toFixed(5) },
            site_area_ha: lastSiteAreaHa,
            population: lastRegionProps,
            green: { radius_m: GREEN_RADIUS, parks_found: 0 }
          };
          renderHeat(0, lastRegionProps);
          loadClimate(lat, lng);
          loadOSSL(lat, lng);
          loadAQI(lat, lng);
          return;
        }

        var sum = function (arr) { return arr.reduce(function (s, p) { return s + p.properties.area_m2; }, 0); };
        // 綠覆率以全部綠地計(代理樹冠覆蓋)
        var greenTotalM2 = sum(features);
        var coverage = (greenTotalM2 / (Math.PI * GREEN_RADIUS * GREEN_RADIUS)) * 100;

        // 公園類(leisure)且面積 ≥0.1ha 才算「有效公園」
        var parks = features.filter(function (f) {
          return f.properties.category === "park" && f.properties.area_m2 >= MIN_PARK_M2;
        });
        parks.sort(function (a, b) { return a.properties.dist - b.properties.dist; });
        var parks300 = parks.filter(function (p) { return p.properties.dist <= 300; });
        var parkArea500 = sum(parks);
        var nearestPark = parks[0] || null;
        var nearestHa = nearestPark ? nearestPark.properties.area_m2 / 10000 : null;
        var has300 = parks300.length > 0;

        // 零星綠地 = 非有效公園者(landuse 綠地 + 小於 0.1ha 的小塊)
        var incidental = features.filter(function (f) {
          return !(f.properties.category === "park" && f.properties.area_m2 >= MIN_PARK_M2);
        });
        var incidentalArea = sum(incidental);

        // 地圖:有效公園深綠、其餘綠地(零星/小塊)淺綠
        features.forEach(function (f) {
          var isEffPark = f.properties.category === "park" && f.properties.area_m2 >= MIN_PARK_M2;
          L.geoJSON(f, {
            style: isEffPark
              ? { color: "#1f6b46", weight: 1.5, fillColor: "#2e8b57", fillOpacity: 0.45 }
              : { color: "#7fae8e", weight: 0.5, fillColor: "#9cc8aa", fillOpacity: 0.25 }
          })
            .bindPopup(
              (isEffPark ? "🏞 " : "") + (f.properties.name || "") + "<br>" +
              (f.properties.area_m2 / 10000).toFixed(2) + t("u.ha") + " · " +
              Math.round(f.properties.dist) + " m")
            .addTo(greenMarkers);
        });

        greenRegionEl.innerHTML = t("g.radiusTitle", { r: GREEN_RADIUS });
        var ghdr = function (s) {
          return "<div class='ghdr' style='grid-column:1/-1'>" + s + "</div>";
        };
        var html = "";
        // ── 公園(≥0.1ha)──
        html += ghdr(t("g.hdrPark"));
        if (nearestPark) {
          html += ind(t("g.nearestDist"), Math.round(nearestPark.properties.dist), "m");
          html += ind(t("g.nearestArea"), nearestHa.toFixed(2), t("u.ha"));
        } else {
          html += "<div class='ind' style='grid-column:1/-1'><dt>" + t("g.noPark") + "</dt><dd>" + t("g.noPark500") + "</dd></div>";
        }
        html += ind(t("g.park300"), parks300.length, t("u.spot"));
        html += ind(t("g.park500"), parks.length, t("u.spot"));
        html += ind(t("g.parkArea500"), (parkArea500 / 10000).toFixed(2), t("u.ha"));
        // ── 零星綠地 ──
        html += ghdr(t("g.hdrIncid"));
        html += ind(t("g.count500"), incidental.length, t("u.spot"));
        html += ind(t("g.incidArea"), (incidentalArea / 10000).toFixed(2), t("u.ha"));
        // ── 整體 ──
        html += ghdr(t("g.hdrOverall"));
        html += ind(t("g.coverageAll"), coverage.toFixed(1), "%");
        html += ind(t("g.access330"), has300 ? t("g.met") : t("g.notMet"), "");
        var scale = nearestPark == null ? t("g.scaleNone")
          : nearestHa >= 4 ? t("g.scaleCommunity")
          : nearestHa >= 0.5 ? t("g.scaleNeighbor")
          : t("g.scaleChild");
        html += "<div class='ind' style='grid-column:1/-1'><dt>" + t("g.law") + "</dt><dd style='font-size:12px;font-weight:400'>" + scale + "</dd></div>";
        greenIndEl.innerHTML = html;

        // 彙整供 AI 解讀的真實數值,並產出熱環境研判
        lastAnalysis = {
          focus: { lat: +lat.toFixed(5), lng: +lng.toFixed(5) },
          site_area_ha: lastSiteAreaHa,
          population: lastRegionProps,
          green: {
            radius_m: GREEN_RADIUS,
            min_park_ha: MIN_PARK_M2 / 10000,
            nearest_park_dist_m: nearestPark ? Math.round(nearestPark.properties.dist) : null,
            nearest_park_area_ha: nearestHa != null ? +nearestHa.toFixed(2) : null,
            park_count_300m: parks300.length,
            park_count_500m: parks.length,
            park_area_500m_ha: +(parkArea500 / 10000).toFixed(2),
            incidental_count_500m: incidental.length,
            incidental_area_500m_ha: +(incidentalArea / 10000).toFixed(2),
            green_total_500m_ha: +(greenTotalM2 / 10000).toFixed(2),
            green_coverage_pct: +coverage.toFixed(1),
            has_300m_park_access: has300
          }
        };
        renderHeat(coverage, lastRegionProps);
        loadClimate(lat, lng);
        loadOSSL(lat, lng);
        loadAQI(lat, lng);

        greenSourceEl.innerHTML = t("g.noteRadius");
      })
      .catch(function (err) {
        var aborted = err && err.name === "AbortError";
        greenRegionEl.textContent = (aborted ? t("g.timeout") : t("g.offline")) + t("g.retry");
        greenSourceEl.textContent = "";
      });
  }

  greenBtn.addEventListener("click", analyzeGreen);

  // =========================================================
  //  生態 / 生物多樣性(iNaturalist,瀏覽器即時查,有 CORS)
  // =========================================================
  var biodivBtn = document.getElementById("biodiv-btn");
  var biodivRegionEl = document.getElementById("biodiv-region");
  var biodivIndEl = document.getElementById("biodiv-indicators");
  var biodivSourceEl = document.getElementById("biodiv-source");
  var INAT = "https://api.inaturalist.org/v1";
  var BIODIV_RADIUS_KM = 1; // 物種查詢半徑(公里)
  var ICONIC = ["Plantae", "Aves", "Insecta", "Mammalia", "Amphibia", "Reptilia"];

  function resetBiodivPanel() {
    biodivRegionEl.textContent = t("biodiv.hint");
    biodivIndEl.innerHTML = "";
    biodivSourceEl.textContent = "";
  }

  function analyzeBiodiversity() {
    var focus = lastFocus || map.getCenter();
    var lat = focus.lat, lng = focus.lng;
    biodivRegionEl.textContent = t("b.querying", { r: BIODIV_RADIUS_KM });
    biodivIndEl.innerHTML = "";
    biodivSourceEl.textContent = "";

    var locale = window.i18nLang && window.i18nLang() === "en" ? "en" : "zh-TW";
    var geo = "lat=" + lat + "&lng=" + lng + "&radius=" + BIODIV_RADIUS_KM + "&verifiable=true&locale=" + locale;
    // 取實際物種清單(species_counts 預設按觀測次數遞減 → 即代表性物種)
    var spCountUrl = INAT + "/observations/species_counts?" + geo + "&per_page=20";
    var obsUrl = INAT + "/observations?" + geo + "&per_page=0";
    var threatUrl = INAT + "/observations/species_counts?" + geo + "&threatened=true&per_page=15";

    function taxonName(rec) {
      var tx = rec && rec.taxon;
      if (!tx) return "?";
      var common = tx.preferred_common_name;
      var sci = tx.name;
      if (common && sci) return common + "(" + sci + ")";
      return common || sci || "?";
    }

    Promise.all([
      fetchWithTimeout(spCountUrl, 20000).then(function (r) { return r.json(); }),
      fetchWithTimeout(obsUrl, 20000).then(function (r) { return r.json(); }),
      fetchWithTimeout(threatUrl, 20000).then(function (r) { return r.json(); })
    ]).then(function (res) {
      var spData = res[0] || {};
      var speciesCount = spData.total_results != null ? spData.total_results : 0;
      var obsCount = res[1] && res[1].total_results != null ? res[1].total_results : 0;
      var threatData = res[2] || {};
      var threatCount = threatData.total_results != null ? threatData.total_results : 0;

      if (obsCount === 0) {
        biodivRegionEl.textContent = t("b.none", { r: BIODIV_RADIUS_KM });
        biodivSourceEl.textContent = "";
        lastBiodiv = { radius_km: BIODIV_RADIUS_KM, species_count: 0, observation_count: 0 };
        return;
      }

      // 代表性物種(觀測最多者),跨分類群取前 10
      var topSpecies = (spData.results || []).slice(0, 10).map(function (rec) {
        return { name: taxonName(rec), count: rec.count || 0, group: (rec.taxon && rec.taxon.iconic_taxon_name) || "" };
      });
      // 受脅/保育物種名稱
      var threatened = (threatData.results || []).map(function (rec) { return taxonName(rec); });

      biodivRegionEl.innerHTML = t("b.title", { r: BIODIV_RADIUS_KM });
      var html = "";
      html += ind(t("b.species"), speciesCount, t("b.unitSp"));
      html += ind(t("b.obs"), obsCount, t("b.unitObs"));
      html += ind(t("b.threat"), threatCount, t("b.unitSp"));

      // 代表性物種清單(整列)
      html += "<div class='biolist' style='grid-column:1/-1'><dt>" + t("b.topSpecies") + "</dt><dd><ol>" +
        topSpecies.map(function (s) {
          return "<li>" + s.name + " <span class='u'>" + s.count + " " + t("b.unitObs") + "</span></li>";
        }).join("") + "</ol></dd></div>";

      // 受脅物種清單(若有)
      if (threatened.length) {
        html += "<div class='biolist warn' style='grid-column:1/-1'><dt>" + t("b.threatList") + "</dt><dd><ul>" +
          threatened.map(function (n) { return "<li>" + n + "</li>"; }).join("") + "</ul></dd></div>";
      }
      biodivIndEl.innerHTML = html;

      // 各分類群物種數(逐一查 species_counts,平行)
      Promise.all(ICONIC.map(function (key) {
        return fetchWithTimeout(INAT + "/observations/species_counts?" + geo + "&iconic_taxa=" + key + "&per_page=0", 20000)
          .then(function (r) { return r.json(); })
          .then(function (j) { return { key: key, n: (j && j.total_results) || 0 }; })
          .catch(function () { return { key: key, n: 0 }; });
      })).then(function (groups) {
        var taxa = {};
        var gh = "<div class='ghdr' style='grid-column:1/-1'>" + t("b.taxaHdr") + "</div>";
        groups.forEach(function (g) {
          taxa[t("tx." + g.key)] = g.n;
          gh += ind(t("tx." + g.key), g.n, t("b.unitSp"));
        });
        biodivIndEl.innerHTML += gh;
        if (lastBiodiv) lastBiodiv.taxa = taxa;
      });

      lastBiodiv = {
        radius_km: BIODIV_RADIUS_KM,
        species_count: speciesCount,
        observation_count: obsCount,
        threatened_species: threatCount,
        top_species: topSpecies.map(function (s) { return s.name + "(" + s.count + "筆)"; }),
        threatened_list: threatened
      };
      if (lastAnalysis) lastAnalysis.biodiversity = lastBiodiv;

      biodivSourceEl.innerHTML = t("b.note");
    }).catch(function (err) {
      var aborted = err && err.name === "AbortError";
      biodivRegionEl.textContent = (aborted ? t("b.timeout") : t("b.offline")) + t("g.retry");
      biodivSourceEl.textContent = "";
    });
  }

  biodivBtn.addEventListener("click", analyzeBiodiversity);

  // =========================================================
  //  第三階段 3c:AI 解讀(呼叫 /api/analyze,需 Cloudflare Pages 部署)
  // =========================================================
  var aiBtn = document.getElementById("ai-btn");
  var aiOutput = document.getElementById("ai-output");
  var aiSource = document.getElementById("ai-source");

  // 將報告(Markdown)轉為 HTML;有 marked 就用,否則退回純文字段落
  // 從串流文字尾端切出後端附加的用量標記(若有),回傳 { text, usage }
  var lastUsage = null;
  function splitUsage(raw) {
    if (!raw) return { text: raw, usage: null };
    var marker = "\n␞ USAGE ␞";
    var i = raw.indexOf(marker);
    if (i < 0) return { text: raw, usage: null };
    var body = raw.slice(0, i);
    var usage = null;
    try { usage = JSON.parse(raw.slice(i + marker.length)); } catch (e) { usage = null; }
    return { text: body, usage: usage };
  }
  function renderUsageNote(u) {
    if (!u) return "";
    var nt = function (n) { return (n || 0).toLocaleString(); };
    return t("usage.note", {
      in: nt(u.input_tokens), out: nt(u.output_tokens),
      cr: nt(u.cache_read_input_tokens)
    });
  }

  function renderReport(text) {
    if (window.marked && typeof window.marked.parse === "function") {
      try {
        return window.marked.parse(text);
      } catch (e) {
        /* 退回純文字 */
      }
    }
    var esc = text
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return esc
      .split(/\n{2,}/)
      .map(function (p) { return "<p>" + p.replace(/\n/g, "<br>") + "</p>"; })
      .join("");
  }

  aiBtn.addEventListener("click", function () {
    // GitHub Pages 為純靜態、無後端,直接導向含後端的 Cloudflare 版本
    if (/github\.io$/i.test(location.hostname)) {
      aiOutput.innerHTML =
        "<p class='ai-err'>" + t("ai.ghPages") + "</p>" +
        "<p class='ai-err'>" + t("ai.useProd") +
        "<a href='https://map.healsdesign.org' target='_blank' rel='noopener'>map.healsdesign.org</a></p>";
      aiSource.textContent = t("ai.ghOther");
      return;
    }
    if (!lastAnalysis) {
      aiOutput.innerHTML = "";
      aiSource.textContent = t("ai.needData");
      return;
    }
    aiBtn.disabled = true;
    aiOutput.innerHTML = "<p class='ai-loading'>" + t("ai.loading") + "</p>";
    aiSource.textContent = "";

    // 串流讀取後端純文字回應(後端把 Claude 串流轉成 text/plain)
    fetch("./api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.assign({}, lastAnalysis, { lang: (window.i18nLang ? window.i18nLang() : "zh") }))
    })
      .then(function (r) {
        var ct = r.headers.get("content-type") || "";
        // 後端錯誤時回 JSON;成功時回 text/plain 串流
        if (!r.ok || ct.indexOf("application/json") >= 0) {
          return r.text().then(function (txt) {
            var msg = txt;
            try { var j = JSON.parse(txt); if (j && j.error) msg = j.error; } catch (e) {}
            throw new Error(msg || ("HTTP " + r.status));
          });
        }
        if (!r.body || !r.body.getReader) {
          // 舊瀏覽器無串流:整段讀取
          return r.text().then(function (txt) {
            var sp = splitUsage(txt); lastUsage = sp.usage;
            aiOutput.innerHTML = renderReport(sp.text || t("ai.empty"));
          });
        }
        var reader = r.body.getReader();
        var decoder = new TextDecoder();
        var acc = "";
        function pump() {
          return reader.read().then(function (res) {
            if (res.done) {
              var sp = splitUsage(acc); lastUsage = sp.usage;
              aiOutput.innerHTML = renderReport(sp.text || t("ai.empty"));
              return;
            }
            acc += decoder.decode(res.value, { stream: true });
            // 串流中先把可能尚未完整的 USAGE 標記切掉再渲染
            aiOutput.innerHTML = renderReport(splitUsage(acc).text);
            aiOutput.scrollTop = aiOutput.scrollHeight;
            return pump();
          });
        }
        return pump();
      })
      .then(function () {
        aiSource.innerHTML = t("ai.by") + (lastUsage ? " · " + renderUsageNote(lastUsage) : "");
      })
      .catch(function (err) {
        var msg = String(err && err.message ? err.message : err);
        aiOutput.innerHTML =
          "<p class='ai-err'>" + t("ai.fail") + "</p>" +
          "<p class='ai-err' style='opacity:.7'>" + t("ai.msg") + msg + "</p>";
        aiSource.textContent = "";
      })
      .finally(function () { aiBtn.disabled = false; });
  });

  // ---- 報告匯出 / 列印(另開乾淨獨立頁面,iPad 存 PDF 才穩定)----
  var exportBtn = document.getElementById("export-btn");

  function pnum(v, suffix) {
    return v === null || v === undefined ? "—" : v + (suffix || "");
  }
  function prow(label, val) {
    return "<tr><th>" + label + "</th><td>" + val + "</td></tr>";
  }

  var REPORT_CSS =
    "body{font-family:'Noto Sans TC','Segoe UI',system-ui,-apple-system,sans-serif;color:#111;margin:0;padding:24px;line-height:1.6;}" +
    ".doc{max-width:760px;margin:0 auto;}" +
    "h1{font-size:22px;margin:0 0 6px;}" +
    "h2{font-size:15px;margin:16px 0 6px;border-bottom:1px solid #888;padding-bottom:3px;}" +
    ".meta{color:#444;font-size:13px;margin:0 0 10px;}" +
    "table{width:100%;border-collapse:collapse;margin:6px 0 10px;}" +
    "th,td{border:1px solid #bbb;padding:4px 8px;text-align:left;font-size:13px;vertical-align:top;}" +
    "table.summary th{background:#f0f0f0;width:42%;font-weight:600;}" +
    ".src{font-size:11px;color:#555;}" +
    ".author{margin-top:14px;padding-top:8px;border-top:1px solid #ccc;font-size:12px;font-weight:600;color:#222;}" +
    ".bar{max-width:760px;margin:0 auto 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;}" +
    ".bar button{font-size:15px;padding:9px 18px;border:0;border-radius:8px;background:#3ba88f;color:#fff;cursor:pointer;}" +
    ".bar .hint{color:#777;font-size:12px;}" +
    "tr{page-break-inside:avoid;}h1,h2{page-break-after:avoid;}" +
    "@media print{.noprint{display:none!important;}body{padding:0;}}";

  function buildReportInner() {
    var p = lastAnalysis.population || {};
    var g = lastAnalysis.green || {};
    var h = lastAnalysis.heat || {};
    var focus = lastAnalysis.focus || {};
    var now = new Date();
    var aiHasReport = aiOutput.innerHTML.trim() &&
      !aiOutput.querySelector(".ai-err") && !aiOutput.querySelector(".ai-loading");
    var aiHtml = aiHasReport
      ? aiOutput.innerHTML.replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, "")
      : "<p style='color:#888'>" + t("r.aiEmpty") + "</p>";
    var MET = function (b) { return b === undefined ? "—" : (b ? t("r.met") : t("r.notMet")); };

    var isSiteMode = g.mode === "within_site";
    var html = "<h1>" + t("r.title") + "</h1>";
    html += "<p class='meta'>" + (lastRegionTitle || "") +
      "<br>" + t("r.coord") + pnum(focus.lat) + "°N, " + pnum(focus.lng) + "°E" +
      (lastSiteAreaHa != null ? t("r.siteArea") + lastSiteAreaHa + t("r.uHa") : "") +
      "<br>" + t("r.mode") + (isSiteMode ? t("r.modeSite") : t("r.modePoint")) +
      "<br>" + t("r.generated") + now.toLocaleString() + "</p>";

    html += "<h2>" + t("r.hPop") + "</h2><table class='summary'>" +
      prow(t("ind.pop"), pnum(p.pop, t("r.uPerson"))) + prow(t("ind.households"), pnum(p.households, t("r.uHh"))) +
      prow(t("ind.density"), pnum(p.density, t("r.uPkm2"))) + prow(t("ind.sex_ratio"), pnum(p.sex_ratio)) +
      prow(t("ind.aging_index"), pnum(p.aging_index)) + prow(t("ind.dep_ratio"), pnum(p.dep_ratio, " %")) +
      prow(t("h.elderly"), pnum(p.elderly_share, " %")) + prow(t("h.child"), pnum(p.child_share, " %")) +
      "</table>";

    if (g.mode === "within_site") {
      html += "<h2>" + t("r.hGreenSite") + "</h2><table class='summary'>" +
        prow(t("r.siteArea2"), pnum(g.site_area_ha, t("r.uHa"))) +
        prow(t("r.parkInSite"), pnum(g.park_count_in_site, t("r.uSpot"))) +
        prow(t("r.parkAreaInSite"), pnum(g.park_area_in_site_ha, t("r.uHa"))) +
        prow(t("r.incidInSite"), pnum(g.incidental_count_in_site, t("r.uSpot"))) +
        prow(t("r.greenInSite"), pnum(g.green_area_in_site_ha, t("r.uHa"))) +
        prow(t("r.siteCoverage"), pnum(g.site_green_coverage_pct, " %")) +
        prow(t("r.law45ref"), g.meets_10pct_ref === undefined ? "—" : (g.meets_10pct_ref ? t("r.met") : t("r.notMet2"))) +
        "</table>";
    } else {
      html += "<h2>" + t("r.hGreenRadius", { r: pnum(g.radius_m) }) + "</h2><table class='summary'>" +
        prow(t("r.nearestDist"), pnum(g.nearest_park_dist_m, " m")) + prow(t("r.nearestArea"), pnum(g.nearest_park_area_ha, t("r.uHa"))) +
        prow(t("r.p300"), pnum(g.park_count_300m, t("r.uSpot"))) + prow(t("r.p500"), pnum(g.park_count_500m, t("r.uSpot"))) +
        prow(t("r.pArea500"), pnum(g.park_area_500m_ha, t("r.uHa"))) +
        prow(t("r.incid500n"), pnum(g.incidental_count_500m, t("r.uSpot"))) +
        prow(t("r.incid500a"), pnum(g.incidental_area_500m_ha, t("r.uHa"))) +
        prow(t("r.covAll"), pnum(g.green_coverage_pct, " %")) +
        prow(t("r.access"), MET(g.has_300m_park_access)) +
        "</table>";
    }

    var cl = lastAnalysis.climate;
    if (cl) {
      html += "<h2>" + t("r.hClimate") + "</h2><table class='summary'>" +
        prow(t("r.clPeriod"), cl.reference_period || "—") +
        prow(t("r.clMean"), pnum(cl.annual_mean_temp_c, " °C")) +
        prow(t("r.clHottest"), cl.hottest_month
          ? t("cl.mon" + cl.hottest_month) + " " + pnum(cl.hottest_month_mean_c) + " °C" : "—") +
        prow(t("r.clHeatDays"), pnum(cl.heat_days_per_year_ge32c, " " + t("cl.daysYr"))) +
        prow(t("r.clPrecip"), pnum(cl.annual_precip_mm, " mm")) +
        prow(t("r.clWind"), cl.dominant_wind_dir || "—") +
        prow(t("r.clSolar"), pnum(cl.avg_daily_solar_mj_m2, " MJ/m²")) +
        "</table>";
    }

    html += "<h2>" + t("r.hHeat") + "</h2><table class='summary'>" +
      prow(t("r.covOSM"), pnum(h.green_coverage_pct, " %")) +
      prow(t("r.t30"), MET(h.meets_30pct_target)) +
      prow(t("r.vuln"), h.vulnerability_level || "—") +
      "</table>";

    var hg = lastAnalysis.healing_green_intervention;
    if (hg) {
      var hgFactorLabel = { green: t("hg.fGreen"), vuln: t("hg.fVuln"), heat: t("hg.fHeat"), access: t("hg.fAccess") };
      html += "<h2>" + t("r.hHGIP") + "</h2><table class='summary'>" +
        prow(t("r.hgipIndex"), pnum(hg.index) + " / 100(" + (hg.priority_level || "—") + ")") +
        prow(t("r.hgipDominant"), hgFactorLabel[hg.dominant_factor] || hg.dominant_factor || "—");
      (hg.factors || []).forEach(function (f) {
        html += prow(hgFactorLabel[f.key] || f.key, Math.round(f.normalized * 100) + " %");
      });
      html += "</table>";
    }

    var aq = lastAnalysis.air_quality;
    if (aq) {
      html += "<h2>" + t("r.hAQI") + "</h2><table class='summary'>" +
        prow(t("r.aqiSite"), (aq.nearest_site || "—") + (aq.distance_km != null ? "(" + aq.distance_km + " km)" : "")) +
        prow(t("r.aqiVal"), pnum(aq.aqi) + (aq.status ? "(" + aq.status + ")" : "")) +
        prow(t("r.aqiPm25"), pnum(aq.pm25, " µg/m³")) +
        prow(t("r.aqiPm10"), pnum(aq.pm10, " µg/m³")) +
        prow(t("r.aqiPollutant"), aq.main_pollutant || "—") +
        prow(t("r.aqiTime"), aq.publish_time || "—") +
        "</table>";
    }

    var os = lastAnalysis.openspace_service_level;
    if (os) {
      html += "<h2>" + t("r.hOSSL") + "</h2><table class='summary'>" +
        prow(t("r.osslOverall"), pnum(os.overall) + "(" + (os.band || "—") + ")") +
        prow(t("r.osslCatch"), pnum(os.catchment_radius_m, " m"));
      (os.categories || []).forEach(function (c) {
        html += prow(c.label,
          (c.nearest_m == null ? "—" : c.nearest_m + " m") + " · " +
          c.count + t("r.uSpot") + " · " + Math.round(c.score));
      });
      html += "</table>";
    }

    var b = lastAnalysis.biodiversity;
    if (b) {
      html += "<h2>" + t("r.hBiodiv", { r: pnum(b.radius_km) }) + "</h2><table class='summary'>" +
        prow(t("r.species"), pnum(b.species_count, t("r.uSp"))) +
        prow(t("r.obs"), pnum(b.observation_count, t("r.uObs"))) +
        prow(t("r.threat"), pnum(b.threatened_species, t("r.uSp"))) +
        (b.top_species && b.top_species.length ? prow(t("r.topSp"), b.top_species.join("、")) : "") +
        (b.threatened_list && b.threatened_list.length ? prow(t("r.threatList"), b.threatened_list.join("、")) : "") +
        (b.taxa ? prow(t("r.taxa"),
          Object.keys(b.taxa).map(function (k) { return k + " " + b.taxa[k]; }).join("、")) : "") +
        "</table>";
    }

    var uc = lastAnalysis.user_comments;
    if (uc) {
      html += "<h2>" + t("r.hComments") + "</h2><table class='summary'>" +
        prow(t("r.cmCount"), pnum(uc.in_scope_count, t("cm.unitPt"))) +
        prow(t("r.cmWith"), pnum(uc.with_comment_count, t("cm.unitPt"))) +
        (uc.top_words && uc.top_words.length ? prow(t("r.cmTop"), uc.top_words.join("、")) : "") +
        "</table>";
      if (uc.sample_comments && uc.sample_comments.length) {
        html += "<p class='src'>" + t("r.cmSamples") + "</p><ul>" +
          uc.sample_comments.map(function (s) { return "<li>" + s.replace(/</g, "&lt;") + "</li>"; }).join("") + "</ul>";
      }
      if (uc.ai_theme_summary) {
        html += "<div>" + renderReport(uc.ai_theme_summary) + "</div>";
      }
    }

    html += "<h2>" + t("r.hAI") + "</h2><div>" + aiHtml + "</div>";

    html += "<h2>" + t("r.hSrc") + "</h2><p class='src'>" + t("r.src") + "</p>";
    html += "<p class='author'>" + t("foot.author") + "</p>";

    // 備援:於頁尾加一行可被文字擷取的範圍標記,供下游「分區與動線」工具讀 PDF 還原範圍。
    // 格式 HEALS-BOUNDARY:[[緯度,經度],...](lat 在前,與深連結契約一致)。小字、不影響外觀。
    var siteLayer = getSiteLayer();
    if (siteLayer) {
      var ring = siteOuterRing(siteLayer);
      if (ring && ring.length >= 3) {
        var bpts = ring.map(function (pt) { return [+pt.lat.toFixed(6), +pt.lng.toFixed(6)]; });
        html += "<p class='boundary-marker' style='font-size:8px;color:#bbb;margin-top:14px;" +
          "word-break:break-all;'>HEALS-BOUNDARY:" + JSON.stringify(bpts) + "</p>";
      }
    }
    return html;
  }

  // 報告檔名:標題 + 地區 + 時戳。瀏覽器列印存 PDF 時以文件 <title> 為預設檔名,
  // 帶入地區與時間可避免每次都存成同名檔(使用者誤以為「沒更新、還是舊的」)。
  function reportFileTitle() {
    var d = new Date();
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    var stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
      "-" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
    // 地區名去除檔名不合法字元
    var region = (lastRegionTitle || "").replace(/[\\/:*?"<>|]/g, "").trim();
    return t("r.title") + (region ? "_" + region : "") + "_" + stamp;
  }

  function buildReportDoc() {
    var docLang = (window.i18nLang && window.i18nLang() === "en") ? "en" : "zh-Hant";
    return "<!doctype html><html lang='" + docLang + "'><head><meta charset='utf-8'>" +
      "<meta name='viewport' content='width=device-width,initial-scale=1'>" +
      "<title>" + reportFileTitle() + "</title><style>" + REPORT_CSS + "</style></head><body>" +
      "<div class='bar noprint'><button onclick='window.print()'>🖨 " + t("ai.export") + "</button>" +
      "<span class='hint'>" + t("r.printHint") + "</span></div>" +
      "<div class='doc'>" + buildReportInner() + "</div></body></html>";
  }

  exportBtn.addEventListener("click", function () {
    if (!lastAnalysis) {
      aiSource.textContent = t("exp.needData");
      return;
    }
    var w = window.open("", "_blank");
    if (!w) {
      aiSource.textContent = t("exp.blocked");
      return;
    }
    w.document.open();
    w.document.write(buildReportDoc());
    w.document.close();
    aiSource.textContent = t("exp.opened");
    syncSiteToZoning(); // 產生報告時同步範圍 cookie,供分區與動線工具讀取
  });

  // =========================================================
  //  送到「分區與動線」工具(深連結帶基地範圍 + 跨子網域 cookie 同步)
  // =========================================================
  var zoningBtn = document.getElementById("zoning-btn");

  // 找使用者劃的基地範圍多邊形圖層(drawnItems 內第一個可取頂點者)
  function getSiteLayer() {
    var found = null;
    drawnItems.eachLayer(function (layer) {
      if (found || typeof layer.getLatLngs !== "function") return;
      var o = siteOuterRing(layer);
      if (o && o.length >= 3) found = layer;
    });
    return found;
  }
  // 取多邊形外環的 LatLng 陣列(逐層下探至最內層 latlng 陣列)
  function siteOuterRing(layer) {
    var o = layer.getLatLngs();
    while (Array.isArray(o) && o.length && Array.isArray(o[0])) o = o[0];
    return o;
  }

  // 範圍逾 80 點先簡化(cookie 有 4KB 上限)。優先 turf.simplify 保形狀,失敗退回均勻取樣。
  var ZONING_MAX_PTS = 80;
  function simplifyRing(layer, ring) {
    if (ring.length <= ZONING_MAX_PTS) return ring;
    try {
      var gj = layer.toGeoJSON();
      for (var tol = 0.00005; tol <= 0.01; tol *= 2) {
        var s = turf.simplify(gj, { tolerance: tol, highQuality: true });
        var coords = s.geometry.coordinates;
        while (Array.isArray(coords) && coords.length && Array.isArray(coords[0][0])) coords = coords[0];
        if (coords.length - 1 <= ZONING_MAX_PTS && coords.length >= 4) {
          // GeoJSON ring 首尾重複,轉回 LatLng 形式並去尾
          return coords.slice(0, coords.length - 1).map(function (xy) {
            return { lat: xy[1], lng: xy[0] };
          });
        }
      }
    } catch (e) { /* 退回取樣 */ }
    var step = Math.ceil(ring.length / ZONING_MAX_PTS);
    return ring.filter(function (_, i) { return i % step === 0; });
  }

  // 組深連結/cookie 共用的 payload(座標 [緯度,經度],lat 在前,小數 6 位)
  function buildSitePayload() {
    var layer = getSiteLayer();
    if (!layer) return null;
    var ring = siteOuterRing(layer);
    if (!ring || ring.length < 3) return null;
    ring = simplifyRing(layer, ring);
    var pts = ring.map(function (p) { return [+p.lat.toFixed(6), +p.lng.toFixed(6)]; });
    var c = layer.getBounds().getCenter();
    return {
      v: 1,
      boundary: pts,
      locationName: lastRegionTitle || "",
      center: [+c.lat.toFixed(6), +c.lng.toFixed(6)],
      area: lastSiteAreaHa != null ? lastSiteAreaHa : undefined
    };
  }

  // 把範圍寫入跨子網域 cookie(heals_site @ .healsdesign.org),
  // 讓 zoning8circulation.healsdesign.org 等子網域工具可直接讀取;無範圍則清除。
  function syncSiteToZoning() {
    var payload = buildSitePayload();
    if (!payload) {
      document.cookie = "heals_site=; domain=.healsdesign.org; path=/; max-age=0; SameSite=Lax; Secure";
      return;
    }
    var enc = encodeURIComponent(JSON.stringify(payload));
    document.cookie = "heals_site=" + enc +
      "; domain=.healsdesign.org; path=/; max-age=86400; SameSite=Lax; Secure";
  }

  // 依按鈕是否有可送的範圍切換停用狀態,並同步 cookie
  function updateZoningBtnState() {
    if (zoningBtn) zoningBtn.disabled = !getSiteLayer();
    syncSiteToZoning();
  }

  if (zoningBtn) {
    zoningBtn.addEventListener("click", function () {
      var payload = buildSitePayload();
      if (!payload) { alert(t("zoning.need")); return; }
      syncSiteToZoning(); // 點擊時再同步一次,確保 cookie 為最新
      var url = ZONING_TOOL_URL + "/#site=" + encodeURIComponent(JSON.stringify(payload));
      window.open(url, "_blank");
    });
  }

  // ============================================================
  // HEALS 串接:匯出「完整基地分析 JSON」(打卡用 / 給下游站)
  // 把 map 算出的所有內容(lastAnalysis)＋基地幾何，序列化成一份
  // schema=heals-site-analysis/1 的 JSON：下載成檔 + 複製到剪貼簿。
  // 這是 heals_site cookie(只帶範圍)之外的「完整內容」通道。
  // ============================================================
  function hxLang(zh, en) { return document.documentElement.lang === "en" ? en : zh; }
  function hxToast(msg) {
    var d = document.createElement("div");
    d.textContent = msg;
    d.style.cssText = "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:#2f4a32;color:#fff;padding:10px 18px;border-radius:10px;font-size:13px;line-height:1.5;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,.25);max-width:90%;text-align:center";
    document.body.appendChild(d);
    setTimeout(function () { d.style.transition = "opacity .4s"; d.style.opacity = "0"; setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 400); }, 2800);
  }
  function buildSiteAnalysisExport() {
    var geo = buildSitePayload();
    if (!geo) {
      geo = {
        v: 1,
        boundary: [],
        locationName: lastRegionTitle || "",
        center: (typeof lastFocus !== "undefined" && lastFocus)
          ? [+lastFocus.lat.toFixed(6), +lastFocus.lng.toFixed(6)]
          : (lastAnalysis && lastAnalysis.focus ? [lastAnalysis.focus.lat, lastAnalysis.focus.lng] : null),
        area: lastSiteAreaHa != null ? lastSiteAreaHa : undefined
      };
    }
    return {
      schema: "heals-site-analysis/1",
      station: "map",
      exportedAt: new Date().toISOString(),
      site: geo,
      analysis: lastAnalysis || null
    };
  }
  function exportSiteAnalysisJSON() {
    if (!lastAnalysis) {
      alert(hxLang(
        "尚無分析結果可匯出。請先放標記或畫基地範圍，按「分析周邊綠地」(可再加生態、意見等)後再匯出。",
        "No analysis yet. Place a marker or draw the site, run Analyze nearby green space (optionally biodiversity / comments), then export."
      ));
      return;
    }
    var data = buildSiteAnalysisExport();
    var json = JSON.stringify(data, null, 2);
    var fname = (data.site && data.site.locationName ? data.site.locationName : "site") + "_基地分析.json";
    try {
      var blob = new Blob([json], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); if (a.parentNode) a.parentNode.removeChild(a); }, 0);
    } catch (e) {}
    try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(json); } catch (e) {}
    hxToast(hxLang(
      "已匯出基地分析 JSON，並複製到剪貼簿，可貼進總控台「完成打卡」。",
      "Site-analysis JSON exported and copied to clipboard. Paste it into the console check-in."
    ));
  }
  // ============================================================
  // heals-chain/1 匯出（01-foundation）：把本站基地分析寫入單一專案檔
  // ============================================================
  function hxFoundationBlock() {
    var a = lastAnalysis || {}, f = {};
    if (a.site_area_ha != null) f.area = a.site_area_ha;
    if (a.population != null) f.population = a.population;
    if (a.climate != null) f.climate = a.climate;
    if (a.healing_green_intervention != null) f.healingGreen = a.healing_green_intervention;
    if (a.biodiversity != null) f.biodiversity = a.biodiversity;
    if (a.green != null) f.green = a.green;
    if (a.heat != null) f.heat = a.heat;
    if (a.air_quality != null) f.airQuality = a.air_quality;
    if (a.openspace_service_level != null) f.openSpaceServiceLevel = a.openspace_service_level;
    if (a.user_comments != null) f.userComments = a.user_comments;
    return f;
  }
  function mergeFoundationIntoChain(prior, siteFallback, foundation) {
    var now = new Date().toISOString(), out = null;
    try { if (prior && prior.schema === "heals-chain/1") out = JSON.parse(JSON.stringify(prior)); } catch (e) { out = null; }
    if (!out) {
      var slug = ((siteFallback && siteFallback.locationName) || "project");
      out = { schema: "heals-chain/1", project: { id: "heals_" + String(slug).replace(/\s+/g, "-") + "_" + now.slice(0, 10).replace(/-/g, ""), name: slug, createdAt: now } };
    }
    out.project = out.project || {}; out.project.updatedAt = now;
    if (siteFallback && Array.isArray(siteFallback.boundary) && siteFallback.boundary.length >= 3) out.boundary = siteFallback.boundary;
    if (!Array.isArray(out.boundary) || out.boundary.length < 3) return { err: "noboundary" };
    out.site = out.site || {};
    if (siteFallback) {
      if (siteFallback.locationName) out.site.locationName = siteFallback.locationName;
      if (Array.isArray(siteFallback.center)) out.site.center = siteFallback.center;
      if (siteFallback.area != null) out.site.area = siteFallback.area;
    }
    out.stations = out.stations || {};
    out.stations.foundation = foundation;
    out.from = "foundation";
    out.trace = (Array.isArray(out.trace) ? out.trace : []).filter(function (e) { return !(e && e.station === "foundation"); });
    out.trace.push({ station: "foundation", at: now });
    return { chain: out };
  }
  function exportHealsChainMap() {
    if (!lastAnalysis) {
      alert(hxLang("尚無分析結果可匯出。請先放標記或畫基地範圍，按「分析周邊綠地」後再匯出。", "No analysis yet. Draw the site and run Analyze first."));
      return;
    }
    var geo = buildSitePayload();
    if (!geo) {
      alert(hxLang("heals-chain 需要基地範圍：請先用「繪製基地範圍」畫出多邊形（讀地是整條鏈的起點，範圍會傳給後續各站）再匯出。", "heals-chain needs a site boundary — draw the polygon first; it defines the boundary for the whole chain."));
      return;
    }
    var r = mergeFoundationIntoChain(null, geo, hxFoundationBlock());
    if (r.err) { alert(hxLang("尚無基地範圍。", "No site boundary.")); return; }
    var name = "heals-chain_" + String(geo.locationName || "project").replace(/[\\/:*?"<>|\s]+/g, "-") + "_01-foundation.json";
    var json = JSON.stringify(r.chain, null, 2);
    try {
      var blob = new Blob([json], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); if (a.parentNode) a.parentNode.removeChild(a); }, 0);
    } catch (e) {}
    try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(json); } catch (e) {}
    hxToast(hxLang("已匯出 heals-chain 專案檔（01-foundation）：交給讀人／生態，最終進綜整。", "heals-chain file exported (01-foundation) — pass to Read-the-People / Ecology, finally Synthesis."));
  }
  var exportJsonBtn = document.getElementById("export-json-btn");
  if (exportJsonBtn) exportJsonBtn.addEventListener("click", exportSiteAnalysisJSON);
  var hxChainBtn = document.createElement("button");
  hxChainBtn.className = "tool-btn"; hxChainBtn.type = "button"; hxChainBtn.id = "export-chain-btn";
  hxChainBtn.title = hxLang("匯出 heals-chain 專案檔（01-foundation），供下游各站與綜整", "Export the heals-chain project file (01-foundation)");
  if (exportJsonBtn && exportJsonBtn.parentNode) exportJsonBtn.parentNode.insertBefore(hxChainBtn, exportJsonBtn.nextSibling);
  hxChainBtn.addEventListener("click", exportHealsChainMap);
  function hxSyncChainLabel() { hxChainBtn.textContent = hxLang("⛓ 匯出 heals-chain（01-foundation）", "⛓ Export heals-chain (01-foundation)"); }
  hxSyncChainLabel();
  window.addEventListener("langchange", hxSyncChainLabel);
  function hxSyncExportLabel() {
    if (exportJsonBtn) exportJsonBtn.textContent = hxLang("匯出基地分析 JSON(打卡 / 串接用)", "Export site-analysis JSON (check-in / chaining)");
  }
  hxSyncExportLabel();
  window.addEventListener("langchange", hxSyncExportLabel);

  // 範圍編輯/刪除時亦同步(若啟用 leaflet-draw 編輯工具)
  map.on(L.Draw.Event.EDITED, updateZoningBtnState);
  map.on(L.Draw.Event.DELETED, updateZoningBtnState);

  // 語言切換時:重繪疊圖圖層名稱、空面板提示與已顯示的人口指標
  window.addEventListener("langchange", function () {
    // 疊圖圖層名稱
    document.querySelectorAll(".ov-label[data-ovkey]").forEach(function (el) {
      el.textContent = t(el.getAttribute("data-ovkey"));
    });
    // 空面板提示(分析結果為動態,提示使用者重新查詢以更新語言)
    if (!lastRegionProps) infoRegionEl.textContent = t("pop.tip");
    else if (lastRegionTitleHtml) renderIndicators(lastRegionProps, lastRegionTitleHtml);
  });

  // 在地圖右下角標示資料來源(Leaflet attribution 已含 NLSC)
  map.attributionControl.setPrefix(
    '<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>'
  );
})();
