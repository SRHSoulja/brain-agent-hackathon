import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ToolDefinition, ToolResult } from "./index.js";

export const readFileTool: ToolDefinition = {
  name: "read_file",
  description:
    "Read the contents of a file from the workspace. Returns the file text. Use this to understand existing documents, code, and data before making decisions.",
  input_schema: {
    type: "object" as const,
    properties: {
      path: {
        type: "string",
        description:
          "Relative path within the workspace directory (e.g. 'docs/api-spec.md')",
      },
    },
    required: ["path"],
  },

  async execute(
    input: Record<string, unknown>,
    workspaceRoot: string
  ): Promise<ToolResult> {
    let relPath = String(input.path);
    // Normalize: strip leading workspace/ if the LLM includes it
    relPath = relPath.replace(/^workspace\//, "");
    if (relPath.includes("..")) {
      return { success: false, output: "Path traversal not allowed" };
    }
    const absPath = resolve(workspaceRoot, "workspace", relPath);
    if (!absPath.startsWith(resolve(workspaceRoot, "workspace"))) {
      return { success: false, output: "Path outside workspace" };
    }
    try {
      const content = await readFile(absPath, "utf-8");
      return { success: true, output: content };
    } catch {
      return { success: false, output: `File not found: ${relPath}` };
    }
  },
};
