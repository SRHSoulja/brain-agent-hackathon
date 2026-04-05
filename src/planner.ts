import Anthropic from "@anthropic-ai/sdk";
import type { Task } from "./task-queue.js";
import { log } from "./logger.js";
import { isMockMode, getMockPlan } from "./mock.js";

export interface Step {
  index: number;
  description: string;
  tools_needed: string[];
}

export async function decomposeTask(task: Task): Promise<Step[]> {
  if (isMockMode()) {
    const plan = getMockPlan(task.id);
    if (!plan) throw new Error(`No mock plan for task ${task.id}`);
    log("planner", { task_id: task.id, step_count: plan.length, mode: "mock" });
    return plan;
  }

  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: `You are a task planner for an autonomous agent. Given a task, decompose it into 2-4 concrete execution steps. Each step should use one or more tools from: read_file, write_file, list_files, search_files.

Respond with a JSON array of steps. Each step has:
- "index": step number starting at 1
- "description": what the agent should do in this step
- "tools_needed": which tools this step will use

Be specific. Reference actual file paths from the task description. Keep steps focused and sequential.`,
    messages: [
      {
        role: "user",
        content: `Task: ${task.title}\n\nDescription: ${task.description}\n\nAuthority surfaces (where the agent can write): ${task.authority_surfaces.join(", ")}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("Planner did not return a valid step array");
  }

  const steps: Step[] = JSON.parse(jsonMatch[0]);
  log("planner", { task_id: task.id, step_count: steps.length, mode: "live" });
  return steps;
}
