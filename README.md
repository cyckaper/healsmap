# HEALS 基地分析工作站 · HEALS Site Analysis Studio

以**真實台灣政府開放圖資**為基礎的基地（site）分析網頁工具:在地圖上放標記或畫出基地範圍,即可一次取得**人口結構、開放空間/綠地可及性、熱環境與健康研判、法規對照**,並由 **Claude AI** 產出可讀的綜合報告、匯出 PDF。

> ⚠️ 本工具分析僅供規劃參考,不構成正式法定文件或專業意見。詳見「方法與限制」。

---

## 線上版本

| 網址 | 後端 | AI 解讀 | 用途 |
|---|---|---|---|
| **https://map.healsdesign.org**(Netlify) | ✅ Netlify Functions | ✅ 可用 | **主要版本** |
| https://la-maps.pages.dev | ✅ Cloudflare Pages | ✅ 可用 | 備援 |
| https://cyckaper.github.io/LA-Maps/ | ❌ 純靜態 | ❌ 不可 | 前端預覽 |

功能相同,差別僅在 AI 解讀需要後端(金鑰)。

---

## 功能總覽

### 底圖與疊圖
- **底圖**(NLSC WMTS):臺灣通用電子地圖 (EMAP)、正射影像+路名套疊 (PHOTO_MIX)、正射影像 (PHOTO2)
- **疊圖圖層(官方圖資,可多選 + 共用透明度)**
  - 國土利用調查(綠地/土地利用)— NLSC,綠地實況視覺參考
  - 各級學校範圍(學區)— NLSC
  - 段籍圖(地籍)— NLSC
  - 土壤液化潛勢 — 經濟部地質調查及礦業管理中心 WMS
  - 活動斷層分布線(2021) — 地質調查所 WMS
  - 活動斷層地質敏感區(帶狀) — 地質調查所 WMS

### 工具
- 地名搜尋(OpenStreetMap Nominatim)
- 點選放標記 / 繪製基地範圍(多邊形)/ 清除
- 基地面積量測(公頃,turf.js)

### 人口與指標
點一個點查**村里**、畫一塊面查**鄉鎮市區**,顯示真實戶政指標:
人口數、戶數、人口密度、性別比、老化指數、扶養比、扶幼比、扶老比、高齡比例(65+)、幼年比例(0-14)等。

### 開放空間 · 綠地(OpenStreetMap 即時查詢)
以焦點周邊 500m 服務圈分析,並分兩類:
- **公園(≥0.1ha)**:最近公園距離/面積、300m & 500m 內公園數、公園面積
- **零星綠地(草地·小塊)**:處數、面積
- **整體**:綠覆率(全綠地)、3-30-300 可及性
- **法規對照**:都市計畫法 §45(公園綠地廣場兒童遊樂場 ≥ 計畫面積 10%)、通盤檢討辦法(兒童遊樂場 ≥0.1ha、閭鄰公園 ≥0.5ha、社區公園 ≥4ha)、3-30-300 準則

### NDVI 植群分析(Sentinel-2 衛星影像)
按「分析 NDVI 植群」(或「分析周邊綠地」時自動一併執行),以 Copernicus **Sentinel-2 L2A**(10 m)計算 **NDVI =(近紅外 B08 − 紅光 B04)÷(B08 + B04)**;其高植生比例並作為熱環境與療癒綠地指數的樹冠代理(見下節):
- **選景**:向 Element 84 Earth Search(STAC)查近一年場景雲量 < 60% 的影像,依日期由新到舊讀基地處的 **SCL 場景分類**,遮除雲 / 雲影 / 缺值,採第一景「基地晴空 ≥ 90%」者(都不足時取最佳且 ≥ 50%)
- **讀取**:瀏覽器以 HTTP Range 只讀基地所在的 COG 圖塊(AWS Open Data `sentinel-cogs`,免金鑰、支援 CORS),每次約 3–8 MB
- **範圍**:點模式 = 標記周邊 500 m(同綠地分析);面模式 = 基地範圍內
- **指標**:平均 / 中位數 NDVI、植被覆蓋率(NDVI ≥ 0.2)、高植生比例(NDVI ≥ 0.6,樹冠粗略代理,對照 3-30-300 的 30%)、五級分級面積比例、晴空像元比例
- **地圖**:10 m 像元分布圖(重投影至 Web Mercator),點圖可查單一像元值;報告匯出附分布圖
- 反射率換算:`sentinel-cogs` 的像元值已扣除 ESA 的 +1000 偏移(STAC `earthsearch:boa_offset_applied: true`),**不可**再套 STAC `raster:bands` 的 offset −0.1;另以 SCL 植生像元紅光中位數做經驗檢核

### 在地評價 · 評論分析(Google 地圖評論)
- **抓取 Google 評論**:前端呼叫後端 `/api/reviews`(`netlify/functions/reviews.mjs`),以 Google 官方 **Places API (New)** 取得評論,金鑰存於 Netlify 環境變數 `GOOGLE_MAPS_API_KEY`
  - 地點名稱空白:Nearby Search,以基地為圓心(點模式 500 m;面模式為範圍中心到最遠頂點的距離,上限 5 km)搜尋公園、步道、廣場、遊戲場、景點、運動場館等戶外 / 公共場所,依熱門度取最多 **20 個地點**
  - 填了名稱:Text Search,以基地為中心偏好搜尋該名稱,取最多 5 個地點
  - **每個地點最多 5 則評論**(Google 依相關度挑選),API 無法取得全部評論
  - 只接受本站網域(`*.healsdesign.org`、`*--healsmap.netlify.app`)的請求;回應不快取
- 也可**貼上 / 上傳**其他評論:Google 地圖評論列表整段貼上會自動略去作者名稱、在地嚮導資訊、相對時間、按鈕字樣與業主回應;亦支援 PTT / 問卷文字與 CSV / Excel / TXT
- 本地統計:則數、星等分布、19 個**景觀 · 健康面向**被提及則數、關鍵詞
- **AI 分析:環境如何影響使用者**(`/api/analyze` 的 `reviews_analysis` 模式):Claude 找出提到環境要素(綠蔭、炎熱、水景、聲音、氣味、清潔、設施、步道、照明、人潮、蚊蟲、景觀…)且描述其對使用者影響(舒適、情緒與壓力恢復、安全感、活動行為、社交、可及性)的評論,整理成「環境要素 → 影響 → 代表評論 → 設計意涵」表格
- 抓回的評論附作者署名與「Google Maps」標示,只在本次頁面顯示,不畫在地圖上,原文也不寫入歷史紀錄或匯出檔(只保存統計與 AI 分析)

**啟用步驟**(Google Cloud Console):
1. 建立專案並綁定帳單帳戶,啟用 **Places API (New)**
2. 建立 API 金鑰,在「API 限制」只勾 Places API (New)(後端金鑰,不需設 HTTP 參照網址限制)
3. 建議在 Places API 的「配額」設每日上限(例如 200 次 / 日),並在帳單設預算警示
4. Netlify → Site configuration → Environment variables:新增 `GOOGLE_MAPS_API_KEY` → 重新部署

> ⚠️ Google Maps Platform 條款對 Places 內容與非 Google 地圖並用(§3.2.3(e))、複製保存評論(§3.2.3(a)(iii))、以 Google Maps 內容產生新內容(§3.2.3(c),AI 分析即屬之)設有限制;本站已盡量降低(不標示於地圖、不保存原文、附署名),但 AI 分析部分仍與條款有出入,金鑰可能遭 Google 停用,使用前請自行評估。

### 熱環境 · 健康研判
樹冠代理(對 3-30-300 的 30% 樹冠目標)× 脆弱族群(高齡 + 幼年比例)→ 綜合**高溫脆弱度**(低/中/高)。屬研判,非實測。
- **樹冠代理**:有 NDVI 結果時採 Sentinel-2 **NDVI ≥ 0.6 高植生比例**;NDVI 無法取得(雲遮、連線)時退回 OSM 綠覆率(下限估計)。「療癒綠地介入需求」的綠地匱乏因子同此。
- 不採 NDVI ≥ 0.2 的植被覆蓋率:它含草地與稀疏植生,一般街廓多已超過 30%(如臺大校園周邊 500 m 為 80.6%),綠地缺口會失去鑑別力;高植生比例(臺大 28.4%、西門町 0.5%)較接近 30% 樹冠目標的本意。
- 熱環境資料中的 `green_input` 標示實際採用的來源(`ndvi_dense_veg_pct` / `osm_green_coverage_pct`)。

### AI 解讀
將上述真實數值送至後端 `/api/analyze`,由 Claude 產生五段式繁中報告(基地概述 / 開放空間綠地 / 熱環境健康 / 規劃建議 / 資料與限制),嚴格限定只用提供的數值並引用法規。

### 報告匯出
「匯出 / 列印報告」另開乾淨獨立頁面,可列印或**儲存成 PDF**(含人口/綠地/熱環境/AI 報告/資料來源)。

---

## 架構

三段式:**GitHub(原始碼)→ Netlify(部署網站 + 後端代理,保管 API 金鑰)→ Anthropic(Claude)**。

```
┌─ GitHub (cyckaper/la-maps) ────────────────── 原始碼 + 版本控制
│        │  push 觸發自動部署
│        ▼
├─ Netlify ─────────────────────────────────── 部署 · 託管 · 後端
│   ├─ public/                  靜態網站(HTML/CSS/JS、Leaflet 地圖)
│   └─ netlify/functions/analyze.mjs   後端 Function(/api/analyze)
│        持環境變數 ANTHROPIC_API_KEY,代理呼叫 ↓
│        ▼
└─ Anthropic API (claude-haiku-4-5) ──────────── AI 報告 / 意見摘要
```

前端另直接呼叫多個**免金鑰公開 API**(不經後端):

```
瀏覽器 (public/) 直接取用:
  ├─ NLSC WMTS 圖磚 / 地質調查所 WMS      底圖與疊圖
  ├─ public/data/*.json                  界線 + 人口(建置時產生)
  ├─ OSM Overpass                        綠地、開放空間服務水準
  ├─ OSM Nominatim                       地名搜尋
  ├─ Open-Meteo (ERA5)                   氣候背景
  ├─ iNaturalist                         生態 · 生物多樣性
  ├─ Element 84 Earth Search (STAC)      Sentinel-2 選景(NDVI)
  ├─ AWS Open Data sentinel-cogs (S3)    Sentinel-2 COG 圖塊(HTTP Range 讀取)
  └─ unpkg CDN (SheetJS, geotiff.js)     .xlsx 解析、COG 解碼(首次使用時才載入)
```

- **前端**:純靜態(`public/`),無框架,vanilla JS。
- **資料**:`public/data/{towns,villages,meta}.json` 由 `scripts/build-data.mjs` 於**建置時**抓取界線 + 戶政人口產生(不進版控)。
- **後端**:`netlify/functions/analyze.mjs`(Netlify Function),持金鑰呼叫 Claude;**金鑰存於 Netlify 環境變數,前端永不外露**。AI 呼叫用串流(`stream:true`)避免 Netlify 閒置逾時(504)。
- **使用者上傳的 Excel 意見**:僅存在瀏覽器;唯有按「AI 摘要意見主題」才會把範圍內意見經後端送 Anthropic。

> 註:repo 內 `functions/api/`(Cloudflare 格式)為**未使用的備援**;實際部署只跑 `netlify/functions/`(見 `netlify.toml`)。

---

## 成本

各節點是否收費、以及「在哪看帳單」:

| 節點 | 收費? | 計費方式 | 哪裡看用量/帳單 |
|---|---|---|---|
| **GitHub**(公開 repo) | 免費 | — | github.com → Settings → Billing |
| **Netlify**(託管 + Functions) | 免費額度內 | 免費方案:每月 100 GB 流量、Functions 12.5 萬次呼叫/125 萬次·秒執行;超量才付費 | Netlify → Team → **Usage** / **Billing** |
| **Anthropic API**(Claude) | **是,按用量** | 依 **token** 計費(輸入 + 輸出),`claude-haiku-4-5`:約 **US$1 / 百萬輸入 token**、**US$5 / 百萬輸出 token** | console.anthropic.com → **Usage** / **Billing**(可設用量上限與額度警示) |
| NLSC / 地質所 / Overpass / Nominatim / Open-Meteo / iNaturalist | 免費 | 公開政府/開源服務,免金鑰 | — |
| **Google Places API (New)**(抓取評論) | **是,按用量** | 含評論欄位的 Nearby / Text Search 屬 Enterprise + Atmosphere 等級,每月前 1,000 次免費,之後約 US$40 / 千次(以官方價目為準) | Google Cloud Console → **Billing** / **APIs & Services → Places API (New) → 配額** |
| Element 84 Earth Search / AWS Open Data(Sentinel-2) | 免費 | 公開 STAC 目錄與 S3 公開資料集,免金鑰(流量由 AWS Open Data 計畫負擔) | — |
| unpkg(SheetJS CDN) | 免費 | 公共 CDN | — |

**唯一會持續產生費用的是 Anthropic API**,其餘在正常使用量下都在免費額度內。

### Anthropic 每次大約多少錢?

以本工具的用法估算(`claude-haiku-4-5`,2026/06 牌價;**實際以官方為準**):

| 操作 | 輸入 token(約) | 輸出 token(約) | 每次約略成本 |
|---|---|---|---|
| **產生 AI 基地分析報告** | ~2,000(系統提示+數據,且系統提示有 **prompt caching** 折扣) | ~1,500(七節報告) | **約 US$0.02–0.03(約 NT$0.7–1)** |
| **AI 摘要意見主題** | 視意見則數,~1,000–6,000 | ~600 | **約 US$0.01–0.03(約 NT$0.3–1)** |
| **AI 分析評論主題與情緒** | 視評論則數,~1,000–25,000(上限約 3 萬字) | ~700 | **約 US$0.01–0.03(約 NT$0.3–1)** |

- 粗估:**每次 AI 動作約新台幣 1 元上下**;1 美元大約可跑 30–50 次報告。
- **省錢設計**:系統提示已開 **prompt caching**(重複部分打折);意見摘要上限 200 則;只有「按按鈕」才呼叫 AI,瀏覽看地圖/疊圖/詞頻統計**完全不花錢**。

### 在哪裡看每次收費

- **Anthropic**:<https://console.anthropic.com> → **Usage**(逐日 token 與費用)、**Billing**(帳單、儲值、**Limits** 可設每月上限與 email 警示)。建議設一個**月度上限**避免意外。
- **Netlify**:<https://app.netlify.com> → 你的 Team → **Usage**(流量、Function 呼叫數)、**Billing**。
- **GitHub**:公開 repo 免費,無需查帳。

> ⚠️ Anthropic Console 的 Usage 是**逐日彙總**,非逐次明細。本工具已另做**逐次追蹤**:每次 AI 呼叫後,後端會記錄該次 token 與估算成本(見下),前端也會在 AI 結果下方顯示「本次用量」。
>
> **逐次 token 追蹤**:`netlify/functions/analyze.mjs` 從 Anthropic 串流擷取 `usage`(輸入/輸出/快取 token),`console.log` 成 `[analyze usage] {...}`(可在 **Netlify → Functions → analyze → Logs** 查每一次),並把該筆 meta 附在回應尾端;前端解析後在 AI 報告/意見摘要下方顯示「本次用量:輸入 X、輸出 Y token · 約 US$… (≈NT$…)」。

---

## 專案結構

```
.
├── public/                       # 靜態網站(部署輸出目錄)
│   ├── index.html
│   ├── css/style.css
│   ├── js/
│   │   ├── app.js                # 主程式(地圖、分析、AI、匯出)
│   │   ├── i18n.js               # 中英雙語字典
│   │   ├── openspace-service-level.js  # 開放空間服務水準模組
│   │   ├── ndvi-analysis.js      # NDVI 植群分析(Sentinel-2 選景、COG 讀取、NDVI、疊圖)
│   │   ├── review-analysis.js    # 在地評價 · 評論文字解析與統計
│   │   └── comments-layer.js     # 使用者意見圖層(xlsx/csv 上傳)
│   └── data/                     # 建置時產生(gitignored)
│       ├── towns.json            # 鄉鎮市區界線 + 人口指標
│       ├── villages.json         # 村里界線 + 人口指標
│       └── meta.json             # 資料來源、統計期、對應率
├── netlify/functions/analyze.mjs # ★ 實際部署的後端:/api/analyze
├── netlify/functions/reviews.mjs # /api/reviews:Places API (New) 抓取 Google 評論
├── functions/api/analyze.js      # (未使用,Cloudflare 格式備援)
├── scripts/build-data.mjs        # 界線 + 人口資料建置腳本
├── netlify.toml                  # Netlify 部署設定
└── package.json
```

---

## 在地開發 / 建置

需 Node 20+。

```bash
npm install
npm run build:data        # 產生 public/data/*.json(需網路)
# 以任意靜態伺服器開啟 public/,例如:
npx serve public          # 或 python3 -m http.server -d public
```

> 在地開啟時 AI 解讀無法使用(無後端);其餘功能正常。

---

## 部署

### Netlify(主要,含 AI,掛自有網域 map.healsdesign.org)
1. Add new site → Import an existing project → 選本 repo(`netlify.toml` 已含 build 設定)
2. Site configuration → Environment variables:`ANTHROPIC_API_KEY` = Anthropic API 金鑰;`GOOGLE_MAPS_API_KEY` = Google Maps Platform 金鑰(抓取 Google 評論用,選填)→ 重新部署
3. 後端 `netlify/functions/analyze.mjs` 以 Functions 2.0 的 `config.path` 直接掛在 `/api/analyze`
4. Domain management → Add a domain → `map.healsdesign.org`(DNS 已在 Netlify,SSL 自動)

### Cloudflare Pages(備援,含 AI)
1. Workers & Pages → Create → Pages → Connect to Git → 選本 repo
2. Build 設定:
   - **Build command**:`npm install && node scripts/build-data.mjs`
   - **Build output directory**:`public`
   - Production branch:`main`
3. Settings → Variables and Secrets:
   - `ANTHROPIC_API_KEY`(Secret)= Anthropic API 金鑰
4. `functions/` 會被自動辨識為 `/api/*`。

### GitHub Pages(前端預覽,無 AI)
`.github/workflows/pages.yml` 於推送 `main` 時自動:`npm install` → `node scripts/build-data.mjs` → 發佈 `public/`。

---

## 資料來源與授權

| 項目 | 來源 |
|---|---|
| 底圖圖磚 / 疊圖(電子地圖、影像、國土利用、學區、地籍) | 內政部國土測繪中心 (NLSC) WMTS |
| 行政界線(村里、鄉鎮市區) | NLSC / [taiwan-atlas](https://github.com/dkaoster/taiwan-atlas)(TopoJSON, MIT) |
| 人口統計 | 內政部戶政司 rs-opendata(ODRP 系列) |
| 綠地圖徵 | © OpenStreetMap 貢獻者(ODbL),經 Overpass API |
| NDVI | 含經修改之 Copernicus Sentinel 資料(Sentinel-2 L2A,ESA;免費開放授權),經 AWS Open Data `sentinel-cogs` 與 Element 84 Earth Search |
| 地名搜尋 | OpenStreetMap Nominatim |
| 土壤液化 / 活動斷層 | 經濟部地質調查及礦業管理中心 WMS |
| AI 解讀 | Anthropic Claude |

---

## 技術棧
Leaflet 1.9 · Leaflet.draw · turf.js 6.5 · marked 12 · Cloudflare Pages Functions · Anthropic API · Node(建置:topojson-client)

---

## 方法與限制
- **綠地與綠覆率**:來自 OpenStreetMap 即時查詢,屬**下限估計**,可能不完整;官方綠地實況請對照「國土利用調查」疊圖。
- **NDVI**:單一日期衛星影像,受季節、物候、日照與雲影響;10 m 像元會混合地物;NDVI 反映植生量與活力,不等同樹冠覆蓋率;分級門檻(0 / 0.2 / 0.4 / 0.6)為慣用概略值。
- **在地評價**:評論為使用者自行提供之自發性樣本,不代表全體使用者;面向統計為關鍵詞比對,只表示被提及、不分正負評。
- **熱環境 / 健康**:依代理指標(綠覆率、脆弱族群)與實證關聯之**研判**,非實測氣溫或健康數據。
- **法規對照**:§45 的 10% 是針對「都市計畫區」整體而非單一基地,工具以準則對照呈現,非合法性認定。
- **AI 報告**:僅依提供之數值生成,缺漏會標示「資料不足」。
- **適用範圍**:本工具僅供規劃參考,不構成正式法定文件或專業意見。

## 待辦
- **淹水潛勢**圖層:資料於 NCDR(需申請帳號),取得開放端點後可比照地質 WMS 接入。
