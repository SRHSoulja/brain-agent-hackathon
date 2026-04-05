import { readFileTool } from "./read-file.js";
import { writeFileTool } from "./write-file.js";
import { listFilesTool } from "./list-files.js";
import { searchFilesTool } from "./search-files.js";

export interface ToolResult {
  success: boolean;
  output: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
  execute(
    input: Record<string, unknown>,
    workspaceRoot: string,
    authoritySurfaces?: string[]
  ): Promise<ToolResult>;
}

export const ALL_TOOLS: ToolDefinition[] = [
  readFileTool,
  writeFileTool,
  listFilesTool,
  searchFilesTool,
];

export function getToolSchemas() {
  return ALL_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}

export function findTool(name: string): ToolDefinition | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}
