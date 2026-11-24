#!/usr/bin/env node
/* 都市計畫使用分區 · 靜態圖磚建置(維護用腳本,產出檔案提交進版控)
 *
 * 部分縣市沒有可公開點位查詢的服務,只提供整份 SHP 開放資料下載(例:新北市約 79 MB)。
 * 本腳本把官方 SHP 轉成瀏覽器可用的小檔:
 *   1. 讀 SHP / DBF(DBF 為 Big5)
 *   2. 在原坐標(TWD97 TM2,公尺)以 Douglas–Peucker 簡化,容差 1 m;再轉 WGS84(proj4)
 *   3. 依 0.05° 方格切成圖磚(要素外框跨幾格就放幾格,並給唯一 id 供跨格去重)
 *   4. 輸出 public/zoning/<key>/index.json(來源、日期、筆數、圖磚清單)與 t_<ix>_<iy>.json
 *
 * 用法:
 *   npm install            # 取得 devDependencies:shapefile、proj4、simplify-js、adm-zip
 *   node scripts/build-zoning.mjs ntpc                       # 自動下載官方 zip
 *   node scripts/build-zoning.mjs ntpc --zip ./新北市使用分區.zip  # 使用已下載的檔案
 * 資料更新時重新執行並提交 public/zoning/<key>/。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import * as shapefile from "shapefile";
import proj4 from "proj4";
import simplify from "simplify-js";

const SOURCES = {
  ntpc: {
    county: "新北市",
    agency: "新北市政府城鄉發展局",
    layer: "都市計畫土地使用分區圖",
    url: "https://urban.planning.ntpc.gov.tw/opendataDownload/%E6%96%B0%E5%8C%97%E5%B8%82%E4%BD%BF%E7%94%A8%E5%88%86%E5%8D%80.zip",
    page: "https://data.ntpc.gov.tw/datasets/fe26e0a5-54c2-4876-bbc7-150243c048f5",
    encoding: "big5",
    nameField: "ZONE",
    // .prj:TWD_1997_TM_Taiwan(中央經線 121°、尺度 0.9999、東偏 250 km)
    crs: "+proj=tmerc +lat_0=0 +lon_0=121 +k=0.9999 +x_0=250000 +y_0=0 +ellps=GRS80 +units=m +no_defs"
  }
};
const TILE_DEG = 0.05;
const TOLERANCE_M = 1;   // 簡化容差(公尺)
const PRECISION = 5;     // 輸出小數 5 位 ≈ 1.1 m

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };

function simplifyRing(ring) {
  let pts = simplify(ring.map(([x, y]) => ({ x, y })), TOLERANCE_M, true).map((p) => [p.x, p.y]);
  if (pts.length < 4) pts = ring.map((p) => p.slice()); // 小於容差的細長圖形:保留原始環,不丟官方資料
  if (pts.length < 4) return null;
  const a = pts[0], b = pts[pts.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) pts.push(a.slice());
  return pts;
}

async function main() {
  const key = process.argv[2];
  const src = SOURCES[key];
  if (!src) { console.error("用法:node scripts/build-zoning.mjs <" + Object.keys(SOURCES).join("|") + "> [--zip 檔案]"); process.exit(1); }

  let zipBuf;
  const zipPath = arg("--zip");
  if (zipPath) zipBuf = fs.readFileSync(zipPath);
  else {
    console.log("下載", src.url);
    const r = await fetch(src.url);
    if (!r.ok) throw new Error("下載失敗 HTTP " + r.status);
    zipBuf = Buffer.from(await r.arrayBuffer());
  }
  const downloaded = new Date().toISOString().slice(0, 10);

  // zip 內檔名多為 Big5,只依副檔名取用
  const entries = new AdmZip(zipBuf).getEntries();
  const pick = (ext) => {
    const e = entries.find((x) => x.entryName.toLowerCase().endsWith(ext));
    if (!e) throw new Error("zip 內找不到 " + ext);
    return e.getData();
  };
  const shp = pick(".shp"), dbf = pick(".dbf");
  const toWgs = proj4(src.crs, "WGS84");

  const tiles = new Map();
  let id = 0, read = 0, dropped = 0;
  const t0 = Date.now();
  const source = await shapefile.open(shp, dbf, { encoding: src.encoding });
  for (let r = await source.read(); !r.done; r = await source.read()) {
    read++;
    const f = r.value;
    const z = String((f.properties || {})[src.nameField] || "").trim();
    const g = f.geometry;
    if (!z || !g) { dropped++; continue; }
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const outPolys = [];
    for (const poly of polys) {
      const rings = [];
      for (let ri = 0; ri < poly.length; ri++) {
        const s = simplifyRing(poly[ri]);
        if (!s) { if (ri === 0) break; continue; } // 外環退化則整個多邊形捨棄
        rings.push(s.map((p) => {
          const [lng, lat] = toWgs.forward(p);
          if (lng < x0) x0 = lng; if (lng > x1) x1 = lng;
          if (lat < y0) y0 = lat; if (lat > y1) y1 = lat;
          return [+lng.toFixed(PRECISION), +lat.toFixed(PRECISION)];
        }));
      }
      if (rings.length) outPolys.push(rings);
    }
    if (!outPolys.length) { dropped++; continue; }
    const geometry = outPolys.length === 1 ? { type: "Polygon", coordinates: outPolys[0] } : { type: "MultiPolygon", coordinates: outPolys };
    const feat = { type: "Feature", properties: { i: ++id, z }, geometry };
    for (let ix = Math.floor(x0 / TILE_DEG); ix <= Math.floor(x1 / TILE_DEG); ix++) {
      for (let iy = Math.floor(y0 / TILE_DEG); iy <= Math.floor(y1 / TILE_DEG); iy++) {
        const k = ix + "_" + iy;
        if (!tiles.has(k)) tiles.set(k, []);
        tiles.get(k).push(feat);
      }
    }
  }

  const dir = path.join(repo, "public", "zoning", key);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  let bytes = 0, maxBytes = 0;
  for (const [k, feats] of tiles) {
    const s = JSON.stringify({ type: "FeatureCollection", features: feats });
    fs.writeFileSync(path.join(dir, "t_" + k + ".json"), s);
    bytes += s.length; maxBytes = Math.max(maxBytes, s.length);
  }
  const index = {
    county: src.county, agency: src.agency, layer: src.layer,
    source_url: src.url, source_page: src.page, downloaded,
    records: id, tile_deg: TILE_DEG, simplify_tolerance_m: TOLERANCE_M,
    tiles: Array.from(tiles.keys()).sort()
  };
  fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(index, null, 1) + "\n");
  console.log(`完成:讀入 ${read} 筆、輸出 ${id} 筆(捨棄 ${dropped})、${tiles.size} 個圖磚、共 ${(bytes / 1048576).toFixed(1)} MB、` +
    `最大圖磚 ${(maxBytes / 1048576).toFixed(2)} MB、耗時 ${((Date.now() - t0) / 1000).toFixed(0)} 秒 → ${path.relative(repo, dir)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
