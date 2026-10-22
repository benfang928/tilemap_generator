# Two Atlases Implementation Plan

> Execute inline in the existing workspace; the web files are currently untracked in the parent repository and must remain available to the running local server.

**Goal:** Generate two structured sprite sheets, extract reusable assets, and build editable maps without recognizing a complete illustration.

**Architecture:** Add `MG.Atlas` for the fixed manifest, generation prompts, extraction, demo sheets, and seeded layout. Keep `MG.AI.generateImage` as the provider layer and reuse the existing editor, rendering and exporters.

**Tech Stack:** Browser Canvas 2D, plain JavaScript, Node built-in test runner, Python Playwright.

## Tasks

- [x] Add failing Node tests in `server/atlas.test.mjs`: manifest slot counts/kinds, distinct sheet prompts, seeded layouts, collision validity, persistence and legacy loading.
- [x] Implement `web/js/atlas.js`: `plan(opts)`, `prompt(plan,type)`, `extract(opts)`, `layout(opts)` and `demo(plan,type,size)`; load before `app.js`.
- [x] Update `web/js/assemble.js` to route atlas projects to seeded layout while preserving legacy callers. Restrict random tile variants to matching terrain groups.
- [x] Extend `web/js/store.js` with atlas metadata and object span serialization, reset obsolete analysis on load, and preserve old projects.
- [x] Update `web/index.html`, `web/styles.css`, `web/js/app.js`: two sheet selectors/previews, independent generation/upload, adjustable extraction, new workflow labels, saved-sheet restoration, clean invalidation and help.
- [x] Run `node --test server/ai-image.test.mjs server/atlas.test.mjs` and syntax checks for changed scripts.
- [x] Add `server/atlas-smoke.py`: demo generation, extraction, pixel transparency/aspect tests, seeded assembly, regeneration invalidation, partial API failure, save/load and legacy load. Verify real DOM and capture screenshots under `output/atlas-review/`.
- [x] Run browser checks against the local server, inspect screenshots, fix any failures, then report the completed flow and verification evidence.

## Verification

- Node regression suite: 12 passed, 0 failed (image responses, manifests, terrain preferences, seeded layout, collision, persistence and bridges).
- JavaScript syntax checks passed for all changed modules.
- Browser workflow passed via node server/e2e-smoke.mjs, including transparency, nondefault parameter restoration, paint/undo/redo, first edit after import, busy import guard, exports, partial failure retry and legacy projects.
- Existing live provider outputs: both generation requests returned HTTP 200; original JSON responses and PNG sheets are retained under output/atlas-review/live/.
- Independent review findings were fixed and covered by regression checks.
