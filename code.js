// code.js — Figma Main Thread (Sandbox)
// 역할: 프레임 선택 감지, 이미지 export, UI iframe과 메시지 통신

figma.showUI(__html__, { width: 560, height: 920, themeColors: true });

// 선택 변경 감지 → 즉시 프리뷰 export 실행
figma.on("selectionchange", async () => {
  const selection = figma.currentPage.selection;

  const frames = selection.filter(
    (node) => node.type === "FRAME" || node.type === "COMPONENT" || node.type === "INSTANCE"
  );

  if (frames.length === 0) {
    figma.ui.postMessage({ type: "selection-cleared" });
    return;
  }

  const limited = frames.slice(0, 8);

  // 메타데이터 먼저 전송 → UI가 즉시 로딩 플레이스홀더로 전환
  figma.ui.postMessage({
    type: "selection-changed",
    frames: limited.map((f) => ({
      id: f.id,
      name: f.name,
      width: f.width,
      height: f.height,
    })),
  });

  // 0.5x 저해상도로 프리뷰 순차 export
  try {
    const results = [];
    for (const node of limited) {
      const bytes = await node.exportAsync({
        format: "PNG",
        constraint: { type: "SCALE", value: 0.5 },
      });
      results.push({
        id: node.id,
        name: node.name,
        imageBase64: figma.base64Encode(bytes),
      });
    }
    figma.ui.postMessage({ type: "previews-done", frames: results });
  } catch (_) {
    // 프리뷰 실패는 무시 — 검증 자체에는 영향 없음
  }
});

// UI로부터 메시지 수신
figma.ui.onmessage = async (msg) => {

  // 검증용 고화질 export (UX 검증 실행 버튼 클릭 시)
  if (msg.type === "export-frames-for-review") {
    try {
      const frameIds = msg.frameIds.slice(0, 8);
      const scale = msg.scale || 1;
      const results = [];
      for (const frameId of frameIds) {
        const node = await figma.getNodeByIdAsync(frameId);
        if (!node) continue;
        const bytes = await node.exportAsync({
          format: "PNG",
          constraint: { type: "SCALE", value: scale },
        });
        results.push({
          id: node.id,
          name: node.name,
          imageBase64: figma.base64Encode(bytes),
          width: node.width,
          height: node.height,
        });
      }
      figma.ui.postMessage({ type: "export-done", frames: results });
    } catch (err) {
      figma.ui.postMessage({ type: "export-error", error: err.message });
    }
  }

  // clientStorage 저장
  if (msg.type === "storage-set") {
    try {
      await figma.clientStorage.setAsync(msg.key, msg.value);
      figma.ui.postMessage({ type: "storage-set-done", key: msg.key });
    } catch (_) {}
  }

  // clientStorage 읽기
  if (msg.type === "storage-get") {
    try {
      const value = await figma.clientStorage.getAsync(msg.key);
      figma.ui.postMessage({ type: "storage-get-done", key: msg.key, value: value || null });
    } catch (_) {
      figma.ui.postMessage({ type: "storage-get-done", key: msg.key, value: null });
    }
  }

  if (msg.type === "create-figma-report") {
    try {
      await Promise.all([
        figma.loadFontAsync({ family: "Inter", style: "Regular" }),
        figma.loadFontAsync({ family: "Inter", style: "Medium" }),
        figma.loadFontAsync({ family: "Inter", style: "Bold" }),
        figma.loadFontAsync({ family: "Inter", style: "Extra Bold" }),
      ]);
      const reportFrame = await _buildFigmaReport(msg.data);
      figma.currentPage.appendChild(reportFrame);
      figma.viewport.scrollAndZoomIntoView([reportFrame]);
      figma.ui.postMessage({ type: "report-created" });
    } catch (err) {
      figma.ui.postMessage({ type: "report-error", error: err.message });
    }
  }

  if (msg.type === "close-plugin") {
    figma.closePlugin();
  }
};

// ── Figma Report Builder ────────────────────────────────
function _r(r, g, b) { return { r: r / 255, g: g / 255, b: b / 255 }; }

function _b64(b64) {
  return figma.base64Decode(b64);
}

function _vf(name, w) {
  const f = figma.createFrame();
  f.name = name;
  f.layoutMode = "VERTICAL";
  f.primaryAxisSizingMode = "AUTO";
  f.counterAxisSizingMode = w ? "FIXED" : "AUTO";
  if (w) f.resize(w, 100);
  f.fills = [];
  f.clipsContent = false;
  return f;
}

function _hf(name, w) {
  const f = figma.createFrame();
  f.name = name;
  f.layoutMode = "HORIZONTAL";
  f.primaryAxisSizingMode = w ? "FIXED" : "AUTO";
  f.counterAxisSizingMode = "AUTO";
  if (w) f.resize(w, 40);
  f.fills = [];
  f.clipsContent = false;
  return f;
}

function _txt(chars, size, style, col, w, lh) {
  const t = figma.createText();
  t.fontName = { family: "Inter", style: style || "Regular" };
  t.fontSize = size || 14;
  t.fills = [{ type: "SOLID", color: _r(...(col || [17, 17, 17])) }];
  if (lh) t.lineHeight = { unit: "PIXELS", value: lh };
  t.textAlignVertical = "CENTER";
  if (w) {
    t.textAutoResize = "HEIGHT";
    t.resize(w, 40);
    t.characters = String(chars || "");
    // force height recalc after content set
    t.textAutoResize = "HEIGHT";
  } else {
    t.textAutoResize = "WIDTH_AND_HEIGHT";
    t.characters = String(chars || "");
  }
  return t;
}

function _divider(w, col) {
  const r = figma.createRectangle();
  r.name = "divider";
  r.resize(w, 1);
  r.fills = [{ type: "SOLID", color: _r(...(col || [220, 220, 220])) }];
  return r;
}

async function _imgNode(b64, sw, sh, name) {
  const img = figma.createImage(_b64(b64));
  const MAX = 340;
  const h = Math.min(sh || MAX, MAX);
  const w = sw && sh ? Math.round(h * sw / sh) : Math.round(h * 9 / 16);
  const rect = figma.createRectangle();
  rect.name = name || "img";
  rect.resize(w, h);
  rect.fills = [{ type: "IMAGE", imageHash: img.hash, scaleMode: "FIT" }];
  rect.cornerRadius = 0;
  return rect;
}

// Hero (light — lyp_report_v2 style)
function _buildHero(data, W) {
  const INNER = W - 128;
  // outer frame: no padding — children handle their own spacing
  const f = _vf("Hero", W);
  f.fills = [{ type: "SOLID", color: _r(255, 255, 255) }];
  f.paddingTop = 48; f.paddingBottom = 52;
  f.paddingLeft = 64; f.paddingRight = 64;
  f.itemSpacing = 0;

  // Kicker — sits at top, full INNER width
  const kickerMap = { ab: "A/B COMPARISON REPORT", uc: "USABILITY CHECK REPORT", review: "UX REVIEW REPORT" };
  const kicker = _txt(
    kickerMap[data.type] || "UX REVIEW REPORT",
    9, "Medium", [160, 160, 160], INNER
  );
  kicker.letterSpacing = { unit: "PERCENT", value: 18 };
  f.appendChild(kicker);

  // 6px black border bar (spacer above = 28px via invisible rect)
  const spacer1 = figma.createRectangle();
  spacer1.resize(INNER, 28); spacer1.fills = [];
  f.appendChild(spacer1);

  const borderBar = figma.createRectangle();
  borderBar.name = "hero-border";
  borderBar.resize(INNER, 6);
  borderBar.fills = [{ type: "SOLID", color: _r(17, 17, 17) }];
  f.appendChild(borderBar);

  // Spacer before title
  const spacer2 = figma.createRectangle();
  spacer2.resize(INNER, 32); spacer2.fills = [];
  f.appendChild(spacer2);

  // Title — Extra Bold
  const titleMap = { ab: "A/B 비교 시뮬레이션", uc: "Usability Check", review: "UX Review Report" };
  const title = _txt(
    titleMap[data.type] || "UX Review Report",
    48, "Extra Bold", [17, 17, 17], INNER, 60
  );
  f.appendChild(title);

  // Sub label
  if (data.reviewTypeLabel || data.modeLabel) {
    const spacer3 = figma.createRectangle();
    spacer3.resize(INNER, 8); spacer3.fills = [];
    f.appendChild(spacer3);
    f.appendChild(_txt(data.reviewTypeLabel || data.modeLabel, 15, "Regular", [130, 130, 130], INNER));
  }

  // Divider — spacer above
  const spacer4 = figma.createRectangle();
  spacer4.resize(INNER, 36); spacer4.fills = [];
  f.appendChild(spacer4);
  f.appendChild(_divider(INNER, [220, 220, 220]));

  // Meta row
  const spacer5 = figma.createRectangle();
  spacer5.resize(INNER, 20); spacer5.fills = [];
  f.appendChild(spacer5);

  const cellW = Math.floor(INNER / 4);
  const metaRow = _hf("Meta");
  metaRow.primaryAxisSizingMode = "FIXED";
  metaRow.counterAxisSizingMode = "AUTO";
  metaRow.resize(INNER, 48);
  metaRow.itemSpacing = 0;

  let items;
  if (data.type === "uc") {
    items = [
      { k: "DATE",   v: data.date },
      { k: "MODE",   v: data.mode || "—" },
      { k: "AGE",    v: (data.ageGroups || []).join(" / ") || "—" },
      { k: "FRAMES", v: ((data.frames && data.frames.length) || 0) + " screens" },
    ];
  } else {
    items = [
      { k: "DATE",   v: data.date },
      { k: "TYPE",   v: data.reviewTypeLabel || data.modeLabel || "—" },
      { k: "MARKET", v: (data.markets || []).join(" / ") || "—" },
      {
        k: data.type === "ab" ? "WINNER" : "FRAMES",
        v: data.type === "ab"
          ? (data.winner === "TIE" ? "TIE" : "Version " + data.winner)
          : ((data.frames && data.frames.length) || 0) + " screens",
      },
    ];
  }

  items.forEach(function(item) {
    const cell = _vf("meta-cell", cellW);
    cell.itemSpacing = 6;
    cell.paddingRight = 16;
    const keyTxt = _txt(item.k, 8, "Medium", [175, 175, 175], cellW - 16);
    keyTxt.letterSpacing = { unit: "PERCENT", value: 14 };
    cell.appendChild(keyTxt);
    cell.appendChild(_txt(item.v, 14, "Medium", [17, 17, 17], cellW - 16));
    metaRow.appendChild(cell);
  });

  f.appendChild(metaRow);

  // Second meta row for AB/UC persona fields
  let items2 = null;
  if (data.type === "ab") {
    items2 = [
      { k: "AGE",          v: (data.ageGroups || []).join(" / ") || "—" },
      { k: "PATTERN",      v: data.usagePattern || "—" },
      { k: "SUBSCRIPTION", v: data.subscriptionExp || "—" },
      { k: "SAMPLE SIZE",  v: data.sampleSize ? parseInt(data.sampleSize).toLocaleString() + "명" : "—" },
    ];
  } else if (data.type === "uc") {
    items2 = [
      { k: "SUBSCRIPTION", v: data.subscription || "—" },
      { k: "TARGET",       v: data.targetExtra || "—" },
      { k: "",             v: "" },
      { k: "",             v: "" },
    ];
  }
  if (items2) {
    const spacer6 = figma.createRectangle();
    spacer6.resize(INNER, 12); spacer6.fills = [];
    f.appendChild(spacer6);
    const metaRow2 = _hf("Meta2");
    metaRow2.primaryAxisSizingMode = "FIXED";
    metaRow2.counterAxisSizingMode = "AUTO";
    metaRow2.resize(INNER, 48);
    metaRow2.itemSpacing = 0;
    items2.forEach(function(item) {
      const cell = _vf("meta-cell2", cellW);
      cell.itemSpacing = 6;
      cell.paddingRight = 16;
      if (item.k) {
        const keyTxt = _txt(item.k, 8, "Medium", [175, 175, 175], cellW - 16);
        keyTxt.letterSpacing = { unit: "PERCENT", value: 14 };
        cell.appendChild(keyTxt);
        cell.appendChild(_txt(item.v, 14, "Medium", [17, 17, 17], cellW - 16));
      }
      metaRow2.appendChild(cell);
    });
    f.appendChild(metaRow2);
  }

  return f;
}

// Section header
function _sectionHead(label, title, W) {
  const INNER = W - 128;
  const f = _vf("section-head", W);
  f.fills = [{ type: "SOLID", color: _r(255, 255, 255) }];
  f.paddingTop = 56; f.paddingBottom = 24;
  f.paddingLeft = 64; f.paddingRight = 64;
  f.itemSpacing = 12;
  const labelTxt = _txt(label, 9, "Medium", [170, 170, 170], INNER);
  labelTxt.letterSpacing = { unit: "PERCENT", value: 16 };
  f.appendChild(labelTxt);
  f.appendChild(_txt(title, 24, "Bold", [17, 17, 17], INNER));
  f.appendChild(_divider(INNER, [220, 220, 220]));
  return f;
}

// Screenshots section
async function _buildScreens(frames, label, title, W, tagLabel) {
  const INNER = W - 128;
  const sec = _vf("screens-" + (tagLabel || ""), W);
  sec.appendChild(_sectionHead(label, title, W));

  const row = _hf("frames-row");
  row.paddingLeft = 64; row.paddingRight = 64; row.paddingBottom = 48;
  row.itemSpacing = 20;
  row.counterAxisAlignItems = "MIN";

  for (const fr of frames) {
    if (!fr.imageBase64) continue;
    const col = _vf("col-" + fr.name);
    col.itemSpacing = 8;
    const imgNode = await _imgNode(fr.imageBase64, fr.width, fr.height, fr.name);
    col.appendChild(imgNode);
    col.appendChild(_txt(fr.name, 11, "Regular", [120, 120, 120]));
    row.appendChild(col);
  }

  sec.appendChild(row);
  return sec;
}

// Text result section
function _buildResult(text, label, title, W) {
  const INNER = W - 128;
  const sec = _vf("result", W);
  sec.appendChild(_sectionHead(label, title, W));

  const card = _vf("result-card", INNER);
  card.primaryAxisSizingMode = "AUTO";
  card.counterAxisSizingMode = "FIXED";
  card.paddingTop = 32; card.paddingBottom = 32;
  card.paddingLeft = 36; card.paddingRight = 36;
  card.fills = [{ type: "SOLID", color: _r(255, 255, 255) }];
  card.cornerRadius = 0;
  card.strokes = [{ type: "SOLID", color: _r(220, 220, 220) }];
  card.strokeWeight = 1;

  const textNode = _txt(text || "", 13, "Regular", [34, 34, 34], INNER - 64, 22);
  card.appendChild(textNode);

  // vertical wrapper (fixed width W) so card fills properly
  const wrapper = _vf("result-wrapper", W);
  wrapper.paddingLeft = 64; wrapper.paddingRight = 64; wrapper.paddingBottom = 48;
  wrapper.appendChild(card);
  sec.appendChild(wrapper);
  return sec;
}

// Winner section (A/B)
function _buildWinner(winner, reason, W) {
  const INNER = W - 128;
  const sec = _vf("winner", W);
  sec.appendChild(_sectionHead("01 — RESULT", "비교 결과", W));

  const winCol = winner === "A" ? [59, 130, 246] : winner === "B" ? [245, 158, 11] : [6, 199, 85];
  const winLabel = winner === "TIE" ? "동등 (TIE)" : "Version " + winner + " 우세";

  const banner = _vf("winner-banner", INNER);
  banner.paddingTop = 24; banner.paddingBottom = 24;
  banner.paddingLeft = 28; banner.paddingRight = 28;
  banner.itemSpacing = 10;
  banner.fills = [{ type: "SOLID", color: _r(...winCol), opacity: 0.08 }];
  banner.cornerRadius = 0;
  banner.strokes = [{ type: "SOLID", color: _r(...winCol) }];
  banner.strokeWeight = 1.5;

  banner.appendChild(_txt(winLabel, 20, "Bold", winCol, INNER - 56));
  if (reason) banner.appendChild(_txt(reason, 13, "Regular", [85, 85, 85], INNER - 56, 21));

  const wrapper = _hf("winner-wrapper");
  wrapper.paddingLeft = 64; wrapper.paddingRight = 64; wrapper.paddingBottom = 20;
  wrapper.appendChild(banner);
  sec.appendChild(wrapper);
  return sec;
}

// Scorecard (A/B)
function _buildScorecard(scores, W, hasC) {
  if (!scores || !scores.length) return null;
  const INNER = W - 128;
  const sec = _vf("scorecard", W);
  sec.appendChild(_sectionHead("— SCORECARD", "항목별 점수", W));

  const table = _vf("table", INNER);
  table.fills = [{ type: "SOLID", color: _r(255, 255, 255) }];
  table.cornerRadius = 0;
  table.strokes = [{ type: "SOLID", color: _r(232, 232, 232) }];
  table.strokeWeight = 1;
  table.clipsContent = true;
  table.itemSpacing = 0;

  const SCORE_COL = 56;
  const colCount = hasC ? 3 : 2;
  const CRIT_W = INNER - SCORE_COL * colCount - 40;

  // Header
  const hRow = _hf("header-row");
  hRow.resize(INNER, 36);
  hRow.primaryAxisSizingMode = "FIXED";
  hRow.counterAxisSizingMode = "AUTO";
  hRow.counterAxisAlignItems = "CENTER";
  hRow.paddingTop = 10; hRow.paddingBottom = 10;
  hRow.paddingLeft = 20; hRow.paddingRight = 20;
  hRow.itemSpacing = 0;
  hRow.fills = [{ type: "SOLID", color: _r(245, 245, 245) }];
  const hCrit = _vf("hcrit", CRIT_W);
  hCrit.appendChild(_txt("항목", 10, "Medium", [119, 119, 119], CRIT_W));
  hRow.appendChild(hCrit);
  const hA = _vf("hA", SCORE_COL);
  hA.counterAxisAlignItems = "CENTER";
  hA.appendChild(_txt("A", 10, "Bold", [59, 130, 246]));
  hRow.appendChild(hA);
  const hB = _vf("hB", SCORE_COL);
  hB.counterAxisAlignItems = "CENTER";
  hB.appendChild(_txt("B", 10, "Bold", [245, 158, 11]));
  hRow.appendChild(hB);
  if (hasC) {
    const hC = _vf("hC", SCORE_COL);
    hC.counterAxisAlignItems = "CENTER";
    hC.appendChild(_txt("C", 10, "Bold", [139, 92, 246]));
    hRow.appendChild(hC);
  }
  table.appendChild(hRow);

  scores.forEach((s, i) => {
    if (i > 0) table.appendChild(_divider(INNER, [232, 232, 232]));
    const row = _hf("row-" + i);
    row.resize(INNER, 40);
    row.primaryAxisSizingMode = "FIXED";
    row.counterAxisSizingMode = "AUTO";
    row.counterAxisAlignItems = "CENTER";
    row.paddingTop = 12; row.paddingBottom = 12;
    row.paddingLeft = 20; row.paddingRight = 20;
    row.itemSpacing = 0;

    const critCol = _vf("crit-" + i, CRIT_W);
    critCol.itemSpacing = 3;
    critCol.appendChild(_txt(s.criterion || "", 13, "Regular", [34, 34, 34], CRIT_W));
    if (s.note) critCol.appendChild(_txt(s.note, 11, "Regular", [150, 150, 150], CRIT_W));
    row.appendChild(critCol);

    const aStr = s.a !== undefined && s.a !== null ? String(s.a) : "—";
    const bStr = s.b !== undefined && s.b !== null ? String(s.b) : "—";
    const aCol = _vf("aCol-" + i, SCORE_COL);
    aCol.counterAxisAlignItems = "CENTER";
    aCol.appendChild(_txt(aStr, 18, "Bold", [59, 130, 246]));
    row.appendChild(aCol);
    const bCol = _vf("bCol-" + i, SCORE_COL);
    bCol.counterAxisAlignItems = "CENTER";
    bCol.appendChild(_txt(bStr, 18, "Bold", [245, 158, 11]));
    row.appendChild(bCol);
    if (hasC) {
      const cStr = s.c !== undefined && s.c !== null ? String(s.c) : "—";
      const cCol = _vf("cCol-" + i, SCORE_COL);
      cCol.counterAxisAlignItems = "CENTER";
      cCol.appendChild(_txt(cStr, 18, "Bold", [139, 92, 246]));
      row.appendChild(cCol);
    }
    table.appendChild(row);
  });

  const wrapper = _vf("scorecard-wrapper", W);
  wrapper.paddingLeft = 64; wrapper.paddingRight = 64; wrapper.paddingBottom = 48;
  wrapper.appendChild(table);
  sec.appendChild(wrapper);
  return sec;
}

// Persona breakdown (A/B/C)
function _buildPersona(breakdown, W, hasC) {
  if (!breakdown || !breakdown.length) return null;
  const INNER = W - 128;
  const sec = _vf("persona", W);
  sec.appendChild(_sectionHead("— PERSONA", "페르소나 선택 비율 추정", W));

  const table = _vf("persona-table", INNER);
  table.fills = [{ type: "SOLID", color: _r(255, 255, 255) }];
  table.cornerRadius = 0;
  table.strokes = [{ type: "SOLID", color: _r(232, 232, 232) }];
  table.strokeWeight = 1;
  table.clipsContent = true;
  table.itemSpacing = 0;

  breakdown.forEach((p, i) => {
    if (i > 0) table.appendChild(_divider(INNER, [232, 232, 232]));
    const a = Math.min(100, Math.max(0, p.a || 0));
    const b = Math.min(100, Math.max(0, p.b || 0));
    const c = hasC ? Math.min(100, Math.max(0, 100 - a - b)) : 0;
    const bVal = hasC ? b : (100 - a);

    const row = _vf("prow-" + i, INNER);
    row.paddingTop = 14; row.paddingBottom = 14;
    row.paddingLeft = 20; row.paddingRight = 20;
    row.itemSpacing = 6;

    row.appendChild(_txt(p.segment || "", 12, "Medium", [34, 34, 34], INNER - 40));

    // Bar
    const barWrap = _hf("bar-wrap");
    barWrap.itemSpacing = 0;
    barWrap.counterAxisAlignItems = "CENTER";
    const PCT_LABELS_W = hasC ? 150 : 100;
    const BAR_W = INNER - 40 - PCT_LABELS_W;
    if (BAR_W > 0 && a > 0) {
      const ra = figma.createRectangle();
      ra.resize(Math.round(BAR_W * a / 100), 8);
      ra.fills = [{ type: "SOLID", color: _r(59, 130, 246) }];
      ra.cornerRadius = 0;
      barWrap.appendChild(ra);
    }
    if (BAR_W > 0 && bVal > 0) {
      const rb = figma.createRectangle();
      rb.resize(Math.round(BAR_W * bVal / 100), 8);
      rb.fills = [{ type: "SOLID", color: _r(245, 158, 11) }];
      rb.cornerRadius = 0;
      barWrap.appendChild(rb);
    }
    if (hasC && BAR_W > 0 && c > 0) {
      const rc = figma.createRectangle();
      rc.resize(Math.round(BAR_W * c / 100), 8);
      rc.fills = [{ type: "SOLID", color: _r(139, 92, 246) }];
      rc.cornerRadius = 0;
      barWrap.appendChild(rc);
    }

    const pctRow = _hf("pct-row");
    pctRow.itemSpacing = 8;
    pctRow.appendChild(barWrap);
    pctRow.appendChild(_txt("A " + a + "%", 11, "Medium", [59, 130, 246]));
    pctRow.appendChild(_txt("B " + bVal + "%", 11, "Medium", [245, 158, 11]));
    if (hasC) pctRow.appendChild(_txt("C " + c + "%", 11, "Medium", [139, 92, 246]));
    row.appendChild(pctRow);

    if (p.note) row.appendChild(_txt(p.note, 11, "Regular", [150, 150, 150], INNER - 40));
    table.appendChild(row);
  });

  const wrapper = _hf("persona-wrapper");
  wrapper.paddingLeft = 64; wrapper.paddingRight = 64; wrapper.paddingBottom = 0;
  wrapper.appendChild(table);
  sec.appendChild(wrapper);
  return sec;
}

async function _buildFigmaReport(data) {
  const W = 1200;
  const titleMap = { ab: "A/B Comparison Report", uc: "Usability Check Report", review: "UX Review Report" };
  const root = _vf(
    (titleMap[data.type] || "Report") + " — " + data.date,
    W
  );
  root.fills = [{ type: "SOLID", color: _r(255, 255, 255) }];
  root.strokes = [{ type: "SOLID", color: _r(220, 220, 220) }];
  root.strokeWeight = 1;
  root.strokeAlign = "OUTSIDE";
  root.paddingBottom = 64;

  root.appendChild(_buildHero(data, W));

  if (data.type === "review") {
    root.appendChild(await _buildScreens(data.frames || [], "01 — SCREENS", "검증 프레임", W));
    root.appendChild(_buildResult(data.resultText || "", "02 — ANALYSIS", "AI 분석 결과", W));
  } else if (data.type === "uc") {
    root.appendChild(await _buildScreens(data.frames || [], "01 — SCREENS", "검증 프레임", W));
    root.appendChild(_buildUCResults(data, W));
  } else {
    root.appendChild(_buildWinner(data.winner || "TIE", data.winnerReason || "", W));
    root.appendChild(await _buildScreens(data.framesA || [], "02 — GROUP A", "Group A 프레임", W, "a"));
    root.appendChild(await _buildScreens(data.framesB || [], "03 — GROUP B", "Group B 프레임", W, "b"));
    const hasC = !!(data.framesC && data.framesC.length);
    if (hasC) {
      root.appendChild(await _buildScreens(data.framesC, "04 — GROUP C", "Group C 프레임", W, "c"));
    }
    const persona = _buildPersona(data.personaBreakdown, W, hasC);
    if (persona) root.appendChild(persona);
    const scorecard = _buildScorecard(data.scores, W, hasC);
    if (scorecard) root.appendChild(scorecard);
    root.appendChild(_buildResult(data.detail || "", "06 — ANALYSIS", "상세 분석", W));
  }

  // Disclaimer footer
  root.appendChild(_buildDisclaimer(W));

  return root;
}

function _buildUCResults(data, W) {
  const INNER = W - 128;
  const sec = _vf("uc-results", W);

  // Target summary badge
  if (data.targetSummary) {
    sec.appendChild(_sectionHead("— TARGET", "타겟 요약", W));
    const tw = _vf("target-wrap", W);
    tw.paddingLeft = 64; tw.paddingRight = 64; tw.paddingBottom = 32;
    const badge = _vf("target-badge", INNER);
    badge.fills = [{ type: "SOLID", color: _r(240, 253, 244) }];
    badge.cornerRadius = 8;
    badge.paddingTop = 12; badge.paddingBottom = 12;
    badge.paddingLeft = 16; badge.paddingRight = 16;
    badge.appendChild(_txt(data.targetSummary, 13, "Medium", [6, 120, 50], INNER - 32, 20));
    tw.appendChild(badge);
    sec.appendChild(tw);
  }

  // Keep section
  if (data.keep && data.keep.length) {
    sec.appendChild(_sectionHead("— KEEP", "현행 유지", W));
    const wrap = _vf("keep-wrap", W);
    wrap.paddingLeft = 64; wrap.paddingRight = 64; wrap.paddingBottom = 32;
    wrap.itemSpacing = 16;
    data.keep.forEach((item, i) => {
      const card = _buildUCItemCard(item, INNER, [6, 199, 85]);
      wrap.appendChild(card);
    });
    sec.appendChild(wrap);
  }

  // Improve section
  if (data.improve && data.improve.length) {
    sec.appendChild(_sectionHead("— IMPROVE", "개선 고려", W));
    const wrap = _vf("improve-wrap", W);
    wrap.paddingLeft = 64; wrap.paddingRight = 64; wrap.paddingBottom = 32;
    wrap.itemSpacing = 16;
    data.improve.forEach((item, i) => {
      const card = _buildUCItemCard(item, INNER, [245, 158, 11]);
      wrap.appendChild(card);
    });
    sec.appendChild(wrap);
  }

  // Summary
  if (data.summary) {
    sec.appendChild(_sectionHead("— SUMMARY", "종합 진단", W));
    const wrap = _vf("summary-wrap", W);
    wrap.paddingLeft = 64; wrap.paddingRight = 64; wrap.paddingBottom = 32;
    wrap.itemSpacing = 16;
    if (Array.isArray(data.summary)) {
      data.summary.forEach((s) => {
        const card = _vf("summary-card", INNER);
        card.fills = [{ type: "SOLID", color: _r(245, 245, 245) }];
        card.cornerRadius = 8;
        card.paddingTop = 12; card.paddingBottom = 12;
        card.paddingLeft = 14; card.paddingRight = 14;
        card.itemSpacing = 6;
        card.appendChild(_txt(s.screen || "", 13, "Bold", [34, 34, 34], INNER - 28));
        card.appendChild(_txt("강점: " + (s.good || ""), 12, "Regular", [60, 60, 60], INNER - 28, 20));
        card.appendChild(_txt("개선: " + (s.bad || ""), 12, "Regular", [180, 60, 60], INNER - 28, 20));
        wrap.appendChild(card);
      });
    } else {
      wrap.appendChild(_txt(data.summary, 13, "Regular", [34, 34, 34], INNER, 22));
    }
    sec.appendChild(wrap);
  }

  // Archetypes
  if (data.archetypes && data.archetypes.length) {
    sec.appendChild(_sectionHead("— USER TYPES", "유저 유형별 반응", W));
    const wrap = _vf("archetype-wrap", W);
    wrap.paddingLeft = 64; wrap.paddingRight = 64; wrap.paddingBottom = 32;
    wrap.itemSpacing = 20;
    data.archetypes.forEach((a) => {
      const card = _hf("arc-card");
      card.itemSpacing = 0;
      card.counterAxisAlignItems = "MIN";

      const bar = figma.createRectangle();
      bar.name = "left-bar";
      bar.resize(3, 10);
      bar.fills = [{ type: "SOLID", color: _r(91, 141, 239) }];
      bar.layoutAlign = "STRETCH";
      card.appendChild(bar);

      const content = _vf("arc-content", INNER - 3);
      content.paddingLeft = 11;
      content.itemSpacing = 4;
      const header = _hf("arc-header");
      header.itemSpacing = 8;
      header.counterAxisAlignItems = "CENTER";
      header.appendChild(_txt(a.name || "", 14, "Bold", [34, 34, 34]));
      header.appendChild(_txt(a.trait || "", 11, "Regular", [150, 150, 150]));
      content.appendChild(header);
      content.appendChild(_txt(a.reaction || "", 12, "Regular", [80, 80, 80], INNER - 17, 20));
      if (a.user_voice) {
        const voice = _vf("arc-voice", INNER - 17);
        voice.fills = [{ type: "SOLID", color: _r(245, 245, 245) }];
        voice.cornerRadius = 6;
        voice.paddingTop = 8; voice.paddingBottom = 8;
        voice.paddingLeft = 10; voice.paddingRight = 10;
        voice.appendChild(_txt(a.user_voice, 11, "Regular", [120, 120, 120], INNER - 37, 18));
        content.appendChild(voice);
      }
      card.appendChild(content);
      wrap.appendChild(card);
    });
    sec.appendChild(wrap);
  }

  return sec;
}

function _buildUCItemCard(item, W, borderColor) {
  const wrapper = _hf("uc-item-wrap");
  wrapper.itemSpacing = 0;
  wrapper.counterAxisAlignItems = "MIN";

  const bar = figma.createRectangle();
  bar.name = "left-bar";
  bar.resize(3, 10);
  bar.fills = [{ type: "SOLID", color: _r(borderColor[0], borderColor[1], borderColor[2]) }];
  bar.layoutAlign = "STRETCH";
  wrapper.appendChild(bar);

  const innerWrap = _vf("inner", W - 3);
  innerWrap.paddingLeft = 11;
  innerWrap.itemSpacing = 4;
  innerWrap.appendChild(_txt(item.title || "", 14, "Bold", [34, 34, 34], W - 17));
  innerWrap.appendChild(_txt(item.desc || "", 12, "Regular", [80, 80, 80], W - 17, 20));
  if (item.user_voice) {
    const voice = _vf("voice", W - 17);
    voice.fills = [{ type: "SOLID", color: _r(245, 245, 245) }];
    voice.cornerRadius = 6;
    voice.paddingTop = 8; voice.paddingBottom = 8;
    voice.paddingLeft = 10; voice.paddingRight = 10;
    voice.appendChild(_txt(item.user_voice, 11, "Regular", [120, 120, 120], W - 37, 18));
    innerWrap.appendChild(voice);
  }
  if (item.idea) {
    const idea = _vf("idea", W - 17);
    idea.fills = [{ type: "SOLID", color: _r(255, 251, 235) }];
    idea.cornerRadius = 6;
    idea.paddingTop = 8; idea.paddingBottom = 8;
    idea.paddingLeft = 10; idea.paddingRight = 10;
    idea.appendChild(_txt(item.idea, 11, "Regular", [180, 120, 10], W - 37, 18));
    innerWrap.appendChild(idea);
  }
  wrapper.appendChild(innerWrap);
  return wrapper;
}

function _buildDisclaimer(W) {
  const INNER = W - 128;
  const f = _vf("disclaimer", W);
  f.paddingTop = 32; f.paddingBottom = 0;
  f.paddingLeft = 64; f.paddingRight = 64;
  f.itemSpacing = 12;
  f.appendChild(_divider(INNER, [220, 220, 220]));
  const spacer = figma.createRectangle();
  spacer.resize(INNER, 8); spacer.fills = [];
  f.appendChild(spacer);
  const text = "AI 추정 기반 참고자료입니다. 최종 판단은 디자이너가 수행합니다.\n플러그인 결과는 의사결정의 보조 근거로만 활용하며, 단독 근거로 사용하지 않습니다.";
  f.appendChild(_txt(text, 11, "Regular", [85, 85, 85], INNER, 18));
  return f;
}
