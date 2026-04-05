import { log } from "./logger.js";

export type EscalationSignal = "CONTINUE" | "STOP";

export interface EscalationState {
  chainDepth: number;
  maxChainDepth: number;
  tasksCompleted: number;
}

export function evaluateEscalation(state: EscalationState): EscalationSignal {
  if (state.chainDepth >= state.maxChainDepth) {
    log("escalation", {
      signal: "STOP",
      reason: `Chain depth ${state.chainDepth} reached limit ${state.maxChainDepth}`,
    });
    return "STOP";
  }

  log("escalation", {
    signal: "CONTINUE",
    chain_depth: state.chainDepth,
    max: state.maxChainDepth,
  });
  return "CONTINUE";
}
