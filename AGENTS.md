# Repository Guidelines

## Project Structure & Module Organization

- `web/` contains the browser application: `index.html`, `styles.css`, and vanilla JavaScript modules in `web/js/` (store, rendering, editing, atlas generation, AI integration, and exporters).
- `server/` contains the local Node server and automated checks. `dev-server.mjs` serves `web/` and provides the local `/proxy` relay; Python Playwright smoke checks live beside the Node tests.
- `docs/superpowers/` holds design specifications and implementation plans. Keep new notes with the relevant dated document.
- `start-web.bat` launches the app on Windows. Generated screenshots and exports belong under `output/`, not source directories.

## Build, Test, and Development Commands

This static web app has no package manager or compile step.

- `node server/dev-server.mjs` starts the server at `http://127.0.0.1:5173`; set `PORT` to use another port.
- `start-web.bat` starts the server and opens the default browser on Windows.
- `node --test server/ai-image.test.mjs server/atlas.test.mjs server/terrain.test.mjs server/exporters.test.mjs` runs the fast unit and format tests.
- With the server running, `node server/e2e-smoke.mjs` runs the browser regression suite. It requires Python Playwright and Chromium; use `PYTHON`, `CHROME`, or `ATLAS_TEST_URL` to override executables or the URL.

## Coding Style & Naming Conventions

Use two spaces, semicolons, and double-quoted strings in JavaScript, matching existing files. Keep browser modules attached to the shared `window.MG` namespace and preserve module responsibilities. Use `camelCase` for functions and variables, `PascalCase` for constructor-like namespaces, and descriptive `UPPER_SNAKE_CASE` constants. Python smoke scripts use four-space indentation and `snake_case` names. No formatter or linter is configured, so keep diffs focused and match nearby style.

## Testing Guidelines

Node tests use the built-in `node:test` runner and are named `*.test.mjs`. Add deterministic assertions for new atlas, terrain, storage, or export behavior; use fixed seeds where randomness is involved. UI or browser behavior belongs in `server/atlas-smoke.py`, with artifacts written to `output/atlas-review/`.

## Commit & Pull Request Guidelines

This checkout has no Git history available to infer a convention. Use short, imperative subjects such as `Fix rectangular terrain export`, and keep commits focused. Pull requests should describe user-visible behavior, list verification commands, link the relevant issue or plan when one exists, and include screenshots or exported samples for UI or rendering changes.

## Security & Configuration Tips

AI configuration is stored in browser `localStorage`; never commit API keys or generated secrets. Keep the development proxy bound to localhost and do not expose it as a production endpoint without adding authentication and upstream restrictions.
