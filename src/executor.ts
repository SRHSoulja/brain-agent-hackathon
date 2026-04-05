import Anthropic from "@anthropic-ai/sdk";
import type { Task } from "./task-queue.js";
import type { Step } from "./planner.js";
import { findTool, getToolSchemas } from "./tools/index.js";
import { checkVerdict, verdictAllowsMutation } from "./verdict.js";
import type { TaskQueue } from "./task-queue.js";
import { log } from "./logger.js";
import { isMockMode, MockLLM } from "./mock.js";

// Shared mock instance across steps within a task
let activeMock: MockLLM | null = null;

export function initMockForTask(taskId: string): void {
  activeMock = new MockLLM();
  activeMock.loadTask(taskId);
}

export async function executeStep(
  task: Task,
  step: Step,
  queue: TaskQueue,
  workspaceRoot: string,
  conversationHistory: Anthropic.MessageParam[]
): Promise<{ success: boolean; output: string }> {
  log("step", {
    task_id: task.id,
    index: step.index,
    description: step.description,
  });

  if (isMockMode()) {
    return executeMockStep(task, step, queue, workspaceRoot);
  }

  return executeLiveStep(task, step, queue, workspaceRoot, conversationHistory);
}

// --- Mock execution path ---

async function executeMockStep(
  task: Task,
  step: Step,
  queue: TaskQueue,
  workspaceRoot: string
): Promise<{ success: boolean; output: string }> {
  if (!activeMock) {
    return { success: false, output: "Mock not initialized for task" };
  }

  let output = "";

  // The mock script alternates: tool_calls turn, then text turn per step
  while (true) {
    const response = activeMock.nextResponse(task.id);
    if (!response) break;

    if (response.type === "text") {
      output = response.text;
      break;
    }

    // Execute the mock tool calls through the real tool layer
    for (const call of response.calls) {
      const tool = findTool(call.name);
      if (!tool) {
        log("tool_call", { tool: call.name, input: call.input, task_id: task.id });
        continue;
      }

      log("tool_call", { tool: call.name, input: call.input, task_id: task.id });

      // Verdict gate for writes
      if (call.name === "write_file") {
        const verdict = await checkVerdict(queue);
        if (!verdictAllowsMutation(verdict)) {
          const msg = `VERDICT GATE BLOCKED: Write rejected. State is ${verdict.status}: ${verdict.reason}`;
          log("tool_result", {
            tool: call.name,
            success: false,
            bytes: msg.length,
            task_id: task.id,
          });
          return { success: false, output: msg };
        }
      }

      const result = await tool.execute(call.input, workspaceRoot, task.authority_surfaces);
      log("tool_result", {
        tool: call.name,
        success: result.success,
        bytes: result.output.length,
        task_id: task.id,
      });

      if (!result.success) {
        return { success: false, output: result.output };
      }
    }
  }

  return { success: true, output };
}

// --- Live API execution path ---

async function executeLiveStep(
  task: Task,
  step: Step,
  queue: TaskQueue,
  workspaceRoot: string,
  conversationHistory: Anthropic.MessageParam[]
): Promise<{ success: boolean; output: string }> {
  const client = new Anthropic();

  conversationHistory.push({
    role: "user",
    content: `Execute step ${step.index}: ${step.description}\n\nUse the available tools to complete this step. The workspace contains files you can read and write.`,
  });

  let output = "";
  let iterations = 0;
  const maxIterations = 10;
  const writeCounts = new Map<string, number>();
  const maxWritesPerPath = 2;

  while (iterations < maxIterations) {
    iterations++;

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: `You are an autonomous execution agent. You have tools to interact with a workspace filesystem. Complete the requested step using the tools. When you have finished the step, respond with a text summary of what you did. Do not ask questions -- just execute.`,
      tools: getToolSchemas() as Anthropic.Tool[],
      messages: conversationHistory,
    });

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ContentBlock & { type: "tool_use" } =>
        b.type === "tool_use"
    );
    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );

    if (textBlocks.length > 0) {
      output = textBlocks.map((b) => b.text).join("\n");
    }

    if (toolUseBlocks.length === 0) {
      conversationHistory.push({ role: "assistant", content: response.content });
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of toolUseBlocks) {
      const tool = findTool(block.name);
      if (!tool) {
        log("tool_call", { tool: block.name, input: block.input, task_id: task.id });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Unknown tool: ${block.name}`,
          is_error: true,
        });
        continue;
      }

      log("tool_call", { tool: block.name, input: block.input, task_id: task.id });

      if (block.name === "write_file") {
        const writePath = String((block.input as Record<string, unknown>).path ?? "");
        const count = (writeCounts.get(writePath) ?? 0) + 1;
        writeCounts.set(writePath, count);
        if (count > maxWritesPerPath) {
          const msg = `REPEATED WRITE BLOCKED: "${writePath}" already written ${maxWritesPerPath} time(s) this step. Likely loop -- move on.`;
          log("tool_result", { tool: block.name, success: false, bytes: msg.length, task_id: task.id });
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: msg,
            is_error: true,
          });
          continue;
        }

        const verdict = await checkVerdict(queue);
        if (!verdictAllowsMutation(verdict)) {
          const msg = `VERDICT GATE BLOCKED: Write rejected. State is ${verdict.status}: ${verdict.reason}`;
          log("tool_result", { tool: block.name, success: false, bytes: msg.length, task_id: task.id });
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: msg,
            is_error: true,
          });
          continue;
        }
      }

      const result = await tool.execute(
        block.input as Record<string, unknown>,
        workspaceRoot,
        task.authority_surfaces
      );

      log("tool_result", {
        tool: block.name,
        success: result.success,
        bytes: result.output.length,
        task_id: task.id,
      });

      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: result.output,
        is_error: !result.success,
      });
    }

    conversationHistory.push({ role: "assistant", content: response.content });
    conversationHistory.push({ role: "user", content: toolResults });
  }

  if (iterations >= maxIterations) {
    return { success: false, output: `Step exhausted ${maxIterations} iterations without completing` };
  }

  return { success: true, output };
}
