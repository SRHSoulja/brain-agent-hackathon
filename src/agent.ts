import Anthropic from "@anthropic-ai/sdk";
import { TaskQueue, type Task } from "./task-queue.js";
import { decomposeTask } from "./planner.js";
import { executeStep, initMockForTask } from "./executor.js";
import { checkVerdict, verdictAllowsMutation } from "./verdict.js";
import {
  evaluateEscalation,
  type EscalationState,
} from "./escalation.js";
import { log } from "./logger.js";
import { isMockMode } from "./mock.js";

export interface AgentConfig {
  root: string;
  maxChainDepth: number;
  demoVerdictFail: boolean;
}

export async function runAgent(config: AgentConfig): Promise<void> {
  const queue = new TaskQueue(config.root);
  const escalation: EscalationState = {
    chainDepth: 0,
    maxChainDepth: config.maxChainDepth,
    tasksCompleted: 0,
  };

  const mode = isMockMode() ? "mock" : "live";
  log("agent_start", {
    max_chain_depth: config.maxChainDepth,
    demo_verdict_fail: config.demoVerdictFail,
    mode,
  });

  // Initial verdict check
  const initialVerdict = await checkVerdict(queue);
  if (!verdictAllowsMutation(initialVerdict)) {
    log("agent_stop", {
      reason: `Initial verdict: ${initialVerdict.status} - ${initialVerdict.reason}`,
    });
    console.log(
      "\nAgent cannot start: task state is inconsistent. Resolve the issue and retry."
    );
    return;
  }

  while (true) {
    // Get next eligible task
    const task = await queue.getNextTask();
    if (!task) {
      log("agent_stop", { reason: "No more eligible tasks in queue" });
      console.log("\nAll tasks processed. Agent stopping.");
      break;
    }

    // Claim it
    const claimed = await queue.claimTask(task.id);
    log("task_claim", { task_id: claimed.id, title: claimed.title });

    // If demo mode, corrupt state after first task completes
    if (config.demoVerdictFail && escalation.tasksCompleted === 1) {
      await injectStateCorruption(config.root, claimed.id);
    }

    try {
      // Initialize mock for this task if in mock mode
      if (isMockMode()) {
        initMockForTask(claimed.id);
      }

      // Decompose into steps
      const steps = await decomposeTask(claimed);

      // Execute each step with a shared conversation context
      const conversationHistory: Anthropic.MessageParam[] = [];
      let lastOutput = "";

      for (const step of steps) {
        const result = await executeStep(
          claimed,
          step,
          queue,
          config.root,
          conversationHistory
        );
        lastOutput = result.output;
        if (!result.success) {
          throw new Error(`Step ${step.index} failed: ${result.output}`);
        }
      }

      // Complete the task
      await queue.completeTask(claimed.id, lastOutput);
      log("task_complete", { task_id: claimed.id });
      escalation.chainDepth++;
      escalation.tasksCompleted++;
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      await queue.failTask(claimed.id, reason);
      log("task_fail", { task_id: claimed.id, reason });
      escalation.chainDepth++;
      escalation.tasksCompleted++;
    }

    // Escalation check
    const signal = evaluateEscalation(escalation);
    if (signal === "STOP") {
      log("agent_stop", {
        reason: `Escalation: STOP (chain depth ${escalation.chainDepth})`,
      });
      console.log(
        `\nAgent stopping: chain depth limit reached (${escalation.chainDepth}/${escalation.maxChainDepth}). Human review recommended.`
      );
      break;
    }
  }

  // Final summary
  const completed = await queue.listTasks("completed");
  const failed = completed.filter((t) => t.status === "failed").length;
  const succeeded = completed.length - failed;
  console.log(
    `\n--- Agent Summary ---\nTasks succeeded: ${succeeded}\nTasks failed: ${failed}\nChain depth: ${escalation.chainDepth}\nLogs: logs/events.jsonl\n`
  );
}

async function injectStateCorruption(
  root: string,
  activeTaskId: string
): Promise<void> {
  const { writeFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const corruptTask = {
    id: activeTaskId,
    title: "CORRUPTED DUPLICATE",
    status: "queued",
    priority: "P1",
    authority_surfaces: [],
    depends_on: [],
    created_at: new Date().toISOString(),
  };
  await writeFile(
    resolve(root, "tasks", "queue", `${activeTaskId}.json`),
    JSON.stringify(corruptTask, null, 2)
  );
  console.log(
    "\n\x1b[31m[DEMO] Injected state corruption: duplicate task across stages\x1b[0m\n"
  );
}
