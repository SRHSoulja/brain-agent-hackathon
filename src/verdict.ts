import type { TaskQueue } from "./task-queue.js";
import { log } from "./logger.js";

export type VerdictStatus = "OK" | "DRIFT" | "BLOCKED";

export interface Verdict {
  status: VerdictStatus;
  reason: string;
  checked_at: string;
}

export async function checkVerdict(queue: TaskQueue): Promise<Verdict> {
  const checked_at = new Date().toISOString();
  const consistency = await queue.verifyStateConsistency();

  if (!consistency.consistent) {
    const verdict: Verdict = {
      status: "DRIFT",
      reason: consistency.reason!,
      checked_at,
    };
    log("verdict", { ...verdict });
    return verdict;
  }

  const verdict: Verdict = {
    status: "OK",
    reason: "Task state is consistent",
    checked_at,
  };
  log("verdict", { ...verdict });
  return verdict;
}

export function verdictAllowsMutation(verdict: Verdict): boolean {
  return verdict.status === "OK";
}
