import { readdir, stat } from "node:fs/promises";
import { resolve, relative } from "node:path";
import type { ToolDefinition, ToolResult } from "./index.js";

export const listFilesTool: ToolDefinition = {
  name: "list_files",
  description:
    "List files and directories within a workspace directory. Returns paths relative to workspace root.",
  input_schema: {
    type: "object" as const,
    properties: {
      directory: {
        type: "string",
        description:
          "Relative directory path within workspace (e.g. 'docs' or '.')",
      },
    },
    required: ["directory"],
  },

  async execute(
    input: Record<string, unknown>,
    workspaceRoot: string
  ): Promise<ToolResult> {
    const relDir = String(input.directory);
    if (relDir.includes("..")) {
      return { success: false, output: "Path traversal not allowed" };
    }
    const absDir = resolve(workspaceRoot, "workspace", relDir);
    if (!absDir.startsWith(resolve(workspaceRoot, "workspace"))) {
      return { success: false, output: "Path outside workspace" };
    }
    try {
      const entries = await readdir(absDir, { withFileTypes: true });
      const wsRoot = resolve(workspaceRoot, "workspace");
      const lines = entries.map((e) => {
        const rel = relative(wsRoot, resolve(absDir, e.name));
        return e.isDirectory() ? `${rel}/` : rel;
      });
      return {
        success: true,
        output: lines.length > 0 ? lines.join("\n") : "(empty directory)",
      };
    } catch {
      return { success: false, output: `Directory not found: ${relDir}` };
    }
  },
};
