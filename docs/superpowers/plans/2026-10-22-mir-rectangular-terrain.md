# Mir Rectangular Terrain Implementation Plan

> **For agentic workers:** Execute inline task by task with test-first changes and verify each checkpoint.

**Goal:** Render and export Web maps on the Mir client's 48×32 rectangular logical grid, with terrain boundaries blended continuously across cells.

**Architecture:** Keep map occupancy, collision, and editor coordinates as cell data. Add a small pure terrain helper that derives shared corner coverage from neighboring semantic terrain kinds; the renderer uses those coverage values to composite the existing tile canvases, leaving object sprites upright and anchored to their foot cells. Use independent X/Y cell dimensions everywhere the Web renderer maps cells to pixels. Preserve texture proportions by center-cropping a 3:2 landscape area from each square source atlas cell before resizing.

**Tech Stack:** Browser JavaScript, Canvas 2D, Node built-in test runner, Playwright smoke script.

---

### Task 1: Shared terrain boundary coverage

**Files:**
- Create: `web/js/terrain.js`
- Modify: `web/index.html`
- Test: `server/terrain.test.mjs`

- [x] Write Node VM tests for 48×32 constants, same-kind full coverage, adjacent-kind shared edge coverage, and diagonal corner continuity.
- [x] Run `node --test server/terrain.test.mjs`; confirm missing module/API failures.
- [x] Implement pure helpers to derive four shared vertex coverages and smooth bilinear cell coverage for a terrain kind; load before `render.js`.
- [x] Re-run the focused test and confirm all cases pass.

### Task 2: Mir cell geometry and terrain compositing

**Files:**
- Modify: `web/js/render.js`
- Modify: `web/js/terrain.js`
- Test: `server/terrain.test.mjs`

- [x] Add tests for world dimensions, screen-to-cell and cell-to-screen using 48 horizontal and 32 vertical pixels, plus 96×64 source-cell cropping.
- [x] Draw each cell at 48×32. Compose the base floor, path, water, and wall layers through cached per-kind masks derived from neighboring cells. Keep collision independent and draw each foreground sprite with its existing X/Y span ratio and bottom-center anchor.
- [x] Render PNG at `cols * 48 * scale` by `rows * 32 * scale`; use the same layer composition as the editor.
- [x] Run focused terrain tests and `node server/e2e-smoke.mjs`; inspect the generated screenshot for diagonal roads, water boundaries, foreground overlap, and clipping.

### Task 3: Preserve project and editor behavior

**Files:**
- Modify: `web/js/app.js` only if zoom or status assumes square cells
- Modify: `server/e2e-smoke.mjs` only if assertions need to cover the new client grid
- Test: `server/atlas.test.mjs`, `server/terrain.test.mjs`

- [x] Add an end-to-end assertion that a 48×48 map renders to a 2304×1536 logical-pixel PNG at scale 1 and that screen coordinate round-trips select the original cell.
- [x] Keep map dimensions, selection, collision, undo/redo, and serialized cell arrays unchanged for existing projects.
- [x] Run `node --test server/ai-image.test.mjs server/atlas.test.mjs server/terrain.test.mjs` and `node server/e2e-smoke.mjs`.
- [x] Review the diff and `git diff --check`; state explicitly that `.map` material-library binding remains outside this implementation.
