import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Keep the documented Node entry point for the current browser workflow.
const result = spawnSync(process.env.PYTHON || "python", [
  fileURLToPath(new URL("./atlas-smoke.py", import.meta.url)),
], { stdio: "inherit", env: process.env });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
