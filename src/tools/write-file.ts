import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import type { ToolDefinition, ToolResult } from "./index.js";

export const writeFileTool: ToolDefinition = {
  name: "write_file",
  description:
    "Write content to a file in the workspace. Creates parent directories if needed. This tool is gated by the verdict check -- writes will be blocked if task state is inconsistent.",
  input_schema: {
    type: "object" as const,
    properties: {
      path: {
        type: "string",
        description:
          "Relative path within the workspace directory (e.g. 'summaries/brief.md')",
      },
      content: {
        type: "string",
        description: "The full content to write to the file",
      },
    },
    required: ["path", "content"],
  },

  async execute(
    input: Record<string, unknown>,
    workspaceRoot: string,
    authoritySurfaces?: string[]
  ): Promise<ToolResult> {
    const relPath = String(input.path);
    const content = String(input.content);

    if (relPath.includes("..")) {
      return { success: false, output: "Path traversal not allowed" };
    }

    const absPath = resolve(workspaceRoot, "workspace", relPath);
    if (!absPath.startsWith(resolve(workspaceRoot, "workspace"))) {
      return { success: false, output: "Path outside workspace" };
    }

    // Authority surface check
    if (authoritySurfaces && authoritySurfaces.length > 0) {
      const fullRelPath = "workspace/" + relPath;
      const allowed = authoritySurfaces.some((surface) =>
        fullRelPath.startsWith(surface)
      );
      if (!allowed) {
        return {
          success: false,
          output: `Write blocked: '${fullRelPath}' is outside declared authority surfaces [${authoritySurfaces.join(", ")}]`,
        };
      }
    }

    try {
      await mkdir(dirname(absPath), { recursive: true });
      await writeFile(absPath, content, "utf-8");
      return {
        success: true,
        output: `Written ${content.length} bytes to ${relPath}`,
      };
    } catch (e) {
      return {
        success: false,
        output: `Write failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
};
