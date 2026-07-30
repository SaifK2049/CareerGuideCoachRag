import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const run = (args) => execFileSync("npx", ["supabase", ...args], { cwd: root, stdio: "inherit" });

try {
  run(["start"]);
} catch (error) {
  if (error.status !== 0) throw error;
}
run(["db", "reset", "--local", "--no-seed", "--yes"]);
execFileSync(process.execPath, ["scripts/demo-data.mjs"], { cwd: root, stdio: "inherit" });
console.log("Local demo setup complete. Start the UI with: npm run dev");
