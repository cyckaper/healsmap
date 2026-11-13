/* ============================================================================
 * review-analysis.js
 * 在地評價 · 評論分析 —— HEALS 基地分析工作站
 *
 * 分析「使用者自行提供」的評論文字:可直接貼上從 Google 地圖評論列表複製的內容
 * (自動略去作者名稱、在地嚮導/評論數、相對時間、按鈕字樣與業主回應),或 PTT、Dcard、
 * 問卷等純文字(以空行分隔;單段多行則每行一則),亦可上傳 CSV / Excel / TXT。
 * 全部在瀏覽器本機處理,不連線任何外部服務;只有使用者按「AI 分析」時,
 * 才由 app.js 把評論文字送後端 /api/analyze。
 *
 * 不自動擷取 Google 評論:Google Maps Platform 條款 §3.2.3(e) 禁止在非 Google 地圖
 * 上或旁使用 Places 內容、§3.2.3(a)(iii) 禁止複製保存使用者評論。
 *
 * 暴露 window.ReviewAnalysis:
 *   parseText(text) -> { reviews:[{text, rating}], format, dropped:{names, meta, owner} }
 *   detectColumns(columns) -> { text, rating }
 *   fromRows(rows, cols) -> [{text, rating}]
 *   analyze(reviews) -> { count, rated, avgRating, dist, aspects, topWords, samples }
 *   ASPECTS
 * ========================================================================== */
(function (global) {
  "use strict";

  var MAX_REVIEWS = 1000;
  var MAX_LEN = 2000;

  // 景觀 / 健康相關面向詞庫(繁中 + 英文);每則評論每面向只計一次
  var ASPECTS = [
    { key: "greenery", zh: ["綠意", "綠地", "綠化", "樹木", "樹林", "花草", "植物", "草皮", "草地", "花園", "森林", "花海", "林蔭"], en: ["green", "greenery", "trees", "flowers", "garden", "lawn", "forest", "plants"] },
    { key: "shade", zh: ["遮蔭", "樹蔭", "遮陽", "陰涼", "涼爽", "乘涼", "綠蔭", "大樹"], en: ["shade", "shady", "shaded"] },
    { key: "heat", zh: ["很熱", "太熱", "炎熱", "悶熱", "好熱", "曝曬", "太曬", "很曬", "好曬", "沒有遮", "沒遮蔽", "熱到"], en: ["hot", "too sunny", "no shade", "sweltering"] },
    { key: "restorative", zh: ["放鬆", "舒服", "舒適", "療癒", "紓壓", "舒壓", "心情", "愜意", "悠閒"], en: ["relax", "relaxing", "relaxed", "calm", "healing", "comfortable", "pleasant", "peaceful"] },
    { key: "walking", zh: ["步道", "散步", "跑步", "慢跑", "健走", "運動", "騎車", "自行車", "腳踏車", "單車", "爬山", "登山"], en: ["walk", "walking", "jog", "jogging", "run", "running", "exercise", "bike", "biking", "cycling", "trail", "hike", "hiking"] },
    { key: "children", zh: ["小孩", "兒童", "孩子", "小朋友", "親子", "遊具", "溜滑梯", "遊戲場", "共融", "沙坑"], en: ["kids", "children", "child", "playground", "family", "families", "toddler"] },
    { key: "seating", zh: ["座椅", "椅子", "長椅", "坐椅", "涼亭", "休憩", "歇腳", "野餐"], en: ["bench", "benches", "seating", "seats", "picnic", "pavilion"] },
    { key: "toilet", zh: ["廁所", "洗手間", "化妝室", "公廁"], en: ["toilet", "toilets", "restroom", "restrooms", "bathroom", "washroom"] },
    { key: "clean", zh: ["乾淨", "整潔", "髒", "垃圾", "臭", "異味", "尿騷", "衛生"], en: ["clean", "dirty", "trash", "litter", "rubbish", "smell", "smelly", "filthy"] },
    { key: "maintenance", zh: ["維護", "管理", "老舊", "損壞", "破損", "整修", "施工", "年久失修"], en: ["maintained", "maintenance", "broken", "renovation", "construction", "rundown", "run-down"] },
    { key: "safety", zh: ["安全", "危險", "治安", "照明", "燈光", "路燈", "太暗", "昏暗"], en: ["safe", "safety", "unsafe", "dangerous", "lighting", "dark"] },
    { key: "access", zh: ["無障礙", "輪椅", "推車", "嬰兒車", "坡道", "樓梯", "階梯", "高低差"], en: ["wheelchair", "stroller", "accessible", "accessibility", "ramp", "stairs", "steps"] },
    { key: "transit", zh: ["捷運", "公車", "停車", "車位", "交通", "車站"], en: ["mrt", "metro", "bus", "parking", "transit", "station"] },
    { key: "noise", zh: ["吵", "噪音", "喧鬧", "安靜", "寧靜", "清幽"], en: ["noise", "noisy", "loud", "quiet"] },
    { key: "crowd", zh: ["人多", "人很多", "擁擠", "人潮", "排隊", "爆滿"], en: ["crowded", "crowd", "crowds", "busy", "queue", "packed"] },
    { key: "insects", zh: ["蚊子", "蚊蟲", "小黑蚊", "被叮"], en: ["mosquito", "mosquitoes", "bugs", "insects"] },
    { key: "scenery", zh: ["漂亮", "美麗", "景色", "風景", "景觀", "拍照", "好拍", "夜景", "視野"], en: ["beautiful", "scenic", "scenery", "view", "views", "photo", "photos", "pretty"] },
    { key: "wildlife", zh: ["鳥", "松鼠", "生態", "昆蟲", "蝴蝶", "烏龜", "鯉魚"], en: ["bird", "birds", "squirrel", "squirrels", "wildlife", "butterfly", "butterflies", "turtles"] },
    { key: "pets", zh: ["狗", "寵物", "毛孩", "遛狗"], en: ["dog", "dogs", "pet", "pets"] }
  ];
  // 英文詞以字界比對(避免 "hot" 命中 "hotel")
  ASPECTS.forEach(function (a) {
    a.re = a.en.length ? new RegExp("\\b(" + a.en.map(function (w) {
      return w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }).join("|") + ")\\b", "i") : null;
  });

  // ---------- Google 地圖評論複製內容的雜訊辨識 ----------
  var NUM_ZH = "(?:\\d+|一|兩|二|三|四|五|六|七|八|九|十|十一|十二)";
  // 作者資訊列:「在地嚮導 · 87 則評論 · 263 張相片」「12 則評論」「Local Guide · 87 reviews · 263 photos」
  var RE_META = new RegExp(
    "^(.{0,40}?)\\s*(?:(?:在地嚮導|Local Guide)\\s*[·・•]?\\s*)?" +
    "(?:\\d[\\d,]*\\s*則評論|\\d[\\d,]*\\s+reviews?)" +
    "(?:\\s*[·・•]\\s*\\d[\\d,]*\\s*(?:張相片|則相片|photos?))?\\s*$", "i");
  var RE_GUIDE_ONLY = /^(?:在地嚮導|Local Guide)(?:\s*[·・•].{0,20})?$/i;
  // 相對時間:「3 個月前」「已編輯 1 年前」「上個月」「2 weeks ago」「Edited a month ago」
  var RE_TIME = new RegExp(
    "^(?:已編輯\\s*|編輯於\\s*)?(?:" + NUM_ZH + "\\s*(?:秒|分鐘|小時|天|週|星期|個月|年)前|上個月|上週|上星期|昨天|今天|剛剛)" +
    "(?:\\s*[·・•].{0,20})?$");
  var RE_TIME_EN = /^(?:edited\s+)?(?:a|an|one|\d+)\s+(?:second|minute|hour|day|week|month|year)s?\s+ago(?:\s*[·・•].{0,20})?$/i;
  var RE_VISIT = /^(?:造訪時間|拜訪時間|造訪日期|Visited in)\b.{0,24}$/i;
  // 業主 / 店家回應(不是訪客意見,略去至下一則評論)
  var RE_OWNER = /^(?:業主回應|店家回應|商家回應|業者回應|Response from the owner)/i;
  // 店家屬性列(餐廳評論常見):「服務: 5」「每人平均消費 $200–400」
  var RE_ATTR = /^(?:食物|服務|氣氛|用餐類型|每人平均消費|推薦菜色|停車位?|無障礙設施?|適合兒童|兒童友善|Food|Service|Atmosphere|Meal type|Price per person|Recommended dishes|Parking|Wheelchair accessibility|Kid-friendliness)\s*[:：]/i;
  var UI_WORDS = {};
  ["讚", "分享", "更多", "…更多", "...更多", "顯示更多", "查看更多", "收合", "回應", "回覆", "翻譯評論", "查看原文", "查看翻譯",
    "由 Google 提供翻譯", "(由 Google 提供翻譯)", "(Translated by Google)", "Translated by Google", "See original", "See translation",
    "Like", "Share", "More", "… More", "Reply", "Helpful", "有幫助", "檢舉評論", "Report review", "新", "New", "相片", "Photos",
    "最相關", "最新", "評分最高", "評分最低", "排序", "Most relevant", "Newest", "Highest rating", "Lowest rating", "Sort"
  ].forEach(function (w) { UI_WORDS[w.toLowerCase()] = 1; });

  // 行首評分:「★★★★☆」「5 顆星」「4.5/5」「5星」「5 stars」「評分:4」
  var RE_RATING = /^\s*(?:評分\s*[:：]?\s*|rating\s*[:：]?\s*)?(★{1,5}☆{0,4}|[1-5](?:\.\d)?\s*(?:\/\s*5|顆星|星|stars?)(?![a-z]))\s*[:：\-–—|,，、]?\s*/i;

  function cleanChars(s) {
    return String(s == null ? "" : s)
      .replace(/\r\n?/g, "\n")
      .replace(/[​-‏⁠﻿]/g, "")
      .replace(/[-]/g, ""); // Google 地圖圖示字型(私用區)
  }

  function parseRating(s) {
    var m = String(s || "").match(RE_RATING);
    if (!m) return null;
    var tok = m[1];
    var v = tok.charAt(0) === "★" ? (tok.match(/★/g) || []).length : parseFloat(tok);
    return v >= 1 && v <= 5 ? v : null;
  }

  // 翻譯評論:「(由 Google 提供翻譯) 譯文 (原始評論) 原文」→ 只留譯文
  function stripTranslation(s) {
    var cut = s.search(/[((](?:原始評論|原文|Original)[))]/i);
    if (cut > 0) s = s.slice(0, cut);
    return s.replace(/[((](?:由 Google 提供翻譯|Translated by Google)[))]/ig, "").trim();
  }

  function isNoise(line) {
    var l = line.toLowerCase();
    return UI_WORDS[l] || /^\d[\d,]*$/.test(line) || RE_TIME.test(line) || RE_TIME_EN.test(line) ||
      RE_VISIT.test(line) || RE_ATTR.test(line);
  }

  // dedupe:貼上文字時去除重複(多次框選重疊);檔案逐列為不同受訪者,不去重
  function finalize(list, dedupe) {
    var seen = {}, out = [];
    list.forEach(function (r) {
      var txt = stripTranslation(r.text.replace(/\s+/g, " ").trim());
      if (r.rating == null) {
        var rt = parseRating(txt);
        if (rt != null) { r.rating = rt; txt = txt.replace(RE_RATING, "").trim(); }
      }
      if (txt.replace(/[\s\p{P}\p{S}]/gu, "").length < 2) return; // 太短 / 只有符號
      if (txt.length > MAX_LEN) txt = txt.slice(0, MAX_LEN) + "…";
      var k = txt.toLowerCase();
      if (dedupe && seen[k]) return;
      seen[k] = 1;
      out.push({ text: txt, rating: r.rating != null ? r.rating : null });
    });
    return out.slice(0, MAX_REVIEWS);
  }

  // Google 地圖格式:以「作者資訊列」為每則評論的分界,其前一列(作者名稱)一併略去
  function parseGoogle(lines) {
    var reviews = [], cur = null, inOwner = false, prevWasText = false, seenMeta = false;
    var dropped = { names: 0, meta: 0, owner: 0, header: 0 };
    function flush() {
      // 第一個作者資訊列之前的內容是地點頁首(名稱、平均分數、排序按鈕…),不是評論
      if (!seenMeta) { if (cur && cur.lines.length) dropped.header += cur.lines.length; cur = null; return; }
      if (cur && cur.lines.length) reviews.push({ text: cur.lines.join(" "), rating: cur.rating });
      cur = null;
    }
    for (var i = 0; i < lines.length; i++) {
      var L = lines[i];
      if (!L) continue;
      var m = L.length <= 90 ? L.match(RE_META) : null;
      if (m || RE_GUIDE_ONLY.test(L)) {
        // 作者名稱若在上一列(被暫存為上一則的最後一列),移除之
        if (!(m && m[1] && m[1].trim()) && cur && prevWasText && cur.lines.length) {
          cur.lines.pop();
          dropped.names++;
        } else if (m && m[1] && m[1].trim()) {
          dropped.names++;
        }
        flush();
        seenMeta = true;
        cur = { lines: [], rating: null };
        inOwner = false; prevWasText = false;
        dropped.meta++;
        continue;
      }
      if (RE_OWNER.test(L)) { inOwner = true; prevWasText = false; dropped.owner++; continue; }
      if (inOwner) {
        // 業主回應之後若出現疑似下一位作者名稱(短行),仍需暫存以便下一列 meta 時移除
        if (i + 1 < lines.length && lines[i + 1] && (RE_META.test(lines[i + 1]) || RE_GUIDE_ONLY.test(lines[i + 1]))) {
          if (!cur) cur = { lines: [], rating: null };
          cur.lines.push(L); prevWasText = true;
        }
        continue;
      }
      if (isNoise(L)) { prevWasText = false; continue; }
      if (!cur) cur = { lines: [], rating: null };
      if (cur.rating == null && !cur.lines.length) {
        var rt = parseRating(L);
        if (rt != null) {
          cur.rating = rt;
          L = L.replace(RE_RATING, "").trim();
          if (!L) { prevWasText = false; continue; }
        }
      }
      cur.lines.push(L);
      prevWasText = true;
    }
    // 最後一則若只剩疑似名稱(業主回應後殘留)則略去
    flush();
    return { reviews: reviews, dropped: dropped };
  }

  // 一般文字:空行分隔為一則;若整段沒有空行但有多行,則每行一則
  function parsePlain(text) {
    var blocks = text.split(/\n\s*\n+/).map(function (b) { return b.trim(); }).filter(Boolean);
    if (blocks.length === 1 && blocks[0].indexOf("\n") >= 0) {
      blocks = blocks[0].split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
    }
    return blocks.map(function (b) {
      var lines = b.split("\n").map(function (l) { return l.trim(); }).filter(function (l) { return l && !isNoise(l); });
      return { text: lines.join(" "), rating: null };
    });
  }

  function parseText(raw) {
    var text = cleanChars(raw);
    var lines = text.split("\n").map(function (l) { return l.trim(); });
    var metaCount = 0;
    lines.forEach(function (l) { if (l && l.length <= 90 && (RE_META.test(l) || RE_GUIDE_ONLY.test(l))) metaCount++; });
    if (metaCount >= 1) {
      var g = parseGoogle(lines);
      return { reviews: finalize(g.reviews, true), format: "google", dropped: g.dropped };
    }
    return { reviews: finalize(parsePlain(text), true), format: "plain", dropped: { names: 0, meta: 0, owner: 0, header: 0 } };
  }

  // ---------- 檔案(CSV / Excel)欄位 ----------
  var TEXT_KEYS = ["review", "reviews", "review_text", "text", "comment", "comments", "content", "snippet", "評論", "評論內容", "內容", "意見", "留言", "心得"];
  var RATING_KEYS = ["rating", "stars", "star", "score", "評分", "星等", "星級", "分數"];

  function pick(columns, keys) {
    var lower = columns.map(function (c) { return String(c).trim().toLowerCase(); });
    for (var i = 0; i < keys.length; i++) { var idx = lower.indexOf(keys[i]); if (idx >= 0) return columns[idx]; }
    for (var j = 0; j < lower.length; j++) {
      for (var k = 0; k < keys.length; k++) if (lower[j].indexOf(keys[k]) >= 0) return columns[j];
    }
    return null;
  }
  function detectColumns(columns) {
    var text = pick(columns, TEXT_KEYS);
    var rating = pick(columns.filter(function (c) { return c !== text; }), RATING_KEYS);
    return { text: text, rating: rating };
  }
  function fromRows(rows, cols) {
    if (!cols || !cols.text) return [];
    return finalize(rows.map(function (r) {
      var raw = cols.rating ? String(r[cols.rating] == null ? "" : r[cols.rating]) : "";
      var v = parseRating(raw);
      if (v == null && raw) { var n = parseFloat(raw.replace(/[^0-9.]/g, "")); v = n >= 1 && n <= 5 ? n : null; }
      return { text: cleanChars(r[cols.text]), rating: v };
    }), false);
  }

  // 關鍵詞清理:中文 2-gram 去除含虛詞字者(「很多」「大的」「園很」等斷詞殘片),英文去泛用詞
  var FUNC_CH = "的很了是也都就和與及或而又才著啊吧呢嗎喔哦呀欸我你他她這那個們有";
  var KEEP_BIGRAM = { "太陽": 1, "有趣": 1, "在地": 1, "都市": 1, "都會": 1 };
  var EN_STOP = {};
  ("with lots lot were very too there here has have had not but so just really also from all can will would our my your " +
    "their its been than more most some one get got place nice good great was were are is the and for this that they them")
    .split(" ").forEach(function (w) { EN_STOP[w] = 1; });
  function cleanTopWords(words, n) {
    return words.filter(function (w) {
      var s = w.word;
      if (/^[a-z0-9]+$/.test(s)) return !EN_STOP[s] && s.length > 2;
      if (KEEP_BIGRAM[s]) return true;
      for (var i = 0; i < s.length; i++) if (FUNC_CH.indexOf(s.charAt(i)) >= 0) return false;
      return true;
    }).slice(0, n);
  }

  // ---------- 統計 ----------
  function aspectHit(a, txt, lower) {
    for (var i = 0; i < a.zh.length; i++) if (txt.indexOf(a.zh[i]) >= 0) return true;
    return a.re ? a.re.test(lower) : false;
  }

  function analyze(reviews) {
    reviews = reviews || [];
    var rated = reviews.filter(function (r) { return r.rating != null; });
    var dist = [0, 0, 0, 0, 0];
    var sum = 0;
    rated.forEach(function (r) {
      sum += r.rating;
      dist[Math.max(1, Math.min(5, Math.round(r.rating))) - 1]++;
    });
    var aspects = ASPECTS.map(function (a) {
      var n = 0;
      reviews.forEach(function (r) { if (aspectHit(a, r.text, r.text.toLowerCase())) n++; });
      return { key: a.key, count: n, pct: reviews.length ? +(n / reviews.length * 100).toFixed(1) : 0 };
    }).filter(function (a) { return a.count > 0; })
      .sort(function (a, b) { return b.count - a.count; });

    var topWords = [], samples = [];
    var CL = global.CommentsLayer;
    if (CL && typeof CL.summarize === "function") {
      var s = CL.summarize(reviews.map(function (r) { return { comment: r.text }; }), { topN: 60, sampleN: 5 });
      // 評論夠多時只留出現 ≥ 2 次的詞,濾掉中文 2-gram 的一次性殘片
      var words = reviews.length >= 8 ? s.topWords.filter(function (w) { return w.count >= 2; }) : s.topWords;
      topWords = cleanTopWords(words, 12); samples = s.samples;
    } else {
      samples = reviews.slice(0, 5).map(function (r) { return r.text; });
    }
    return {
      count: reviews.length,
      rated: rated.length,
      avgRating: rated.length ? +(sum / rated.length).toFixed(2) : null,
      dist: dist,
      aspects: aspects,
      topWords: topWords,
      samples: samples
    };
  }

  global.ReviewAnalysis = {
    parseText: parseText,
    detectColumns: detectColumns,
    fromRows: fromRows,
    analyze: analyze,
    parseRating: parseRating,
    ASPECTS: ASPECTS
  };
})(typeof window !== "undefined" ? window : this);
