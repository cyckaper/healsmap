#!/usr/bin/env node
/* 土地使用分區 · 靜態圖磚建置(維護用腳本,產出檔案提交進版控)
 *
 * 沒有可公開點位查詢服務、只提供 SHP 開放資料的分區圖,轉成瀏覽器可用的小檔:
 *   1. 讀 SHP / DBF(編碼依來源設定)
 *   2. 在原坐標(TWD97 TM2,公尺)以 Douglas–Peucker 簡化;再轉 WGS84(proj4)
 *   3. 依方格切成圖磚:
 *      - 一般模式:要素外框跨幾格就整個放進幾格(同一 id,前端跨格去重)
 *      - clip 模式:把多邊形裁切到每一格的矩形內(每片唯一 id,片與片不重疊),
 *        適合範圍很大的分區(例:非都市土地的森林區),避免同一個大多邊形重複存進幾十格
 *   4. 輸出 public/zoning/<key>/index.json(來源、日期、筆數、圖磚清單)與 t_<ix>_<iy>.json
 *      - GeoJSON 格式(ntpc):FeatureCollection,properties {i: id, z: 分區名稱}
 *      - compact 格式(nonurban):{v:2, s:100000, n:[分區名稱…], f:[[id, 名稱索引, 多邊形…]]},
 *        每個多邊形為環的陣列,環為「首點整數座標 + 其後差值」的扁平陣列(座標 × 100000,省略閉合點);
 *        前端 zoning-lookup.js 解碼回 GeoJSON,精度與 GeoJSON 格式相同(小數 5 位)
 *
 * 來源:
 *   ntpc      新北市都市計畫土地使用分區圖(城鄉發展局開放資料,單一 zip)
 *   nonurban  非都市土地使用分區圖(內政部國土管理署,data.gov.tw 資料集 169538,18 縣市各一個 zip;
 *             下載清單於建置時向 data.gov.tw API 取得)
 *
 * 用法:
 *   npm install                                        # devDependencies:shapefile、proj4、simplify-js、adm-zip
 *   node scripts/build-zoning.mjs ntpc                 # 自動下載
 *   node scripts/build-zoning.mjs ntpc --zip ./x.zip   # 使用已下載的單一 zip
 *   node scripts/build-zoning.mjs nonurban             # 自動下載 18 縣市
 *   node scripts/build-zoning.mjs nonurban --dir ./zips  # 使用已下載的資料夾(所有 .zip)
 * 資料更新時重新執行並提交 public/zoning/<key>/。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import * as shapefile from "shapefile";
import proj4 from "proj4";
import simplify from "simplify-js";

// .prj:TWD_1997_TM_Taiwan(中央經線 121°、尺度 0.9999、東偏 250 km)
const TWD97_TM2 = "+proj=tmerc +lat_0=0 +lon_0=121 +k=0.9999 +x_0=250000 +y_0=0 +ellps=GRS80 +units=m +no_defs";

const SOURCES = {
  ntpc: {
    county: "新北市",
    agency: "新北市政府城鄉發展局",
    layer: "都市計畫土地使用分區圖",
    url: "https://urban.planning.ntpc.gov.tw/opendataDownload/%E6%96%B0%E5%8C%97%E5%B8%82%E4%BD%BF%E7%94%A8%E5%88%86%E5%8D%80.zip",
    page: "https://data.ntpc.gov.tw/datasets/fe26e0a5-54c2-4876-bbc7-150243c048f5",
    encoding: "big5", nameField: "ZONE", crs: TWD97_TM2,
    tileDeg: 0.05, toleranceM: 1, clip: false
  },
  nonurban: {
    county: null, // 多縣市
    agency: "內政部國土管理署",
    layer: "非都市土地使用分區圖(112年)",
    datasetApi: "https://data.gov.tw/api/v2/rest/dataset/169538",
    page: "https://data.gov.tw/dataset/169538",
    encoding: "utf-8", nameField: "使用分", countyField: "縣市", crs: TWD97_TM2,
    tileDeg: 0.05, toleranceM: 2, clip: true, format: "compact"
  }
};
const PRECISION = 5; // 輸出小數 5 位 ≈ 1.1 m

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };

function simplifyRing(ring, tol) {
  let pts = simplify(ring.map(([x, y]) => ({ x, y })), tol, true).map((p) => [p.x, p.y]);
  if (pts.length < 4) pts = ring.map((p) => p.slice()); // 小於容差的細長圖形:保留原始環,不丟官方資料
  if (pts.length < 4) return null;
  const a = pts[0], b = pts[pts.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) pts.push(a.slice());
  return pts;
}

// Sutherland–Hodgman:把環裁切到軸向矩形 [x0,y0,x1,y1]。凹多邊形可能在裁切邊上留下零寬連接,
// 不影響面積與點在面內的判斷。回傳封閉環或 null。
function clipRing(ring, [x0, y0, x1, y1]) {
  const edges = [
    (p) => p[0] >= x0, (p) => p[0] <= x1, (p) => p[1] >= y0, (p) => p[1] <= y1
  ];
  const cut = [
    (a, b) => [x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / (b[0] - a[0])],
    (a, b) => [x1, a[1] + (b[1] - a[1]) * (x1 - a[0]) / (b[0] - a[0])],
    (a, b) => [a[0] + (b[0] - a[0]) * (y0 - a[1]) / (b[1] - a[1]), y0],
    (a, b) => [a[0] + (b[0] - a[0]) * (y1 - a[1]) / (b[1] - a[1]), y1]
  ];
  let pts = ring.slice(0, -1); // 去掉重複的終點
  for (let e = 0; e < 4 && pts.length; e++) {
    const inside = edges[e], out = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i], prev = pts[(i + pts.length - 1) % pts.length];
      const ci = inside(cur), pi = inside(prev);
      if (ci) { if (!pi) out.push(cut[e](prev, cur)); out.push(cur); }
      else if (pi) out.push(cut[e](prev, cur));
    }
    pts = out;
  }
  if (pts.length < 3) return null;
  pts.push(pts[0].slice());
  return pts;
}
function ringArea(r) { let a = 0; for (let i = 1; i < r.length; i++) a += r[i - 1][0] * r[i][1] - r[i][0] * r[i - 1][1]; return Math.abs(a / 2); }
const roundRing = (r) => r.map((p) => [+p[0].toFixed(PRECISION), +p[1].toFixed(PRECISION)]);
// compact:整數差值編碼(座標已四捨五入至小數 5 位,× 1e5 後為整數,可無損還原)
function encodeTile(feats) {
  const names = [], idx = new Map();
  const nameIdx = (z) => { if (!idx.has(z)) { idx.set(z, names.length); names.push(z); } return idx.get(z); };
  const encRing = (ring) => {
    const out = []; let px = 0, py = 0;
    for (let i = 0; i < ring.length - 1; i++) { // 省略閉合點
      const x = Math.round(ring[i][0] * 1e5), y = Math.round(ring[i][1] * 1e5);
      out.push(x - px, y - py); px = x; py = y;
    }
    return out;
  };
  const f = feats.map((ft) => {
    const polys = ft.geometry.type === "Polygon" ? [ft.geometry.coordinates] : ft.geometry.coordinates;
    return [ft.properties.i, nameIdx(ft.properties.z)].concat(polys.map((p) => p.map(encRing)));
  });
  return { v: 2, s: 1e5, n: names, f };
}
function bboxOfPolys(polys) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const poly of polys) for (const p of poly[0]) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
  }
  return [x0, y0, x1, y1];
}

async function download(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("下載失敗 HTTP " + r.status + " " + url);
  return Buffer.from(await r.arrayBuffer());
}
async function zipInputs(src) {
  const dir = arg("--dir"), zip = arg("--zip");
  if (zip) return [{ name: path.basename(zip), buf: fs.readFileSync(zip) }];
  if (dir) return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".zip")).sort()
    .map((f) => ({ name: f, buf: fs.readFileSync(path.join(dir, f)) }));
  if (src.url) { console.log("下載", src.url); return [{ name: "source.zip", buf: await download(src.url) }]; }
  const meta = await (await fetch(src.datasetApi)).json();
  const dist = (meta.result && meta.result.distribution) || [];
  const out = [];
  for (const d of dist) {
    console.log("下載", d.resourceDescription);
    out.push({ name: d.resourceDescription, buf: await download(d.resourceDownloadUrl) });
  }
  return out;
}

async function main() {
  const key = process.argv[2];
  const src = SOURCES[key];
  if (!src) { console.error("用法:node scripts/build-zoning.mjs <" + Object.keys(SOURCES).join("|") + "> [--zip 檔案 | --dir 資料夾]"); process.exit(1); }
  const inputs = await zipInputs(src);
  const downloaded = new Date().toISOString().slice(0, 10);
  const toWgs = proj4(src.crs, "WGS84");
  const T = src.tileDeg;

  const tiles = new Map();
  const put = (k, feat) => { if (!tiles.has(k)) tiles.set(k, []); tiles.get(k).push(feat); };
  const counties = new Set();
  let id = 0, read = 0, dropped = 0;
  const t0 = Date.now();

  for (const input of inputs) {
    const entries = new AdmZip(input.buf).getEntries(); // zip 內檔名常為 Big5,只依副檔名取用
    const pick = (ext) => {
      const e = entries.find((x) => x.entryName.toLowerCase().endsWith(ext));
      if (!e) throw new Error(input.name + ":zip 內找不到 " + ext);
      return e.getData();
    };
    const source = await shapefile.open(pick(".shp"), pick(".dbf"), { encoding: src.encoding });
    for (let r = await source.read(); !r.done; r = await source.read()) {
      read++;
      const f = r.value, props = f.properties || {};
      const z = String(props[src.nameField] || "").trim();
      const g = f.geometry;
      if (!z || !g) { dropped++; continue; }
      if (src.countyField && props[src.countyField]) counties.add(String(props[src.countyField]).trim());
      const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
      const outPolys = []; // WGS84、未四捨五入
      for (const poly of polys) {
        const rings = [];
        for (let ri = 0; ri < poly.length; ri++) {
          const s = simplifyRing(poly[ri], src.toleranceM);
          if (!s) { if (ri === 0) break; continue; } // 外環退化則整個多邊形捨棄
          rings.push(s.map((p) => toWgs.forward(p)));
        }
        if (rings.length) outPolys.push(rings);
      }
      if (!outPolys.length) { dropped++; continue; }
      const [x0, y0, x1, y1] = bboxOfPolys(outPolys);
      const ix0 = Math.floor(x0 / T), ix1 = Math.floor(x1 / T), iy0 = Math.floor(y0 / T), iy1 = Math.floor(y1 / T);
      const asGeom = (ps) => ps.length === 1 ? { type: "Polygon", coordinates: ps[0] } : { type: "MultiPolygon", coordinates: ps };

      if (!src.clip || (ix0 === ix1 && iy0 === iy1)) {
        const feat = { type: "Feature", properties: { i: ++id, z }, geometry: asGeom(outPolys.map((p) => p.map(roundRing))) };
        for (let ix = ix0; ix <= ix1; ix++) for (let iy = iy0; iy <= iy1; iy++) put(ix + "_" + iy, feat);
        continue;
      }
      // clip 模式:逐格裁切
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let iy = iy0; iy <= iy1; iy++) {
          const rect = [ix * T, iy * T, (ix + 1) * T, (iy + 1) * T];
          const pieces = [];
          for (const poly of outPolys) {
            const outer = clipRing(poly[0], rect);
            if (!outer || ringArea(outer) < 1e-12) continue; // 約 < 0.01 m²
            const holes = poly.slice(1).map((h) => clipRing(h, rect)).filter((h) => h && ringArea(h) >= 1e-12);
            pieces.push([outer].concat(holes).map(roundRing));
          }
          if (pieces.length) put(ix + "_" + iy, { type: "Feature", properties: { i: ++id, z }, geometry: asGeom(pieces) });
        }
      }
    }
    console.log(`  ${input.name}:累計讀入 ${read} 筆`);
  }

  const dir = path.join(repo, "public", "zoning", key);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  let bytes = 0, maxBytes = 0;
  for (const [k, feats] of tiles) {
    const s = JSON.stringify(src.format === "compact" ? encodeTile(feats) : { type: "FeatureCollection", features: feats });
    fs.writeFileSync(path.join(dir, "t_" + k + ".json"), s);
    bytes += s.length; maxBytes = Math.max(maxBytes, s.length);
  }
  const index = {
    county: src.county, counties: counties.size ? Array.from(counties).sort() : undefined,
    agency: src.agency, layer: src.layer,
    source_url: src.url || src.datasetApi, source_page: src.page, downloaded,
    records: read - dropped, pieces: id, tile_deg: T, clipped: !!src.clip, simplify_tolerance_m: src.toleranceM,
    format: src.format === "compact" ? "compact-v2" : "geojson",
    tiles: Array.from(tiles.keys()).sort()
  };
  fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(index, null, 1) + "\n");
  console.log(`完成:讀入 ${read} 筆(捨棄 ${dropped})、輸出 ${id} 片、${tiles.size} 個圖磚、共 ${(bytes / 1048576).toFixed(1)} MB、` +
    `最大圖磚 ${(maxBytes / 1048576).toFixed(2)} MB、耗時 ${((Date.now() - t0) / 1000).toFixed(0)} 秒 → ${path.relative(repo, dir)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
