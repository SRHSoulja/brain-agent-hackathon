import { readdir, readFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import type { ToolDefinition, ToolResult } from "./index.js";

async function walkDir(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDir(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

export const searchFilesTool: ToolDefinition = {
  name: "search_files",
  description:
    "Search for a text pattern across files in a workspace directory. Returns matching lines with file paths and line numbers.",
  input_schema: {
    type: "object" as const,
    properties: {
      pattern: {
        type: "string",
        description: "Text or regex pattern to search for",
      },
      directory: {
        type: "string",
        description:
          "Relative directory within workspace to search (e.g. 'docs' or '.')",
      },
    },
    required: ["pattern", "directory"],
  },

  async execute(
    input: Record<string, unknown>,
    workspaceRoot: string
  ): Promise<ToolResult> {
    const pattern = String(input.pattern);
    const relDir = String(input.directory);
    if (relDir.includes("..")) {
      return { success: false, output: "Path traversal not allowed" };
    }
    const absDir = resolve(workspaceRoot, "workspace", relDir);
    if (!absDir.startsWith(resolve(workspaceRoot, "workspace"))) {
      return { success: false, output: "Path outside workspace" };
    }

    try {
      const regex = new RegExp(pattern, "gi");
      const files = await walkDir(absDir);
      const wsRoot = resolve(workspaceRoot, "workspace");
      const matches: string[] = [];

      for (const file of files) {
        const content = await readFile(file, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            const rel = relative(wsRoot, file);
            matches.push(`${rel}:${i + 1}: ${lines[i]}`);
          }
          regex.lastIndex = 0;
        }
      }

      return {
        success: true,
        output:
          matches.length > 0
            ? matches.join("\n")
            : `No matches for '${pattern}' in ${relDir}`,
      };
    } catch (e) {
      return {
        success: false,
        output: `Search failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
};
