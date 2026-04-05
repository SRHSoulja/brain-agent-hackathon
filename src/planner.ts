import Anthropic from "@anthropic-ai/sdk";
import type { Task } from "./task-queue.js";
import { log } from "./logger.js";
import { isMockMode, getMockPlan } from "./mock.js";

export interface Step {
  index: number;
  description: string;
  tools_needed: string[];
}

function useAmdPlanner(): boolean {
  return process.env.MODEL_PROVIDER === "amd";
}

const PLANNER_SYSTEM = `You are a task planner for an autonomous agent. Given a task, decompose it into 2-4 concrete execution steps. Each step should use one or more tools from: read_file, write_file, list_files, search_files.

Respond with a JSON array of steps. Each step has:
- "index": step number starting at 1
- "description": what the agent should do in this step
- "tools_needed": which tools this step will use

Be specific. Reference actual file paths from the task description. Keep steps focused and sequential. Respond ONLY with the JSON array, no other text.`;

function buildUserPrompt(task: Task): string {
  return `Task: ${task.title}\n\nDescription: ${task.description}\n\nAuthority surfaces (where the agent can write): ${task.authority_surfaces.join(", ")}`;
}

function parseSteps(text: string): Step[] {
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("Planner did not return a valid step array");
  }
  return JSON.parse(jsonMatch[0]);
}

async function planWithClaude(task: Task): Promise<Step[]> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: PLANNER_SYSTEM,
    messages: [{ role: "user", content: buildUserPrompt(task) }],
  });
  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  return parseSteps(text);
}

async function planWithAmd(task: Task): Promise<Step[]> {
  const baseURL = process.env.AMD_API_BASE;
  const apiKey = process.env.AMD_API_KEY ?? "unused";
  const model = process.env.AMD_MODEL ?? "default";

  if (!baseURL) {
    throw new Error(
      "AMD_API_BASE is required when MODEL_PROVIDER=amd (e.g. https://your-instance.amdcloud.com/v1)"
    );
  }

  const res = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [
        { role: "system", content: PLANNER_SYSTEM },
        { role: "user", content: buildUserPrompt(task) },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`AMD API error: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
  };
  const text = data.choices[0]?.message?.content ?? "";
  return parseSteps(text);
}

export async function decomposeTask(task: Task): Promise<Step[]> {
  if (isMockMode()) {
    const plan = getMockPlan(task.id);
    if (!plan) throw new Error(`No mock plan for task ${task.id}`);
    log("planner", { task_id: task.id, step_count: plan.length, mode: "mock" });
    return plan;
  }

  const amd = useAmdPlanner();
  const steps = amd ? await planWithAmd(task) : await planWithClaude(task);
  log("planner", {
    task_id: task.id,
    step_count: steps.length,
    mode: amd ? "amd" : "live",
  });
  return steps;
}
