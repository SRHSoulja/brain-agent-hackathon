import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

let logDir = "";

export function initLogger(root: string) {
  logDir = resolve(root, "logs");
  mkdirSync(logDir, { recursive: true });
}

export function log(event: string, data: Record<string, unknown>) {
  const entry = {
    ts: new Date().toISOString(),
    event,
    ...data,
  };
  const line = JSON.stringify(entry) + "\n";

  // Write to file
  if (logDir) {
    appendFileSync(resolve(logDir, "events.jsonl"), line);
  }

  // Console output with color
  const color = EVENT_COLORS[event] ?? "\x1b[0m";
  const reset = "\x1b[0m";
  const dim = "\x1b[2m";
  const ts = dim + entry.ts.slice(11, 19) + reset;

  const label = color + `[${event}]` + reset;
  const detail = formatDetail(event, data);

  console.log(`${ts} ${label} ${detail}`);
}

const EVENT_COLORS: Record<string, string> = {
  agent_start: "\x1b[36m", // cyan
  task_claim: "\x1b[33m", // yellow
  task_complete: "\x1b[32m", // green
  task_fail: "\x1b[31m", // red
  step: "\x1b[35m", // magenta
  tool_call: "\x1b[34m", // blue
  tool_result: "\x1b[34m",
  verdict: "\x1b[36m",
  escalation: "\x1b[33m",
  agent_stop: "\x1b[36m",
  planner: "\x1b[35m",
};

function formatDetail(event: string, data: Record<string, unknown>): string {
  switch (event) {
    case "task_claim":
      return `${data.task_id}: ${data.title}`;
    case "task_complete":
      return `${data.task_id} completed`;
    case "task_fail":
      return `${data.task_id} FAILED: ${data.reason}`;
    case "tool_call":
      return `${data.tool}(${JSON.stringify(data.input).slice(0, 80)})`;
    case "tool_result":
      return `${data.tool} -> ${data.success ? "ok" : "FAIL"} (${data.bytes}b)`;
    case "verdict":
      return `${data.status}: ${data.reason}`;
    case "escalation":
      return `${data.signal} (depth ${data.chain_depth ?? data.reason ?? ""})`;
    case "step":
      return `Step ${data.index}: ${data.description}`;
    case "planner":
      return `Decomposed into ${data.step_count} steps`;
    default:
      return JSON.stringify(data);
  }
}
