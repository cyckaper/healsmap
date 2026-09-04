/* 簡易雙語 i18n:中文(預設)/ English
 * 用法:
 *   HTML 元素加 data-i18n="key" → applyI18n() 會填入對應語言文字
 *   JS 動態文字用 window.t("key") 取得字串
 *   語言記錄於 localStorage("lang")
 */
(function () {
  "use strict";

  var DICT = {
    "app.title": { zh: "HEALS 基地分析工作站", en: "HEALS Site Analysis Studio" },
    "app.subtitle": { zh: "HEALS Site Analysis Studio · 真實台灣圖資", en: "Real Taiwan Open Data" },

    "search.h": { zh: "地名搜尋", en: "Place Search" },
    "search.placeholder": { zh: "輸入地名,例如:台灣大學", en: "Enter a place, e.g. NTU" },
    "search.btn": { zh: "搜尋", en: "Search" },

    "basemap.h": { zh: "底圖", en: "Base Map" },
    "basemap.emap": { zh: "臺灣通用電子地圖 (EMAP)", en: "Taiwan E-Map (EMAP)" },
    "basemap.photomix": { zh: "正射影像+路名套疊 (PHOTO_MIX)", en: "Orthophoto + Labels (PHOTO_MIX)" },
    "basemap.photo2": { zh: "正射影像 (PHOTO2)", en: "Orthophoto (PHOTO2)" },

    "overlay.h": { zh: "疊圖圖層(官方圖資)", en: "Overlays (Official Data)" },
    "overlay.opacity": { zh: "透明度", en: "Opacity" },
    "overlay.hint": {
      zh: "綠地以「國土利用調查」官方圖層為視覺實況參考(較 OSM 完整);分析數值仍以 OSM 計算。土地權屬(公/私有)可開啟「公有土地地籍圖」(內政部國土測繪中心):有套疊色塊處為公有土地(國有、直轄市/縣市有、鄉鎮市有等),未標示者多為私有或其他;搭配「段籍圖」可對照地籍範圍。",
      en: "Use the official Land-Use Survey overlay as a visual reference (more complete than OSM); analysis figures still come from OSM. For land ownership (public/private), enable the Public Land Cadastre (NLSC): highlighted parcels are public land (national / municipal / township-owned), while unmarked parcels are mostly private or other; pair it with the Cadastral Map for parcel context."
    },
    "overlay.LUIMAP": { zh: "國土利用調查(綠地/土地利用)", en: "Land-Use Survey (green/land use)" },
    "overlay.SCHOOL": { zh: "各級學校範圍(學區)", en: "School Boundaries" },
    "overlay.LANDSECT": { zh: "段籍圖(地籍)", en: "Cadastral Map" },
    "overlay.LIQUEFACTION": { zh: "土壤液化潛勢", en: "Soil Liquefaction Potential" },
    "overlay.FAULT": { zh: "活動斷層分布線(2021)", en: "Active Fault Lines (2021)" },
    "overlay.FAULT_ZONE": { zh: "活動斷層地質敏感區(帶狀)", en: "Active Fault Sensitive Zone" },
    "overlay.warn": { zh: "⚠ 無法載入(端點待確認)", en: "⚠ Failed to load (endpoint TBD)" },

    "tools.h": { zh: "工具", en: "Tools" },
    "tools.marker": { zh: "點選放標記", en: "Place Marker" },
    "tools.polygon": { zh: "繪製基地範圍", en: "Draw Site" },
    "tools.clear": { zh: "清除全部", en: "Clear All" },
    "tools.hint": { zh: "兩種分析模式:<b>點選放標記</b>=以該點周邊評估生活圈(村里人口、半徑 500m 綠覆、可及性);<b>繪製基地範圍</b>=以基地紅線評估開發基地(鄉鎮人口、基地內綠覆、§45 法規、實際面積)。", en: "Two modes: <b>Place Marker</b> = assess the surroundings of a point (village population, green cover within 500 m, accessibility); <b>Draw Site</b> = assess a development site (township population, green cover within the site, §45, actual area)." },

    "area.h": { zh: "基地面積", en: "Site Area" },
    "area.unit": { zh: "公頃", en: "ha" },

    "pop.h": { zh: "人口與指標", en: "Population & Indicators" },
    "pop.loading": { zh: "載入圖資中…(點一個點查村里、畫一塊面查鄉鎮)", en: "Loading data… (click a point for village, draw an area for township)" },

    "green.h": { zh: "開放空間 · 綠地", en: "Open Space · Green" },
    "green.btn": { zh: "分析周邊綠地", en: "Analyze Green Space" },
    "green.hint": { zh: "先放標記或畫基地,再按「分析周邊綠地」。", en: "Place a marker or draw a site, then click Analyze Green Space." },

    "heat.h": { zh: "熱環境 · 健康研判", en: "Heat & Health Assessment" },
    "heat.hint": { zh: "按上方「分析周邊綠地」後,這裡顯示熱環境與脆弱族群研判。", en: "After analyzing green space, heat and vulnerability assessment appears here." },

    "aqi.h": { zh: "空氣品質(AQI)", en: "Air Quality (AQI)" },
    "aqi.hint": { zh: "按「分析周邊綠地」後,這裡顯示距基地最近的環境部測站即時空氣品質。", en: "After running green analysis, this shows live air quality from the nearest MOENV station." },
    "aqi.loading": { zh: "載入空氣品質中…(環境部)", en: "Loading air quality… (MOENV)" },
    "aqi.offline": { zh: "空氣品質查詢失敗,請稍後再試。", en: "Air quality query failed, please retry later." },
    "aqi.nodata": { zh: "查無鄰近測站資料。", en: "No nearby station data." },
    "aqi.title": { zh: "最近測站:<b>{s}</b>(約 {d} km)· AQI <b style='color:{c}'>{aqi} · {lv}</b>", en: "Nearest station: <b>{s}</b> (~{d} km) · AQI <b style='color:{c}'>{aqi} · {lv}</b>" },
    "aqi.aqi": { zh: "AQI 指標", en: "AQI" },
    "aqi.status": { zh: "狀態", en: "Status" },
    "aqi.pm25": { zh: "PM2.5", en: "PM2.5" },
    "aqi.pm10": { zh: "PM10", en: "PM10" },
    "aqi.pollutant": { zh: "主要污染物", en: "Main pollutant" },
    "aqi.note": { zh: "資料:環境部空氣品質指標(AQI),每小時更新;發布時間 {t}。取距基地最近之測站,僅供參考。", en: "Data: MOENV Air Quality Index (AQI), hourly; published {t}. Nearest station to the site, for reference only." },
    "aqi.lvGood": { zh: "良好", en: "Good" },
    "aqi.lvModerate": { zh: "普通", en: "Moderate" },
    "aqi.lvUSG": { zh: "對敏感族群不健康", en: "Unhealthy for Sensitive" },
    "aqi.lvUnhealthy": { zh: "不健康", en: "Unhealthy" },
    "aqi.lvVeryUnhealthy": { zh: "非常不健康", en: "Very Unhealthy" },
    "aqi.lvHazardous": { zh: "危害", en: "Hazardous" },
    "aqi.lvNA": { zh: "無資料", en: "N/A" },

    "ossl.h": { zh: "開放空間服務水準", en: "Open Space Service Level" },
    "ossl.hint": { zh: "按「分析周邊綠地」後,這裡以步行 10 分鐘可及性評估綠地、運動、步道、運輸與公廁的服務水準。", en: "After running green analysis, this rates service level by 10-minute walk access to green space, sports, trails, transit and toilets." },
    "ossl.loading": { zh: "計算開放空間服務水準中…(OSM / Overpass)", en: "Computing open space service level… (OSM / Overpass)" },
    "ossl.title": { zh: "服務水準總分:<b style='color:{c}'>{s} · {b}</b>", en: "Service level: <b style='color:{c}'>{s} · {b}</b>" },
    "ossl.note": { zh: "分數=0.6×鄰近度+0.4×供給度,總分為加權平均;步行以直線×1.3 近似路網。資料:OSM / Overpass 即時查詢,屬下限估計。", en: "Score = 0.6×proximity + 0.4×supply, weighted average; walking approximated as straight-line ×1.3. Data: OSM / Overpass live query, lower-bound estimate." },
    "ossl.offline": { zh: "開放空間服務水準查詢失敗,請稍後再試。", en: "Open space service level query failed, please retry later." },
    "ossl.unavailable": { zh: "開放空間服務水準模組未載入。", en: "Open space service level module not loaded." },

    "hgip.h": { zh: "療癒綠地介入需求", en: "Healing Green Intervention Priority" },
    "hgip.hint": { zh: "按「分析周邊綠地」後,這裡綜合綠地匱乏、脆弱族群、熱壓力與開放空間可及性,研判療癒綠地介入的優先度。", en: "After running green analysis, this synthesizes green deficit, vulnerable population, heat stress and open-space access into a healing-green intervention priority." },
    "hg.title": { zh: "介入需求指數:<b style='color:{c}'>{s} / 100 · {lv}</b>", en: "Intervention priority: <b style='color:{c}'>{s} / 100 · {lv}</b>" },
    "hg.lvHigh": { zh: "高(優先介入)", en: "High (priority)" },
    "hg.lvMid": { zh: "中", en: "Medium" },
    "hg.lvLow": { zh: "低", en: "Low" },
    "hg.fGreen": { zh: "綠地匱乏", en: "Green deficit" },
    "hg.fVuln": { zh: "脆弱族群", en: "Vulnerable pop." },
    "hg.fHeat": { zh: "熱壓力", en: "Heat stress" },
    "hg.fAccess": { zh: "開放空間可及性不足", en: "Low open-space access" },
    "hg.note": { zh: "指數=四因子(綠地匱乏、脆弱族群、熱壓力、可及性不足)加權合成,缺資料者自動排除;主導因子為「{f}」(標 ◀)。屬研判性指標,供療癒景觀介入優先排序參考。", en: "Index = weighted blend of four factors (green deficit, vulnerable pop., heat stress, low access); missing factors auto-excluded. Dominant factor: \"{f}\" (marked ◀). An advisory index for prioritizing healing-landscape intervention." },

    "biodiv.h": { zh: "生態 · 生物多樣性", en: "Ecology · Biodiversity" },
    "biodiv.btn": { zh: "查詢周邊物種紀錄", en: "Query Species Records" },
    "biodiv.hint": { zh: "先放標記或畫基地,再按「查詢周邊物種紀錄」。", en: "Place a marker or draw a site, then click Query Species Records." },

    "cm.h": { zh: "使用者意見圖層", en: "User Comments Layer" },
    "cm.hint": { zh: "上傳含經緯度與意見的 Excel(.xlsx)或 CSV,於地圖標示落在選定範圍/附近的點位,並摘要最常見的意見。", en: "Upload an Excel (.xlsx) or CSV with coordinates and comments; points within the selected site/nearby are mapped and the most common comments summarized." },
    "cm.upload": { zh: "上傳資料檔(xlsx / csv)", en: "Upload data file (xlsx / csv)" },
    "cm.unavailable": { zh: "意見圖層模組未載入。", en: "Comments layer module not loaded." },
    "cm.parsing": { zh: "解析檔案中…", en: "Parsing file…" },
    "cm.parseErr": { zh: "檔案解析失敗,請確認為 .xlsx 或 .csv。", en: "Failed to parse file; please ensure it is .xlsx or .csv." },
    "cm.empty": { zh: "檔案沒有資料列。", en: "No data rows in the file." },
    "cm.colLat": { zh: "緯度欄", en: "Latitude column" },
    "cm.colLng": { zh: "經度欄", en: "Longitude column" },
    "cm.colComment": { zh: "意見欄", en: "Comment column" },
    "cm.needLatLng": { zh: "請指定經度與緯度欄位。", en: "Please specify longitude and latitude columns." },
    "cm.noValid": { zh: "無有效座標的資料列。", en: "No rows with valid coordinates." },
    "cm.scopeSite": { zh: "選定基地範圍內", en: "within the drawn site" },
    "cm.scopeRadius": { zh: "焦點周邊 {r} m", en: "within {r} m of the point" },
    "cm.scopeAll": { zh: "全部(尚未選定地點,先放標記或畫基地以篩選)", en: "all (no location selected yet — place a marker or draw a site to filter)" },
    "cm.result": { zh: "{scope}:<b>{n}</b> 筆意見(共上傳 {total} 筆)", en: "{scope}: <b>{n}</b> comments (of {total} uploaded)" },
    "cm.count": { zh: "範圍內點位", en: "Points in scope" },
    "cm.withText": { zh: "含意見文字", en: "With comment text" },
    "cm.unitPt": { zh: "筆", en: "" },
    "cm.localTitle": { zh: "① 關鍵詞統計(本地詞頻)", en: "① Keyword Stats (local word frequency)" },
    "cm.aiTitle": { zh: "② AI 主題摘要(送 Claude 分析)", en: "② AI Theme Summary (analyzed by Claude)" },
    "cm.topWords": { zh: "最常見關鍵詞", en: "Most common keywords" },
    "cm.samples": { zh: "代表性意見原句", en: "Representative comments" },
    "cm.noText": { zh: "(無文字)", en: "(no text)" },
    "cm.note": { zh: "關鍵詞為本地詞頻統計(中文採 2-gram,英文按詞;每則意見每詞計一次);資料僅存於你的瀏覽器,未上傳。AI 摘要才會將範圍內意見送後端。", en: "Keywords are computed locally (Chinese bigrams, English words; once per comment). Data stays in your browser; only the AI summary sends in-scope comments to the backend." },
    "cm.aiBtn": { zh: "AI 摘要意見主題", en: "AI Summarize Themes" },
    "cm.aiLoading": { zh: "AI 摘要意見主題中…", en: "AI summarizing comment themes…" },
    "cm.reselect": { zh: "已清除標示。重新放標記或畫基地即可再篩選已上傳的意見。", en: "Markers cleared. Place a marker or draw a site to re-filter the uploaded comments." },

    "ai.h": { zh: "AI 解讀", en: "AI Analysis" },
    "ai.btn": { zh: "產生 AI 基地分析報告", en: "Generate AI Site Report" },
    "ai.export": { zh: "匯出 / 列印報告(可存 PDF)", en: "Export / Print Report (PDF)" },
    "zoning.btn": { zh: "送到分區與動線工具", en: "Send to Zoning & Circulation tool" },
    "zoning.hint": { zh: "劃出基地範圍後,可一鍵把範圍送到「景觀規劃分區與動線」工具,免重劃。", en: "After drawing the site boundary, send it to the Zoning & Circulation tool in one click—no need to redraw." },
    "zoning.need": { zh: "請先劃出基地範圍", en: "Please draw the site boundary first" },

    "hist.h": { zh: "歷史紀錄(保存與比較)", en: "History (Save & Compare)" },
    "hist.hint": { zh: "每次分析完成後自動保存於此瀏覽器(localStorage)。勾選 2–3 筆可並排比較。", en: "Each completed analysis is auto-saved in this browser (localStorage). Check 2–3 records to compare side by side." },
    "hist.empty": { zh: "尚無保存的分析。完成一次「分析周邊綠地」後會自動保存。", en: "No saved analyses yet. Run a green-space analysis and it will be saved automatically." },
    "hist.load": { zh: "載入", en: "Load" },
    "hist.rename": { zh: "改名", en: "Rename" },
    "hist.del": { zh: "刪除", en: "Delete" },
    "hist.delConfirm": { zh: "確定刪除這筆紀錄?此動作無法復原。", en: "Delete this record? This cannot be undone." },
    "hist.compare": { zh: "比較選取(2–3 筆)", en: "Compare selected (2–3)" },
    "hist.needTwo": { zh: "請勾選 2–3 筆再按比較。", en: "Check 2–3 records to compare." },
    "hist.max3": { zh: "最多勾選 3 筆。", en: "You can select at most 3 records." },
    "hist.export": { zh: "匯出全部(JSON)", en: "Export all (JSON)" },
    "hist.import": { zh: "匯入(JSON)", en: "Import (JSON)" },
    "hist.imported": { zh: "已匯入 {n} 筆新紀錄。", en: "Imported {n} new record(s)." },
    "hist.importBad": { zh: "匯入失敗:檔案格式不正確。", en: "Import failed: invalid file format." },
    "hist.saveFail": { zh: "無法寫入瀏覽器儲存空間(可能為私密瀏覽或空間不足),紀錄未保存。", en: "Could not write to browser storage (private browsing or quota exceeded); the record was not saved." },
    "hist.savedAuto": { zh: "已自動保存本次分析。", en: "Analysis auto-saved." },
    "hist.loaded": { zh: "已載入歷史紀錄:地圖與各面板已還原(面板為保存當下的文字快照)。", en: "Record loaded: map and panels restored (panels show the saved text snapshot)." },
    "hist.renamePrompt": { zh: "輸入新名稱:", en: "Enter a new name:" },
    "hist.unnamed": { zh: "未命名地點", en: "Unnamed site" },
    "hist.cmpTitle": { zh: "基地分析比較", en: "Site Analysis Comparison" },
    "hist.cmpName": { zh: "名稱", en: "Name" },
    "hist.cmpArea": { zh: "基地面積", en: "Site area" },
    "hist.cmpSaved": { zh: "保存時間", en: "Saved at" },

    "help.t": { zh: "ⓘ 說明與計算方式", en: "ⓘ About & formulas" },
    "help.search": {
      zh: "<b>搜尋</b>:輸入地名或地址,經 OpenStreetMap <b>Nominatim</b> 地理編碼服務轉為經緯度,地圖飛往該處並放上標記(可直接作為分析點)。結果取決於 OSM 資料庫;地名重複時可加縣市名縮小範圍,例如「大安森林公園 台北」。",
      en: "<b>Search</b>: geocodes the place name via OpenStreetMap <b>Nominatim</b>, flies the map there and drops a marker (usable as the analysis point). Add a city name to disambiguate."
    },
    "help.basemap": {
      zh: "底圖切換(單選),皆為內政部國土測繪中心(NLSC)官方 WMTS 圖磚:<br>· <b>EMAP</b> 臺灣通用電子地圖(一般地圖)<br>· <b>PHOTO_MIX</b> 正射航空影像+路名註記<br>· <b>PHOTO2</b> 純正射影像<br>底圖只影響視覺,不影響任何指標計算。",
      en: "Basemap (single choice), all official NLSC WMTS tiles: <b>EMAP</b> general e-map; <b>PHOTO_MIX</b> orthophoto with road labels; <b>PHOTO2</b> plain orthophoto. Visual only—no effect on any metric."
    },
    "help.overlay": {
      zh: "官方圖資疊圖(可複選;「透明度」滑桿調整所有疊圖的不透明度 0–1):<br>· <b>國土利用調查</b>:土地使用「現況」(航照判釋官方調查),非法定分區<br>· <b>各級學校範圍</b>:學校用地範圍<br>· <b>段籍圖</b>:地籍段界(NLSC)<br>· <b>公有土地地籍圖</b>:有色塊 = 公有土地(國有/直轄市縣市有/鄉鎮市有等),未標示者多為私有或其他 → 公私有判讀依據(看的是「所有權」而非用途)<br>· <b>土壤液化潛勢 / 活動斷層(2021)/ 斷層地質敏感區</b>:經濟部地礦中心 WMS<br>⚠ 疊圖僅供視覺參考;本站分析數值另以 OSM 即時查詢計算。",
      en: "Official overlays (multi-select; the opacity slider applies to all): <b>Land-Use Survey</b> = actual current use (not legal zoning); <b>School boundaries</b>; <b>Cadastral map</b>; <b>Public Land Cadastre</b> = highlighted parcels are publicly owned (ownership, not use) → basis for public/private reading; <b>Soil liquefaction / active faults (2021) / fault-sensitive zones</b> from MOEA geological WMS. Overlays are visual references; analysis figures come from live OSM queries."
    },
    "help.tools": {
      zh: "· <b>點選放標記</b>:切換後在地圖點一下放置分析點 →「點模式」,以 500 m 服務圈分析周邊<br>· <b>繪製基地範圍</b>:在地圖上畫多邊形 →「面模式」,以範圍內為分析對象;完成後自動計算面積、查詢所在鄉鎮,並啟用「送到分區與動線工具」<br>· <b>清除全部</b>:移除標記、範圍與各面板結果(<b>不</b>刪除歷史紀錄與已上傳的意見資料)",
      en: "· <b>Place marker</b>: click the map to set the analysis point → point mode (500 m service circle). · <b>Draw site boundary</b>: draw a polygon → site mode (analyze within the boundary); area and township lookup run automatically. · <b>Clear all</b>: removes markers/boundary and panel results (history records and uploaded comments are kept)."
    },
    "help.area": {
      zh: "基地面積以 Turf.js 對多邊形做<b>球面(測地)面積</b>計算:<br><b>面積(公頃)= 多邊形球面面積(m²)÷ 10,000</b><br>畫多個範圍時加總,並顯示範圍數。",
      en: "Site area is the <b>geodesic (spherical) area</b> of the polygon via Turf.js:<br><b>Area (ha) = spherical area (m²) ÷ 10,000</b>. Multiple shapes are summed."
    },
    "help.pop": {
      zh: "資料:內政部戶政司「村里單齡人口統計」(每月),於網站建置時匯入;<b>點一個點查村里、畫範圍查其中心所在鄉鎮</b>(鄉鎮值由轄下村里加總)。公式:<br>· <b>人口數</b> = 男性 + 女性人口<br>· <b>戶數</b> = 戶籍戶數合計<br>· <b>人口密度</b> = 人口數 ÷ 面積(km²)<br>· <b>戶量</b> = 人口數 ÷ 戶數(人/戶)<br>· <b>性比例</b> = 男 ÷ 女 × 100(每百女子對應男子數)<br>· <b>老化指數</b> = 老年(65+)÷ 幼年(0–14)× 100(>100 表老年多於幼年)<br>· <b>扶養比</b> = (幼年+老年)÷ 青壯年(15–64)× 100<br>· <b>扶幼比</b> = 幼年 ÷ 青壯年 × 100;<b>扶老比</b> = 老年 ÷ 青壯年 × 100<br>· <b>面積</b> = 行政區界球面面積(km²)",
      en: "Data: MOI monthly single-age population by village, imported at build time; a point looks up the <b>village</b>, a polygon the <b>township</b> at its centroid (aggregated from villages). Formulas:<br>· <b>Population</b> = male + female · <b>Households</b> = registered households<br>· <b>Density</b> = population ÷ area (km²) · <b>Household size</b> = population ÷ households<br>· <b>Sex ratio</b> = male ÷ female × 100 · <b>Aging index</b> = (65+) ÷ (0–14) × 100<br>· <b>Dependency</b> = (young + old) ÷ (15–64) × 100; child/old dependency use the same denominator<br>· <b>Area</b> = geodesic area of the boundary (km²)"
    },
    "help.green": {
      zh: "<b>「分析周邊綠地」按鈕</b>:向 OpenStreetMap Overpass 即時查詢綠地(公園、花園、草地、樹林等),並依模式統計:<br>① <b>點模式</b>(放標記):以 <b>500 m</b> 半徑服務圈為範圍<br>② <b>面模式</b>(畫範圍):統計與基地相交的部分<br>定義:<b>有效公園</b> = OSM leisure 類綠地且面積 ≥ <b>0.1 公頃</b>(1,000 m²,兒童遊樂場法定最小規模);其餘為「零星綠地」(計入綠覆率、不算公園)。<br>· <b>最近公園距離</b> = 分析點至最近有效公園的直線距離(m)<br>· <b>300/500 m 公園數</b> = 門檻距離內的有效公園數<br>· <b>綠覆率(%)= 範圍內全部綠地面積 ÷ 分析範圍面積 × 100</b><br>(點模式分母 = π×500²;面模式分母 = 基地面積)<br>· <b>300 m 內有公園</b>:對照 <b>3-30-300</b> 綠色城市準則(住家 300 m 內應可及綠地)<br>· <b>都市計畫法 §45</b>:公園、綠地、廣場、兒童遊樂場合計應 ≥ 計畫面積 10%(以綠覆率對照,供參考)<br>⚠ OSM 為社群資料,數值屬<b>下限估計</b>。",
      en: "<b>Analyze green space</b>: queries OSM Overpass live. ① Point mode: a <b>500 m</b> service circle; ② Site mode: intersection with your boundary. <b>Effective park</b> = OSM leisure green ≥ <b>0.1 ha</b> (1,000 m²); everything else counts toward coverage but not as a park.<br>· Nearest-park distance (m), park counts within 300/500 m<br>· <b>Green coverage (%) = green area within scope ÷ scope area × 100</b> (denominator: π×500² in point mode; site area in site mode)<br>· 300 m access checks the <b>3-30-300</b> guideline; the 10% figure references Urban Planning Act §45.<br>OSM is community data—treat values as a <b>lower bound</b>."
    },
    "help.ossl": {
      zh: "以基地為圓心向 Overpass 查 <b>1,000 m</b> 內五類設施,估<b>步行 10 分鐘(800 m)</b>生活圈的服務水準。<br><b>步行距離 = 直線距離 × 1.3</b>(繞路係數)<br>每類兩個子分數:<br>· 鄰近性 <b>P = 100 × e^(−最近步行距離 ÷ λ)</b>(λ 依類別 250–500 m)<br>· 數量 <b>V = 100 × (1 − e^(−800 m 內數量 ÷ k))</b>(k 依類別 2–4)<br>· 類別分數 <b>S = 0.6P + 0.4V</b><br><b>總分 = Σ(S × 權重)</b>;權重:綠地公園 0.35、運動遊憩 0.20、自行車/步道 0.15、大眾運輸 0.15、公廁 0.15<br>分級:≥80 優 / ≥60 良 / ≥40 普通 / ≥20 不足 / <20 匱乏。⚠ OSM 即時查詢之下限估計。",
      en: "Queries five facility classes within <b>1,000 m</b> and scores a <b>10-min walk (800 m)</b> catchment. <b>Walk distance = straight-line × 1.3</b> (detour factor). Per class: proximity <b>P = 100·e^(−nearest ÷ λ)</b> (λ 250–500 m), quantity <b>V = 100·(1 − e^(−count ÷ k))</b> (k 2–4), class score <b>S = 0.6P + 0.4V</b>. <b>Overall = Σ(S × weight)</b> with weights 0.35 parks / 0.20 sports / 0.15 cycling-trails / 0.15 transit / 0.15 toilets. Bands: ≥80 excellent, ≥60 good, ≥40 fair, ≥20 poor, <20 deprived. Lower-bound estimate from OSM."
    },
    "help.climate": {
      zh: "資料:Open-Meteo <b>ERA5 再分析</b>,參考期 <b>2020–2024</b>(5 個完整年)逐日資料,屬多年「氣候背景值」而非即時天氣。<br>· <b>年均溫</b> = 全期日均溫平均<br>· <b>最熱月</b> = 各月平均溫最大者<br>· <b>高溫日數/年</b> = 日最高溫 ≥ <b>32°C</b> 的日數 ÷ 年數<br>· <b>年降雨量</b> = 全期日雨量總和 ÷ 年數<br>· <b>盛行風向</b> = 逐日主導風向(<b>來向</b>)化為 8 方位取眾數 → 通風廊道與開窗方位參考<br>· <b>日射量</b> = 日短波輻射總量平均(MJ/m²/日)→ 遮蔭與太陽能評估參考",
      en: "Open-Meteo <b>ERA5 reanalysis</b>, daily data for <b>2020–2024</b> (climatic background, not live weather).<br>· Annual mean temp = mean of daily means · Hottest month = max monthly mean<br>· Heat days/yr = days with Tmax ≥ <b>32°C</b> ÷ years · Annual rainfall = total ÷ years<br>· Prevailing wind = mode of daily dominant direction (<b>from</b>-direction, 8 sectors)<br>· Solar = mean daily shortwave radiation (MJ/m²/day)"
    },
    "help.heat": {
      zh: "綜合「綠地缺口」與「脆弱人口」的 0–1 研判指數:<br>· <b>綠地缺口</b> = clamp((30 − 綠覆率%) ÷ 30, 0–1)(30% 為目標綠覆)<br>· <b>脆弱人口</b> = min(1, (高齡% + 幼年%) ÷ 40)(合計 40% 視為高)<br>· <b>熱脆弱度 = 0.5 × 綠地缺口 + 0.5 × 脆弱人口</b>(無人口資料時 = 綠地缺口)<br>分級:>0.66 高 / >0.34 中 / 其餘低。<br>其中 高齡占比 = 65+ 人口 ÷ 總人口 × 100;幼年占比 = 0–14 ÷ 總人口 × 100。<br>⚠ 屬研判指標(代理變數),非實測熱環境或健康數據。",
      en: "A 0–1 screening index combining green deficit and vulnerable population:<br>· <b>Green deficit</b> = clamp((30 − coverage%) ÷ 30, 0–1) (30% target)<br>· <b>Vulnerable share</b> = min(1, (elderly% + child%) ÷ 40) (40% = high)<br>· <b>Heat vulnerability = 0.5 × deficit + 0.5 × vulnerable</b> (deficit only if no demographics)<br>Bands: >0.66 high / >0.34 medium / else low. Elderly% = 65+ ÷ pop × 100; child% = 0–14 ÷ pop × 100. A screening proxy, not measured data."
    },
    "help.aqi": {
      zh: "資料:環境部空氣品質指標 <b>AQI</b> 開放資料(每小時更新),經本站後端代理取得全台測站後,以 <b>Haversine 大圓距離</b>找出<b>距基地最近的測站</b>顯示(標題附測站距離)。<br>AQI 分級:0–50 良好 / 51–100 普通 / 101–150 對敏感族群不健康 / 151–200 不健康 / 201–300 非常不健康 / >300 危害<br>另列 PM2.5、PM10(µg/m³)與主要污染物。⚠ 為「最近測站」之測值,非基地實測;測站與基地有距離。",
      en: "MOENV hourly <b>AQI</b> open data via this site's backend proxy; the <b>nearest station</b> is chosen by <b>Haversine great-circle distance</b> (distance shown). AQI bands: 0–50 good / 51–100 moderate / 101–150 unhealthy for sensitive groups / 151–200 unhealthy / 201–300 very unhealthy / >300 hazardous. PM2.5, PM10 (µg/m³) and the main pollutant are listed. Station reading, not an on-site measurement."
    },
    "help.hgip": {
      zh: "療癒綠地介入需求指數(0–100):四因子各正規化為 0–1 後加權平均:<br>· <b>綠地匱乏</b>(權重 0.35)= clamp((30 − 綠覆率%) ÷ 30)<br>· <b>脆弱族群</b>(0.30)= clamp((高齡% + 幼年%) ÷ 40)<br>· <b>熱壓力</b>(0.20)= clamp(年高溫日數 ÷ 90)(90 天視為極高)<br>· <b>可及性不足</b>(0.15)= clamp((100 − 開放空間服務總分) ÷ 100)<br><b>指數 = Σ(權重 × 因子) ÷ Σ權重 × 100</b>(缺資料的因子自動排除、權重重新正規化)<br>分級:≥67 高 / ≥34 中 / <34 低;<b>◀</b> 標示主導因子(權重 × 值最大者),對應建議的療癒景觀策略。⚠ 屬多因子研判,非實測健康數據。",
      en: "Healing Green Intervention Priority (0–100): weighted mean of four normalized factors — <b>green scarcity</b> (0.35) = clamp((30 − coverage%) ÷ 30); <b>vulnerable groups</b> (0.30) = clamp((elderly% + child%) ÷ 40); <b>heat stress</b> (0.20) = clamp(heat days/yr ÷ 90); <b>poor access</b> (0.15) = clamp((100 − OSSL) ÷ 100). <b>Index = Σ(w × v) ÷ Σw × 100</b>; missing factors are dropped and weights renormalized. Bands: ≥67 high / ≥34 medium / <34 low; <b>◀</b> marks the dominant factor (max w × v). A screening index."
    },
    "help.biodiv": {
      zh: "<b>「查詢周邊物種紀錄」按鈕</b>:查 iNaturalist 社群觀測 API,以分析點半徑 <b>1 km</b> 取「可驗證(verifiable)」紀錄。<br>· <b>物種數</b> = 不重複物種數<br>· <b>觀測筆數</b> = 觀測紀錄總數<br>· <b>受脅物種</b> = IUCN 近危(NT)以上等級(NT/VU/EN/CR)之物種數<br>另列代表性物種(觀測數最多)與分類群組成。⚠ 涵蓋度依當地觀測熱度而異,屬參考性指標,非完整生態調查。",
      en: "<b>Query species records</b>: iNaturalist API, verifiable observations within <b>1 km</b> of the analysis point. Species = distinct taxa; observations = record count; threatened = taxa at IUCN NT or above (NT/VU/EN/CR). Top species and taxa composition are listed. Coverage depends on local observer activity—a reference, not a full survey."
    },
    "help.cm": {
      zh: "<b>上傳資料檔</b>:讀取含經緯度與意見欄的 xlsx/csv(於瀏覽器本機解析,不上傳伺服器),選好欄位對應後:<br>· 只納入落在<b>基地範圍內</b>(面模式)或分析點 <b>500 m 內</b>(點模式)的點位並標於地圖<br>· 統計最常見詞彙(<b>詞頻</b>,去除常見停用詞)<br><b>AI 摘要意見主題</b>:把入選意見送 AI 歸納主題與訴求(此步驟會經後端呼叫 AI)。",
      en: "<b>Upload file</b>: parses an xlsx/csv with coordinates and a comment column locally in your browser. Only points inside the site boundary (site mode) or within 500 m (point mode) are mapped and counted; top words are ranked by frequency. <b>AI summarize</b> sends the selected comments to the AI backend for thematic summary."
    },
    "help.ai": {
      zh: "· <b>產生 AI 基地分析報告</b>:把各面板的「實際數值」(人口、綠地、服務水準、氣候、熱環境、空品、HGIP、物種、意見)送後端 AI,產生引用真實數據的解讀報告;下方顯示本次 token 用量。<br>· <b>匯出 / 列印報告</b>:另開乾淨頁面,用瀏覽器「列印」即可存 PDF;<b>頁尾含 HEALS-BOUNDARY 座標標記</b>(純文字,供下游工具從 PDF 還原基地範圍)。<br>· <b>送到分區與動線工具</b>:把已劃基地範圍(頂點座標,[緯度,經度])以深連結新分頁帶到「景觀規劃分區與動線」,並同步寫入跨子網域 cookie;範圍逾 80 點會自動簡化。未劃範圍時按鈕停用。",
      en: "· <b>Generate AI report</b>: sends the panels' actual figures to the AI backend for a grounded interpretive report (token usage shown).<br>· <b>Export / print</b>: opens a clean page—use the browser's Print to save a PDF; the footer carries a plain-text <b>HEALS-BOUNDARY</b> marker so downstream tools can recover the site boundary from the PDF.<br>· <b>Send to Zoning & Circulation</b>: deep-links the drawn boundary ([lat,lng] vertices) to the downstream tool and syncs a cross-subdomain cookie; boundaries over 80 vertices are simplified. Disabled until a boundary is drawn."
    },
    "help.hist": {
      zh: "每次分析完成後<b>自動保存</b>於此瀏覽器 localStorage(單一鍵 sas_analyses;上限 30 筆,超過汰換最舊;同一次分析各面板陸續完成時更新同一筆)。<br>· <b>載入</b>:還原地圖標記/範圍與各面板的文字快照(要最新數據請重新分析)<br>· <b>改名 / 刪除</b>:管理紀錄(刪除需確認)<br>· <b>比較</b>:勾選 2–3 筆開新視窗並排對照(頂端基本資料表+八面向逐項;窄螢幕 <820px 改上下堆疊)<br>· <b>匯出全部 / 匯入(JSON)</b>:備份與跨裝置還原(依 id 去重合併)<br>⚠ 紀錄只存在這台裝置的瀏覽器;私密瀏覽或清除網站資料會遺失,重要結果請匯出備份。",
      en: "Each completed analysis is <b>auto-saved</b> to this browser's localStorage (key sas_analyses; max 30, oldest dropped; one record per analysis run, updated as panels finish).<br>· <b>Load</b> restores the map marker/boundary and text snapshots of every panel (re-run the analysis for fresh data)<br>· <b>Rename / Delete</b> manage records (delete asks for confirmation)<br>· <b>Compare</b>: check 2–3 records for a side-by-side window (stacks below 820px)<br>· <b>Export / Import (JSON)</b> back up and restore across devices (merged, de-duplicated by id)<br>Records live only in this browser—private browsing or clearing site data erases them; export to keep backups."
    },

    "credits.h": { zh: "資料來源與版權", en: "Data Sources & Credits" },
    "credits.basemap": { zh: "底圖圖磚:內政部國土測繪中心 (NLSC)", en: "Base tiles: NLSC, Taiwan" },
    "credits.boundary": { zh: "行政界線:NLSC / taiwan-atlas(村里、鄉鎮市區)", en: "Boundaries: NLSC / taiwan-atlas (village, township)" },
    "credits.pop": { zh: "人口統計:內政部戶政司 ODRP014(11412 期)", en: "Population: MOI Household Registration ODRP014 (2025-12)" },
    "credits.geo": { zh: "地質圖層(土壤液化/活動斷層):經濟部地質調查及礦業管理中心", en: "Geology (liquefaction/faults): Geological Survey & Mining Mgmt Agency, MOEA" },
    "credits.osm": { zh: "綠地圖徵:© OpenStreetMap 貢獻者(ODbL),經 Overpass API 即時查詢", en: "Green features: © OpenStreetMap contributors (ODbL), via Overpass API" },
    "credits.openmeteo": { zh: "氣候背景:Open-Meteo(ERA5 重分析,CC BY 4.0)", en: "Climate background: Open-Meteo (ERA5 reanalysis, CC BY 4.0)" },
    "credits.moenv": { zh: "空氣品質(AQI):環境部環境資料開放平臺", en: "Air quality (AQI): MOENV Environmental Data Open Platform" },
    "credits.nominatim": { zh: "地名搜尋:OpenStreetMap Nominatim", en: "Place search: OpenStreetMap Nominatim" },
    "credits.inat": { zh: "生物多樣性:iNaturalist(CC 觀測資料)", en: "Biodiversity: iNaturalist (CC observations)" },
    "credits.ai": { zh: "AI 解讀:Anthropic Claude", en: "AI analysis: Anthropic Claude" },
    "credits.disclaimer": {
      zh: "免責聲明:綠地與綠覆率為 OpenStreetMap 即時查詢,屬下限估計,可能不完整;熱環境/健康為依代理指標之研判,非實測氣溫或健康數據。本工具分析僅供規劃參考,不構成正式法定文件或專業意見。",
      en: "Disclaimer: green space and canopy figures are live OSM queries (lower-bound estimates, possibly incomplete); heat/health results are proxy-based assessments, not measured temperature or health data. For planning reference only; not an official or professional document."
    },
    "foot.author": {
      zh: "張俊彥 國立臺灣大學園藝暨景觀學系特聘教授",
      en: "Chun-Yen Chang, Distinguished Professor, Department of Horticulture and Landscape Architecture, National Taiwan University"
    },
    "foot": { zh: "© 2026 HEALS 基地分析工作站 · HEALS Site Analysis Studio · 僅供參考", en: "© 2026 HEALS Site Analysis Studio · For reference only" },

    "lang.toggle": { zh: "EN", en: "中" },

    // 疊圖圖層名稱(動態建立)
    "ov.LUIMAP": { zh: "國土利用調查(綠地/土地利用)", en: "Land-Use Survey (green/land use)" },
    "ov.SCHOOL": { zh: "各級學校範圍(學區)", en: "School Boundaries" },
    "ov.LANDSECT": { zh: "段籍圖(地籍)", en: "Cadastral Map" },
    "ov.PUBLICLAND": { zh: "公有土地地籍圖(公私有判讀)", en: "Public Land Cadastre (public/private)" },
    "ov.LIQUEFACTION": { zh: "土壤液化潛勢", en: "Soil Liquefaction Potential" },
    "ov.FAULT": { zh: "活動斷層分布線(2021)", en: "Active Fault Lines (2021)" },
    "ov.FAULT_ZONE": { zh: "活動斷層地質敏感區(帶狀)", en: "Active Fault Sensitive Zone" },
    "ov.warn": { zh: "⚠ 無法載入(端點待確認)", en: "⚠ Failed to load (endpoint TBD)" },

    // 人口指標標籤
    "ind.pop": { zh: "人口數", en: "Population" },
    "ind.households": { zh: "戶數", en: "Households" },
    "ind.density": { zh: "人口密度", en: "Pop. density" },
    "ind.household_size": { zh: "戶量", en: "Persons/household" },
    "ind.sex_ratio": { zh: "性比例", en: "Sex ratio" },
    "ind.aging_index": { zh: "老化指數", en: "Aging index" },
    "ind.dep_ratio": { zh: "扶養比", en: "Dependency ratio" },
    "ind.child_dep": { zh: "扶幼比", en: "Child dep. ratio" },
    "ind.old_dep": { zh: "扶老比", en: "Old-age dep. ratio" },
    "ind.area_km2": { zh: "面積", en: "Area" },
    "unit.person": { zh: "人", en: "" },
    "unit.household": { zh: "戶", en: "" },
    "unit.person_km2": { zh: "人/km²", en: "/km²" },
    "unit.person_hh": { zh: "人/戶", en: "/hh" },
    "unit.male100f": { zh: "男/百女", en: "M/100F" },

    // 人口面板訊息
    "pop.tip": { zh: "點一個點查村里、畫一塊面查鄉鎮。", en: "Click a point for village, draw an area for township." },
    "pop.loadingVil": { zh: "載入村里資料中…", en: "Loading village data…" },
    "pop.failVil": { zh: "村里資料載入失敗。", en: "Failed to load village data." },
    "pop.outVil": { zh: "此點不在任何村里範圍內。", en: "This point is outside any village." },
    "pop.townNotReady": { zh: "鄉鎮圖資尚未就緒。", en: "Township data not ready." },
    "pop.outTown": { zh: "範圍中心不在任何鄉鎮市區內。", en: "Site centroid is outside any township." },
    "pop.village": { zh: "村里", en: "Village" },
    "pop.town": { zh: "鄉鎮市區", en: "Township" },
    "pop.period": { zh: "人口資料期別(民國):", en: "Population data period: " },
    "pop.sourceMOI": { zh: " · 內政部戶政司", en: " · MOI Household Registration" },

    // 綠地分析
    "g.querySite": { zh: "查詢基地範圍內 OSM 綠地中…", en: "Querying OSM green space within site…" },
    "g.queryRadius": { zh: "查詢 OSM 綠地中…(半徑 {r}m)", en: "Querying OSM green space… (radius {r} m)" },
    "g.siteTitle": { zh: "基地範圍內綠地分析(面積 <b>{a}</b> 公頃)", en: "Green space within site (area <b>{a}</b> ha)" },
    "g.radiusTitle": { zh: "焦點周邊 <b>{r} m</b> 綠地分析", en: "Green space within <b>{r} m</b>" },
    "g.noneRadius": { zh: "周邊 {r}m 內查無 OSM 綠地圖徵(或該區 OSM 標記不全)。", en: "No OSM green features within {r} m (or sparse OSM data here)." },
    "g.hdrParkSite": { zh: "基地內公園(≥0.1ha)", en: "Parks in site (≥0.1 ha)" },
    "g.hdrPark": { zh: "公園(≥0.1ha)", en: "Parks (≥0.1 ha)" },
    "g.hdrIncidSite": { zh: "基地內零星綠地", en: "Incidental green in site" },
    "g.hdrIncid": { zh: "零星綠地(草地 · 小塊)", en: "Incidental green (grass/small)" },
    "g.hdrOverall": { zh: "整體", en: "Overall" },
    "g.nearestDist": { zh: "最近公園距離", en: "Nearest park dist." },
    "g.nearestArea": { zh: "最近公園面積", en: "Nearest park area" },
    "g.park300": { zh: "300m 內公園", en: "Parks within 300m" },
    "g.park500": { zh: "500m 內公園", en: "Parks within 500m" },
    "g.parkArea500": { zh: "公園面積(500m)", en: "Park area (500m)" },
    "g.count": { zh: "處數", en: "Count" },
    "g.area": { zh: "面積", en: "Area" },
    "g.count500": { zh: "500m 內處數", en: "Count within 500m" },
    "g.incidArea": { zh: "零星綠地面積", en: "Incidental green area" },
    "g.greenTotal": { zh: "基地內綠地總面積", en: "Total green in site" },
    "g.coverageAll": { zh: "綠覆率(全綠地)", en: "Green coverage (all)" },
    "g.coverageSite": { zh: "基地綠覆率", en: "Site green coverage" },
    "g.access330": { zh: "3-30-300 可及性", en: "3-30-300 access" },
    "g.noPark": { zh: "最近公園(≥0.1ha)", en: "Nearest park (≥0.1 ha)" },
    "g.noPark500": { zh: "500m 內無", en: "None within 500m" },
    "g.met": { zh: "✓ 達標", en: "✓ Met" },
    "g.notMet": { zh: "✗ 不足", en: "✗ Not met" },
    "g.law": { zh: "法規對照", en: "Regulatory check" },
    "g.law45": { zh: "都市計畫法§45 對照", en: "Urban Planning Act §45" },
    "g.scaleNone": { zh: "周邊 500m 內無 ≥0.1ha 公園", en: "No ≥0.1 ha park within 500m" },
    "g.scaleCommunity": { zh: "最近公園達社區公園規模(≥4ha)", en: "Nearest park ≥ community park (≥4 ha)" },
    "g.scaleNeighbor": { zh: "最近公園達閭鄰公園規模(≥0.5ha)", en: "Nearest park ≥ neighborhood park (≥0.5 ha)" },
    "g.scaleChild": { zh: "最近公園達兒童遊樂場規模(≥0.1ha)", en: "Nearest park ≥ playground (≥0.1 ha)" },
    "g.site10met": { zh: "基地綠覆率 {p}% ✓ 達 10% 參考門檻", en: "Site green coverage {p}% ✓ meets 10% reference" },
    "g.site10no": { zh: "基地綠覆率 {p}% ✗ 未達 10%(註:§45 針對計畫區整體)", en: "Site green coverage {p}% ✗ below 10% (note: §45 applies to the whole plan area)" },
    "g.noteSite": {
      zh: "資料:OpenStreetMap(即時查詢,可能不完整)。綠地面積取與基地範圍相交部分。<br>對照:都市計畫法§45(公園綠地廣場兒童遊樂場合計≥計畫面積10%);綠覆率屬 OSM 下限估計。",
      en: "Data: OpenStreetMap (live, possibly incomplete). Green area is the intersection with the site.<br>Reference: Urban Planning Act §45 (parks/green/plaza/playground ≥10% of plan area); coverage is an OSM lower-bound estimate."
    },
    "g.noteRadius": {
      zh: "資料:OpenStreetMap(即時查詢,可能不完整)。公園=OSM leisure 類且 ≥0.1ha;綠覆率含全部綠地(含零星草地,代理樹冠)。<br>準則:3-30-300(住家 300m 內應有公園/綠地)、通盤檢討辦法(兒童遊樂場≥0.1ha、閭鄰公園≥0.5ha、社區公園≥4ha);都市計畫法§45 合計≥計畫面積10%。",
      en: "Data: OpenStreetMap (live, possibly incomplete). Park = OSM leisure ≥0.1 ha; coverage includes all green (incl. grass, as canopy proxy).<br>Guides: 3-30-300 (park/green within 300m of homes); review rules (playground ≥0.1 ha, neighborhood park ≥0.5 ha, community park ≥4 ha); Urban Planning Act §45 ≥10% of plan area."
    },
    "g.timeout": { zh: "OSM 查詢逾時", en: "OSM query timed out" },
    "g.offline": { zh: "OSM 綠地服務暫時無法連線", en: "OSM green service unavailable" },
    "g.retry": { zh: ",請稍後再試。", en: ", please try again later." },
    "g.km": { zh: " 公頃", en: " ha" },
    "u.m": { zh: "m", en: "m" },
    "u.ha": { zh: "公頃", en: "ha" },
    "u.spot": { zh: "處", en: "" },
    "u.pct": { zh: "%", en: "%" },

    // 熱環境
    "h.title": { zh: "高溫脆弱度研判:<b style='color:{c}'>{lv}</b>", en: "Heat vulnerability: <b style='color:{c}'>{lv}</b>" },
    "h.coverage": { zh: "綠覆率(OSM下限)", en: "Green coverage (OSM min.)" },
    "h.target30": { zh: "對 30% 目標", en: "vs 30% target" },
    "h.elderly": { zh: "高齡比例(65+)", en: "Elderly (65+)" },
    "h.child": { zh: "幼年比例(0-14)", en: "Children (0-14)" },
    "h.lvHigh": { zh: "高", en: "High" },
    "h.lvMid": { zh: "中", en: "Medium" },
    "h.lvLow": { zh: "低", en: "Low" },
    "climate.h": { zh: "氣候背景", en: "Climate Background" },
    "climate.hint": { zh: "按「分析周邊綠地」後,這裡自動載入基地氣候背景(年均溫、雨量、盛行風向等)。", en: "After running green analysis, climate background (annual temp, rainfall, prevailing wind, etc.) loads here automatically." },
    "cl.loading": { zh: "載入氣候資料中…(Open-Meteo)", en: "Loading climate data… (Open-Meteo)" },
    "cl.timeout": { zh: "氣候資料查詢逾時。", en: "Climate query timed out." },
    "cl.offline": { zh: "氣候資料查詢失敗,請稍後再試。", en: "Climate query failed, please retry later." },
    "cl.nodata": { zh: "查無氣候資料。", en: "No climate data available." },
    "cl.title": { zh: "近 {y} 年氣候背景(ERA5)", en: "Climate over the past {y} years (ERA5)" },
    "cl.annualMean": { zh: "年均溫", en: "Annual mean temp" },
    "cl.hottest": { zh: "最熱月均溫", en: "Hottest month mean" },
    "cl.heatDays": { zh: "高溫日數(≥32°C)", en: "Hot days (≥32°C)" },
    "cl.daysYr": { zh: "天/年", en: "days/yr" },
    "cl.precip": { zh: "年降雨量", en: "Annual rainfall" },
    "cl.wind": { zh: "盛行風向(來向)", en: "Prevailing wind (from)" },
    "cl.solar": { zh: "日均日射量", en: "Daily solar radiation" },
    "cl.note": { zh: "資料:Open-Meteo ERA5 重分析,參考期 {s}–{e};為氣候背景值,非即時天氣。", en: "Data: Open-Meteo ERA5 reanalysis, reference period {s}–{e}; climate background, not live weather." },
    "cl.N": { zh: "北 ↓", en: "N ↓" },
    "cl.NE": { zh: "東北 ↙", en: "NE ↙" },
    "cl.E": { zh: "東 ←", en: "E ←" },
    "cl.SE": { zh: "東南 ↖", en: "SE ↖" },
    "cl.S": { zh: "南 ↑", en: "S ↑" },
    "cl.SW": { zh: "西南 ↗", en: "SW ↗" },
    "cl.W": { zh: "西 →", en: "W →" },
    "cl.NW": { zh: "西北 ↘", en: "NW ↘" },
    "cl.mon01": { zh: "1 月", en: "Jan" },
    "cl.mon02": { zh: "2 月", en: "Feb" },
    "cl.mon03": { zh: "3 月", en: "Mar" },
    "cl.mon04": { zh: "4 月", en: "Apr" },
    "cl.mon05": { zh: "5 月", en: "May" },
    "cl.mon06": { zh: "6 月", en: "Jun" },
    "cl.mon07": { zh: "7 月", en: "Jul" },
    "cl.mon08": { zh: "8 月", en: "Aug" },
    "cl.mon09": { zh: "9 月", en: "Sep" },
    "cl.mon10": { zh: "10 月", en: "Oct" },
    "cl.mon11": { zh: "11 月", en: "Nov" },
    "cl.mon12": { zh: "12 月", en: "Dec" },
    "h.note": {
      zh: "研判方法:綠覆率(OSM 綠地/服務圈面積,屬下限估計)對照 3-30-300 的 30% 樹冠目標,結合高齡與幼年(高溫敏感族群)比例綜合研判。<br>※ 此為依代理指標與實證關聯之<b>研判</b>,非實測健康/氣溫數據。",
      en: "Method: green coverage (OSM green / service-area, lower-bound) vs the 3-30-300 30% canopy target, combined with elderly and child shares (heat-sensitive groups).<br>Note: this is a proxy-based <b>assessment</b>, not measured health/temperature data."
    },

    // 生物多樣性
    "b.querying": { zh: "查詢 iNaturalist 物種紀錄中…(半徑 {r} km)", en: "Querying iNaturalist records… (radius {r} km)" },
    "b.none": { zh: "周邊 {r} km 內查無 iNaturalist 觀測紀錄(該區紀錄可能不足)。", en: "No iNaturalist records within {r} km (data may be sparse here)." },
    "b.title": { zh: "焦點周邊 <b>{r} km</b> 物種紀錄", en: "Species records within <b>{r} km</b>" },
    "b.species": { zh: "物種數", en: "Species" },
    "b.obs": { zh: "觀測筆數", en: "Observations" },
    "b.threat": { zh: "受脅/保育物種", en: "Threatened/protected" },
    "b.unitSp": { zh: "種", en: "" },
    "b.unitObs": { zh: "筆", en: "" },
    "b.topSpecies": { zh: "代表性物種(觀測最多)", en: "Representative species (most observed)" },
    "b.threatList": { zh: "受脅 / 保育物種", en: "Threatened / protected species" },
    "b.taxaHdr": { zh: "分類群物種數", en: "Species by taxon" },
    "b.timeout": { zh: "iNaturalist 查詢逾時", en: "iNaturalist query timed out" },
    "b.offline": { zh: "iNaturalist 服務暫時無法連線", en: "iNaturalist service unavailable" },
    "b.note": {
      zh: "資料:iNaturalist(社群觀測,可驗證紀錄)。代表性物種依觀測次數排序;受脅物種依 IUCN/各地保育名錄標註。<br>※ 觀測涵蓋度依地區與觀察者活動而異,城市公園/校園通常較完整。",
      en: "Data: iNaturalist (community, verifiable observations). Representative species ranked by observation count; threatened species per IUCN/local lists.<br>Note: coverage varies by area and observer activity; parks/campuses are usually better documented."
    },
    "tx.Plantae": { zh: "植物", en: "Plants" },
    "tx.Aves": { zh: "鳥類", en: "Birds" },
    "tx.Insecta": { zh: "昆蟲", en: "Insects" },
    "tx.Mammalia": { zh: "哺乳", en: "Mammals" },
    "tx.Amphibia": { zh: "兩棲", en: "Amphibians" },
    "tx.Reptilia": { zh: "爬蟲", en: "Reptiles" },

    // AI / 匯出 訊息
    "ai.needData": { zh: "請先放標記/畫基地並按「分析周邊綠地」,產生數據後再生成報告。", en: "Place a marker or draw a site and run green-space analysis first, then generate the report." },
    "ai.loading": { zh: "AI 解讀中…(逐步產生)", en: "AI analyzing… (streaming)" },
    "ai.fail": { zh: "AI 解讀暫時無法使用。", en: "AI analysis is temporarily unavailable." },
    "ai.msg": { zh: "訊息:", en: "Message: " },
    "ai.by": { zh: "由 Claude 依本基地真實數值生成", en: "Generated by Claude from this site's real figures" },
    "usage.note": { zh: "本次用量:輸入 {in}、輸出 {out} token(快取讀取 {cr})", en: "This call: {in} in / {out} out tokens (cache read {cr})" },
    "ai.empty": { zh: "(無內容)", en: "(no content)" },
    "exp.needData": { zh: "請先放標記/畫基地並按「分析周邊綠地」,有數據後再匯出報告。", en: "Run an analysis first, then export the report." },
    "exp.opened": { zh: "已在新分頁開啟報告,於該頁按「列印 / 存 PDF」即可儲存。", en: "Report opened in a new tab; use Print / Save PDF there." },
    "exp.blocked": { zh: "瀏覽器阻擋了新分頁,請允許彈出視窗後再按一次「匯出」。", en: "The browser blocked the new tab; allow pop-ups and click Export again." },
    // 列印報告
    "r.title": { zh: "基地分析報告", en: "Site Analysis Report" },
    "r.coord": { zh: "座標:", en: "Coordinates: " },
    "r.siteArea": { zh: " · 基地面積 ", en: " · Site area " },
    "r.generated": { zh: "產製時間:", en: "Generated: " },
    "r.mode": { zh: "分析模式:", en: "Analysis mode: " },
    "r.modeSite": { zh: "基地範圍(鄉鎮人口 · 基地內綠覆 · §45)", en: "Drawn site (township pop. · in-site green cover · §45)" },
    "r.modePoint": { zh: "點周邊(村里人口 · 半徑 500m 綠覆 · 可及性)", en: "Point surroundings (village pop. · 500 m green cover · accessibility)" },
    "r.hPop": { zh: "人口與指標", en: "Population & Indicators" },
    "r.hGreenSite": { zh: "開放空間 · 綠地(基地範圍內)", en: "Open Space · Green (within site)" },
    "r.hGreenRadius": { zh: "開放空間 · 綠地(半徑 {r} m,公園≥0.1ha)", en: "Open Space · Green (radius {r} m, park ≥0.1 ha)" },
    "r.hHeat": { zh: "熱環境 · 健康研判", en: "Heat & Health Assessment" },
    "r.hBiodiv": { zh: "生態 · 生物多樣性(半徑 {r} km)", en: "Ecology · Biodiversity (radius {r} km)" },
    "r.hComments": { zh: "使用者意見摘要", en: "User Comments Summary" },
    "r.cmCount": { zh: "範圍內意見點位", en: "Comments in scope" },
    "r.cmWith": { zh: "含意見文字", en: "With comment text" },
    "r.cmTop": { zh: "最常見關鍵詞", en: "Most common keywords" },
    "r.cmSamples": { zh: "代表性意見原句:", en: "Representative comments:" },
    "r.hAI": { zh: "AI 綜合解讀", en: "AI Synthesis" },
    "r.hSrc": { zh: "資料來源與免責", en: "Sources & Disclaimer" },
    "r.met": { zh: "達標", en: "Met" },
    "r.notMet": { zh: "不足", en: "Not met" },
    "r.notMet2": { zh: "未達", en: "Below" },
    "r.siteArea2": { zh: "基地面積", en: "Site area" },
    "r.parkInSite": { zh: "基地內公園(≥0.1ha)", en: "Parks in site (≥0.1 ha)" },
    "r.parkAreaInSite": { zh: "基地內公園面積", en: "Park area in site" },
    "r.incidInSite": { zh: "基地內零星綠地", en: "Incidental green in site" },
    "r.greenInSite": { zh: "基地內綠地總面積", en: "Total green in site" },
    "r.siteCoverage": { zh: "基地綠覆率", en: "Site green coverage" },
    "r.law45ref": { zh: "§45 10% 對照", en: "§45 10% check" },
    "r.nearestDist": { zh: "最近公園距離", en: "Nearest park dist." },
    "r.nearestArea": { zh: "最近公園面積", en: "Nearest park area" },
    "r.p300": { zh: "300m 內公園", en: "Parks within 300m" },
    "r.p500": { zh: "500m 內公園", en: "Parks within 500m" },
    "r.pArea500": { zh: "公園面積(500m)", en: "Park area (500m)" },
    "r.incid500n": { zh: "零星綠地處數(500m)", en: "Incidental green count (500m)" },
    "r.incid500a": { zh: "零星綠地面積(500m)", en: "Incidental green area (500m)" },
    "r.covAll": { zh: "綠覆率(全綠地)", en: "Green coverage (all)" },
    "r.access": { zh: "3-30-300 可及性", en: "3-30-300 access" },
    "r.covOSM": { zh: "綠覆率(OSM下限)", en: "Green coverage (OSM min.)" },
    "r.t30": { zh: "對 30% 目標", en: "vs 30% target" },
    "r.vuln": { zh: "高溫脆弱度", en: "Heat vulnerability" },
    "r.hAQI": { zh: "空氣品質(AQI)", en: "Air Quality (AQI)" },
    "r.aqiSite": { zh: "最近測站", en: "Nearest station" },
    "r.aqiVal": { zh: "AQI 指標", en: "AQI" },
    "r.aqiPm25": { zh: "PM2.5", en: "PM2.5" },
    "r.aqiPm10": { zh: "PM10", en: "PM10" },
    "r.aqiPollutant": { zh: "主要污染物", en: "Main pollutant" },
    "r.aqiTime": { zh: "發布時間", en: "Published" },
    "r.hOSSL": { zh: "開放空間服務水準", en: "Open Space Service Level" },
    "r.osslOverall": { zh: "服務水準總分", en: "Overall score" },
    "r.osslCatch": { zh: "步行涵蓋半徑", en: "Walk catchment radius" },
    "r.hHGIP": { zh: "療癒綠地介入需求", en: "Healing Green Intervention Priority" },
    "r.hgipIndex": { zh: "介入需求指數", en: "Priority index" },
    "r.hgipDominant": { zh: "主導因子", en: "Dominant factor" },
    "r.hClimate": { zh: "氣候背景", en: "Climate Background" },
    "r.clPeriod": { zh: "參考期", en: "Reference period" },
    "r.clMean": { zh: "年均溫", en: "Annual mean temp" },
    "r.clHottest": { zh: "最熱月均溫", en: "Hottest month mean" },
    "r.clHeatDays": { zh: "高溫日數(≥32°C)", en: "Hot days (≥32°C)" },
    "r.clPrecip": { zh: "年降雨量", en: "Annual rainfall" },
    "r.clWind": { zh: "盛行風向(來向)", en: "Prevailing wind (from)" },
    "r.clSolar": { zh: "日均日射量", en: "Daily solar radiation" },
    "r.species": { zh: "物種數", en: "Species" },
    "r.obs": { zh: "觀測筆數", en: "Observations" },
    "r.threat": { zh: "受脅/保育物種", en: "Threatened/protected" },
    "r.topSp": { zh: "代表性物種(觀測最多)", en: "Representative species" },
    "r.threatList": { zh: "受脅/保育物種名錄", en: "Threatened/protected list" },
    "r.taxa": { zh: "分類群(植/鳥/蟲…)", en: "Taxa (plants/birds/insects…)" },
    "r.uPerson": { zh: " 人", en: "" },
    "r.uHh": { zh: " 戶", en: "" },
    "r.uPkm2": { zh: " 人/km²", en: " /km²" },
    "r.uHa": { zh: " 公頃", en: " ha" },
    "r.uSpot": { zh: " 處", en: "" },
    "r.uSp": { zh: " 種", en: "" },
    "r.uObs": { zh: " 筆", en: "" },
    "r.aiEmpty": { zh: "(尚未產生 AI 報告)", en: "(AI report not generated yet)" },
    "r.printHint": { zh: "在列印對話框選「儲存成 PDF」;檔名已自動帶入地區與時間,可另存新檔避免覆蓋舊報告。", en: "In the print dialog, choose Save as PDF. The filename already includes the region and timestamp, so each export is a distinct file." },
    "r.src": {
      zh: "底圖:NLSC;界線:NLSC / taiwan-atlas;人口:內政部戶政司 ODRP014(11412);綠地:© OpenStreetMap 貢獻者(ODbL)/ Overpass;地名:OSM Nominatim;生物多樣性:iNaturalist;AI:Anthropic Claude。<br>免責:綠地與綠覆率為即時查詢之下限估計;熱環境/健康為研判而非實測;iNaturalist 觀測涵蓋度依地區而異。本報告僅供規劃參考,不構成正式法定文件。",
      en: "Base: NLSC; boundaries: NLSC / taiwan-atlas; population: MOI ODRP014 (2025-12); green: © OpenStreetMap contributors (ODbL) / Overpass; place: OSM Nominatim; biodiversity: iNaturalist; AI: Anthropic Claude.<br>Disclaimer: green/coverage are live lower-bound estimates; heat/health are assessments, not measurements; iNaturalist coverage varies by area. For planning reference only; not an official document."
    },

    // 工具提示 / 搜尋 / 標記
    "t.markerOn": { zh: "標記模式啟用中:點地圖放置標記,再按一次按鈕結束。", en: "Marker mode on: click the map to drop a marker; click the button again to exit." },
    "t.drawCancel": { zh: "已取消繪製。", en: "Drawing cancelled." },
    "t.drawStart": { zh: "逐點點擊描繪基地範圍,雙擊或點回起點以完成。", en: "Click to add vertices; double-click or click the start point to finish." },
    "t.drawDone": { zh: "基地範圍已完成,面積與所在鄉鎮指標顯示於左側。", en: "Site drawn; area and township indicators shown on the left." },
    "t.cleared": { zh: "已清除所有標記與範圍。", en: "All markers and shapes cleared." },
    "t.marker": { zh: "標記", en: "Marker" },
    "t.lat": { zh: "緯度", en: "Lat" },
    "t.lng": { zh: "經度", en: "Lng" },
    "area.about": { zh: "約 ", en: "≈ " },
    "area.sqm": { zh: " 平方公尺 · ", en: " m² · " },
    "area.shapes": { zh: " 個範圍", en: " shape(s)" },
    "s.needKw": { zh: "請先輸入地名。", en: "Enter a place name first." },
    "s.searching": { zh: "搜尋中…", en: "Searching…" },
    "s.notFound": { zh: "找不到「{q}」,請換個關鍵字試試。", en: "No result for “{q}”; try another keyword." },
    "s.located": { zh: "已定位:", en: "Located: " },
    "s.timeout": { zh: "搜尋逾時", en: "Search timed out" },
    "s.offline": { zh: "搜尋服務暫時無法連線", en: "Search service unavailable" },
    "s.retry2": { zh: "。可改用滑鼠拖曳地圖,或稍後再試。", en: ". Pan the map manually or try again later." },
    "data.none": { zh: "尚無圖資(資料建置中或建置失敗,請稍後重新整理)。", en: "No map data yet (building or failed; please refresh later)." },
    "sp.unnamedPark": { zh: "(未命名公園)", en: "(unnamed park)" },
    "sp.incidental": { zh: "(零星綠地)", en: "(incidental green)" },
    "ai.ghPages": {
      zh: "此頁為 GitHub Pages 靜態預覽,沒有後端,無法執行 AI 解讀。",
      en: "This is a static GitHub Pages preview with no backend; AI analysis is unavailable here."
    },
    "ai.useProd": { zh: "請改用含後端的正式版本:", en: "Use the production version with backend: " },
    "ai.ghOther": { zh: "(其他分析功能在本頁皆可正常使用)", en: "(All other analysis features work on this page.)" }
  };

  // 帶參數的字串:t("key", {r: 500})
  function fmt(s, params) {
    if (!params) return s;
    return s.replace(/\{(\w+)\}/g, function (m, k) { return params[k] != null ? params[k] : m; });
  }

  function getLang() {
    var l = localStorage.getItem("lang");
    return l === "en" ? "en" : "zh";
  }
  function setLang(l) {
    localStorage.setItem("lang", l === "en" ? "en" : "zh");
    applyI18n();
    document.documentElement.lang = l === "en" ? "en" : "zh-Hant";
    // 通知 app.js 重繪動態內容
    window.dispatchEvent(new Event("langchange"));
  }
  function t(key, params) {
    var e = DICT[key];
    if (!e) return key;
    return fmt(e[getLang()] || e.zh || key, params);
  }
  function applyI18n() {
    var nodes = document.querySelectorAll("[data-i18n]");
    nodes.forEach(function (n) {
      var key = n.getAttribute("data-i18n");
      // 標了 data-i18n-html 的元素允許富文字(如 <b>);其餘一律純文字,避免注入風險
      if (n.hasAttribute("data-i18n-html")) n.innerHTML = t(key);
      else n.textContent = t(key);
    });
    var ph = document.querySelectorAll("[data-i18n-ph]");
    ph.forEach(function (n) {
      n.setAttribute("placeholder", t(n.getAttribute("data-i18n-ph")));
    });
  }

  window.t = t;
  window.i18nLang = getLang;
  window.i18nSetLang = setLang;
  window.applyI18n = applyI18n;

  document.addEventListener("DOMContentLoaded", function () {
    document.documentElement.lang = getLang() === "en" ? "en" : "zh-Hant";
    applyI18n();
    var btn = document.getElementById("lang-toggle");
    if (btn) {
      btn.addEventListener("click", function () {
        setLang(getLang() === "en" ? "zh" : "en");
      });
    }
  });
})();
