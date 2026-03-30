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

  if (msg.type === "close-plugin") {
    figma.closePlugin();
  }
};
