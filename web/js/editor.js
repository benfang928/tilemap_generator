/* editor.js — 画布交互：画笔 / 橡皮 / 填充 / 吸管 / 矩形 / 阻挡 / 物件 / 平移 */
(function () {
  const MG = window.MG;
  const U = MG.U;
  const E = (MG.Editor = {});

  E.tool = "brush";
  E.hover = { x: -1, y: -1 };
  E.rect = null;
  E.dragging = false;
  E.panning = false;
  E.spaceDown = false;
  E.active = false; // 仅第 4 步启用绘制

  const TOOL_NAMES = {
    brush: "画笔", eraser: "橡皮", fill: "填充", picker: "吸管",
    rect: "矩形", collision: "阻挡", object: "物件", pan: "平移",
  };

  E.toolName = (t) => TOOL_NAMES[t] || t;

  E.setTool = function (tool) {
    E.tool = tool;
    U.$$("#toolbar .tool").forEach((b) => b.classList.toggle("active", b.dataset.tool === tool));
    const st = U.$("#stTool");
    if (st) st.textContent = "工具：" + E.toolName(tool);
    if (MG.Render.canvas) MG.Render.canvas.classList.toggle("painting", E.active && tool !== "pan");
  };

  function localPos(ev) {
    const r = MG.Render.canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  E.init = function (canvas) {
    canvas.addEventListener("pointerdown", (ev) => {
      if (!E.active) return;
      const pos = localPos(ev);
      const cell = MG.Render.screenToCell(pos.x, pos.y);
      const isPan = E.tool === "pan" || E.spaceDown || ev.button === 1 || ev.button === 2;

      if (isPan) {
        E.panning = true;
        E.panStart = { x: pos.x, y: pos.y, camX: MG.Render.view.camX, camY: MG.Render.view.camY };
        canvas.classList.add("panning");
        canvas.setPointerCapture(ev.pointerId);
        return;
      }

      const p = MG.Store.ensure();
      if (cell.x < 0 || cell.y < 0 || cell.x >= p.cols || cell.y >= p.rows) return;

      if (E.tool === "picker") {
        const ti = MG.Store.tileAt(cell.x, cell.y);
        if (ti >= 0) {
          MG.App.selectTile(ti);
          U.toast("已吸取地砖：" + (p.tiles[ti] ? p.tiles[ti].name : ti));
        }
        return;
      }

      if (!MG.Store.history.stack.length) MG.Store.history.push("初始状态");
      if (E.tool === "rect") {
        E.rect = { x0: cell.x, y0: cell.y, x1: cell.x, y1: cell.y };
        E.dragging = true;
        canvas.setPointerCapture(ev.pointerId);
        MG.App.invalidate();
        return;
      }

      // 在操作结束后保存结果，撤销和重做使用完整的笔画快照。
      E.dragging = true;
      canvas.setPointerCapture(ev.pointerId);
      apply(cell.x, cell.y, ev.shiftKey);
      MG.App.invalidate();
    });

    canvas.addEventListener("pointermove", (ev) => {
      const pos = localPos(ev);
      const cell = MG.Render.screenToCell(pos.x, pos.y);
      const p = MG.Store.ensure();
      const inside = cell.x >= 0 && cell.y >= 0 && cell.x < p.cols && cell.y < p.rows;
      E.hover = inside ? cell : { x: -1, y: -1 };

      if (E.panning) {
        MG.Render.view.camX = E.panStart.camX + (pos.x - E.panStart.x);
        MG.Render.view.camY = E.panStart.camY + (pos.y - E.panStart.y);
        MG.App.invalidate();
        return;
      }

      if (E.dragging && E.active) {
        if (E.tool === "rect") {
          if (inside) {
            E.rect.x1 = cell.x;
            E.rect.y1 = cell.y;
          }
        } else if (inside && (E.tool === "brush" || E.tool === "eraser" || E.tool === "collision" || E.tool === "object")) {
          apply(cell.x, cell.y, ev.shiftKey);
        }
        MG.App.invalidate();
      } else if (E.active) {
        MG.App.invalidate();
      }
      MG.App.updateStatus(cell);
    });

    const end = (ev) => {
      if (E.panning) {
        E.panning = false;
        canvas.classList.remove("panning");
      }
      if (E.dragging && E.tool === "rect" && E.rect) {
        commitRect(ev.shiftKey);
      } else if (E.dragging) {
        MG.Store.history.push(E.toolName(E.tool));
      }
      E.dragging = false;
      if (MG.App) MG.App.invalidate();
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("pointerleave", () => {
      if (!E.dragging) {
        E.hover = { x: -1, y: -1 };
        MG.App && MG.App.invalidate();
      }
    });
    canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());

    canvas.addEventListener(
      "wheel",
      (ev) => {
        if (!E.active && MG.App.step !== 1 && MG.App.step !== 2 && MG.App.step !== 3) return;
        ev.preventDefault();
        const pos = localPos(ev);
        const factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
        MG.Render.zoomAt(factor, pos.x, pos.y);
        MG.App.syncZoomLabel();
        MG.App.invalidate();
      },
      { passive: false }
    );
  };

  function apply(x, y, shift) {
    const p = MG.Store.ensure();
    switch (E.tool) {
      case "brush": {
        const ti = MG.App.selectedTile;
        if (ti >= 0 && ti < p.tiles.length) MG.Store.setTile(x, y, ti);
        break;
      }
      case "eraser":
        MG.Store.setTile(x, y, -1);
        MG.Store.setCollision(x, y, 0);
        break;
      case "collision": {
        const cur = p.collision[y * p.cols + x];
        MG.Store.setCollision(x, y, shift ? (cur === 2 ? 0 : 2) : cur ? 0 : 1);
        break;
      }
      case "fill": {
        const ti = MG.App.selectedTile;
        if (ti >= 0 && ti < p.tiles.length) E.floodFill(x, y, ti);
        break;
      }
      case "object": {
        if (shift) MG.Store.setObject(x, y, -1);
        else if (MG.App.selectedObject >= 0) MG.Store.setObject(x, y, MG.App.selectedObject);
        break;
      }
    }
  }

  function commitRect(shift) {
    const r = E.rect;
    E.rect = null;
    if (!r) return;
    const p = MG.Store.ensure();
    const ax = Math.max(0, Math.min(r.x0, r.x1));
    const ay = Math.max(0, Math.min(r.y0, r.y1));
    const bx = Math.min(p.cols - 1, Math.max(r.x0, r.x1));
    const by = Math.min(p.rows - 1, Math.max(r.y0, r.y1));
    for (let y = ay; y <= by; y++) {
      for (let x = ax; x <= bx; x++) {
        if (E.tool === "rect") {
          if (shift) {
            MG.Store.setTile(x, y, -1);
          } else if (MG.App.selectedTile >= 0) {
            MG.Store.setTile(x, y, MG.App.selectedTile);
          }
        }
      }
    }
    MG.Store.history.push("矩形");
    MG.App.invalidate();
  }

  E.floodFill = function (x, y, tileIndex) {
    const p = MG.Store.ensure();
    const target = p.back[y * p.cols + x];
    if (target === tileIndex) return;
    const stack = [[x, y]];
    const seen = new Uint8Array(p.cols * p.rows);
    let guard = 0;
    while (stack.length && guard++ < p.cols * p.rows * 2) {
      const [cx, cy] = stack.pop();
      if (cx < 0 || cy < 0 || cx >= p.cols || cy >= p.rows) continue;
      const i = cy * p.cols + cx;
      if (seen[i]) continue;
      if (p.back[i] !== target) continue;
      seen[i] = 1;
      MG.Store.setTile(cx, cy, tileIndex);
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
  };
})();
