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
  const kicker = _txt(
    data.type === "ab" ? "A/B COMPARISON REPORT" : "UX REVIEW REPORT",
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
  const title = _txt(
    data.type === "ab" ? "A/B 비교 시뮬레이션" : "UX Review Report",
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

  const items = [
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
function _buildScorecard(scores, W) {
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

  const SCORE_COL = 56; // fixed width per score column
  const CRIT_W = INNER - SCORE_COL * 2 - 40; // 40 = paddingLeft+Right

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
    table.appendChild(row);
  });

  const wrapper = _vf("scorecard-wrapper", W);
  wrapper.paddingLeft = 64; wrapper.paddingRight = 64; wrapper.paddingBottom = 48;
  wrapper.appendChild(table);
  sec.appendChild(wrapper);
  return sec;
}

// Persona breakdown (A/B)
function _buildPersona(breakdown, W) {
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
    const b = 100 - a;

    const row = _vf("prow-" + i, INNER);
    row.paddingTop = 14; row.paddingBottom = 14;
    row.paddingLeft = 20; row.paddingRight = 20;
    row.itemSpacing = 6;

    row.appendChild(_txt(p.segment || "", 12, "Medium", [34, 34, 34], INNER - 40));

    // Bar (two colored rectangles)
    const barWrap = _hf("bar-wrap");
    barWrap.itemSpacing = 0;
    barWrap.counterAxisAlignItems = "CENTER";
    const BAR_W = INNER - 40 - 100;
    if (BAR_W > 0 && a > 0) {
      const ra = figma.createRectangle();
      ra.resize(Math.round(BAR_W * a / 100), 8);
      ra.fills = [{ type: "SOLID", color: _r(59, 130, 246) }];
      ra.cornerRadius = 0;
      barWrap.appendChild(ra);
    }
    if (BAR_W > 0 && b > 0) {
      const rb = figma.createRectangle();
      rb.resize(Math.round(BAR_W * b / 100), 8);
      rb.fills = [{ type: "SOLID", color: _r(245, 158, 11) }];
      rb.cornerRadius = 0;
      barWrap.appendChild(rb);
    }

    const pctRow = _hf("pct-row");
    pctRow.itemSpacing = 8;
    pctRow.appendChild(barWrap);
    pctRow.appendChild(_txt("A " + a + "%", 11, "Medium", [59, 130, 246]));
    pctRow.appendChild(_txt("B " + b + "%", 11, "Medium", [245, 158, 11]));
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
  const root = _vf(
    data.type === "ab" ? "A/B Comparison Report — " + data.date : "UX Review Report — " + data.date,
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
  } else {
    root.appendChild(_buildWinner(data.winner || "TIE", data.winnerReason || "", W));
    root.appendChild(await _buildScreens(data.framesA || [], "02 — GROUP A", "Group A 프레임", W, "a"));
    root.appendChild(await _buildScreens(data.framesB || [], "03 — GROUP B", "Group B 프레임", W, "b"));
    const persona = _buildPersona(data.personaBreakdown, W);
    if (persona) root.appendChild(persona);
    const scorecard = _buildScorecard(data.scores, W);
    if (scorecard) root.appendChild(scorecard);
    root.appendChild(_buildResult(data.detail || "", "06 — ANALYSIS", "상세 분석", W));
  }

  return root;
}
