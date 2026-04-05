import { resolve } from "node:path";
import { initLogger } from "./logger.js";
import { runAgent } from "./agent.js";
import { isMockMode } from "./mock.js";

const ROOT = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);

const demoVerdictFail = args.includes("--demo-verdict-fail");
const maxChainDepth = parseInt(
  args.find((a) => a.startsWith("--max-chain="))?.split("=")[1] ?? "10",
  10
);
const mode = isMockMode() ? "mock (deterministic)" : "live (Claude API)";

console.log(`
  ____            _            _                    _
 | __ ) _ __ __ _(_)_ __      / \\   __ _  ___ _ __ | |_
 |  _ \\| '__/ _\` | | '_ \\   / _ \\ / _\` |/ _ \\ '_ \\| __|
 | |_) | | | (_| | | | | | / ___ \\ (_| |  __/ | | | |_
 |____/|_|  \\__,_|_|_| |_|/_/   \\_\\__, |\\___|_| |_|\\__|
                                   |___/
 Autonomous Task Orchestration Agent
 ====================================
 Mode:         ${mode}
 Chain limit:  ${maxChainDepth}
 Verdict gate: enabled
 Demo:         ${demoVerdictFail ? "verdict-fail injection" : "normal"}
`);

initLogger(ROOT);

runAgent({
  root: ROOT,
  maxChainDepth,
  demoVerdictFail,
}).catch((err) => {
  console.error("Fatal agent error:", err);
  process.exit(1);
});
