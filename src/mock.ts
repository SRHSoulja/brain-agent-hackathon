/**
 * Deterministic mock LLM for offline demo.
 * Produces fixed step plans and tool-call sequences for the 3 seeded tasks.
 * Activated by MOCK_LLM=1 environment variable.
 */

import type { Step } from "./planner.js";

export function isMockMode(): boolean {
  return process.env.MOCK_LLM === "1";
}

// --- Mock planner: fixed step decompositions per task ---

const MOCK_PLANS: Record<string, Step[]> = {
  "task-001": [
    {
      index: 1,
      description:
        "Read the API specification and project requirements documents",
      tools_needed: ["read_file"],
    },
    {
      index: 2,
      description:
        "Synthesize a requirements brief covering endpoints, constraints, and validation rules",
      tools_needed: ["write_file"],
    },
  ],
  "task-002": [
    {
      index: 1,
      description: "Read the requirements brief produced by task-001",
      tools_needed: ["read_file"],
    },
    {
      index: 2,
      description:
        "Generate a TypeScript input validation module enforcing all documented constraints",
      tools_needed: ["write_file"],
    },
  ],
  "task-003": [
    {
      index: 1,
      description:
        "Read the generated validation code and the requirements brief",
      tools_needed: ["read_file"],
    },
    {
      index: 2,
      description:
        "Write a review report assessing coverage of each constraint",
      tools_needed: ["write_file"],
    },
  ],
};

export function getMockPlan(taskId: string): Step[] | null {
  return MOCK_PLANS[taskId] ?? null;
}

// --- Mock executor: deterministic tool-call sequences ---

interface MockToolCall {
  name: string;
  input: Record<string, unknown>;
}

interface MockTurn {
  tool_calls?: MockToolCall[];
  text?: string;
}

type MockScript = MockTurn[];

const SUMMARY_BRIEF = `# API Requirements Brief

## Endpoints
- POST /api/v1/widgets -- Create widget (name, type, config)
- GET /api/v1/widgets/:id -- Retrieve by UUID v4
- PATCH /api/v1/widgets/:id -- Partial update
- DELETE /api/v1/widgets/:id -- Irreversible delete

## Validation Constraints
1. name: 3-50 chars, alphanumeric + hyphens, unique (case-insensitive)
2. type: one of standard | premium | enterprise
3. config.maxRetries: integer 1-10 (capped at 3 for standard widgets)
4. config.timeout: integer 100-30000ms (minimum 5000ms for premium)
5. config.tags: string[] max 5 items, each 1-20 chars, lowercase alphanumeric only
6. Enterprise widgets must have at least 2 tags

## Security Rules
- Trim all string inputs
- Reject XSS patterns: <script, javascript:, data:text/html
- Widget IDs must match UUID v4 regex

## Behavioral Rules
- Return all validation errors in a single response (no short-circuit)
- Validation must be stateless and complete in under 5ms
- Uniqueness checking is separate from input validation
`;

const VALIDATION_MODULE = `/**
 * Input validation for the Widget API.
 * Stateless, returns all errors at once, completes in <5ms.
 */

interface ValidationError {
  field: string;
  message: string;
}

interface WidgetInput {
  name?: string;
  type?: string;
  config?: {
    maxRetries?: number;
    timeout?: number;
    tags?: string[];
  };
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const XSS_PATTERNS = [/<script/i, /javascript:/i, /data:text\\/html/i];
const NAME_PATTERN = /^[a-zA-Z0-9-]{3,50}$/;
const TAG_PATTERN = /^[a-z0-9]{1,20}$/;

function containsXSS(value: string): boolean {
  return XSS_PATTERNS.some((p) => p.test(value));
}

function trimInput(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "");
}

export function validateWidgetId(id: string): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!UUID_V4.test(id)) {
    errors.push({ field: "id", message: "Must be a valid UUID v4" });
  }
  return errors;
}

export function validateWidgetInput(
  input: WidgetInput,
  partial = false
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Name validation
  if (input.name !== undefined) {
    const name = trimInput(input.name);
    if (containsXSS(name)) {
      errors.push({ field: "name", message: "Input contains forbidden pattern" });
    } else if (!NAME_PATTERN.test(name)) {
      errors.push({
        field: "name",
        message: "Must be 3-50 alphanumeric characters or hyphens",
      });
    }
  } else if (!partial) {
    errors.push({ field: "name", message: "Required" });
  }

  // Type validation
  const validTypes = ["standard", "premium", "enterprise"];
  if (input.type !== undefined) {
    if (!validTypes.includes(input.type)) {
      errors.push({
        field: "type",
        message: "Must be one of: standard, premium, enterprise",
      });
    }
  } else if (!partial) {
    errors.push({ field: "type", message: "Required" });
  }

  // Config validation
  if (input.config) {
    const { maxRetries, timeout, tags } = input.config;

    if (maxRetries !== undefined) {
      if (!Number.isInteger(maxRetries) || maxRetries < 1 || maxRetries > 10) {
        errors.push({
          field: "config.maxRetries",
          message: "Must be an integer between 1 and 10",
        });
      }
      // Note: standard widget clamping (to 3) is applied at the service layer, not validation
    }

    if (timeout !== undefined) {
      if (!Number.isInteger(timeout) || timeout < 100 || timeout > 30000) {
        errors.push({
          field: "config.timeout",
          message: "Must be an integer between 100 and 30000",
        });
      } else if (input.type === "premium" && timeout < 5000) {
        errors.push({
          field: "config.timeout",
          message: "Premium widgets require timeout >= 5000ms",
        });
      }
    }

    if (tags !== undefined) {
      if (!Array.isArray(tags)) {
        errors.push({ field: "config.tags", message: "Must be an array" });
      } else {
        if (tags.length > 5) {
          errors.push({
            field: "config.tags",
            message: "Maximum 5 tags allowed",
          });
        }
        tags.forEach((tag, i) => {
          const trimmed = trimInput(tag);
          if (containsXSS(trimmed)) {
            errors.push({
              field: \`config.tags[\${i}]\`,
              message: "Tag contains forbidden pattern",
            });
          } else if (!TAG_PATTERN.test(trimmed)) {
            errors.push({
              field: \`config.tags[\${i}]\`,
              message: "Tags must be 1-20 lowercase alphanumeric characters",
            });
          }
        });
        if (input.type === "enterprise" && tags.length < 2) {
          errors.push({
            field: "config.tags",
            message: "Enterprise widgets require at least 2 tags",
          });
        }
      }
    } else if (input.type === "enterprise" && !partial) {
      errors.push({
        field: "config.tags",
        message: "Enterprise widgets require at least 2 tags",
      });
    }
  }

  return errors;
}
`;

const REVIEW_REPORT = `# Validation Code Review

## Coverage Assessment

| Requirement | Covered | Notes |
|------------|---------|-------|
| Name: 3-50 chars, alphanumeric + hyphens | YES | NAME_PATTERN regex enforces this |
| Name: unique, case-insensitive | N/A | Correctly deferred to service layer (validation is stateless) |
| Type: standard/premium/enterprise enum | YES | validTypes array check |
| maxRetries: integer 1-10 | YES | Range check present |
| maxRetries: capped at 3 for standard | NOTED | Comment indicates service-layer clamping, not validation rejection -- matches spec |
| timeout: integer 100-30000ms | YES | Range check present |
| timeout: >= 5000ms for premium | YES | Conditional check on type === "premium" |
| tags: max 5 items | YES | Array length check |
| tags: each 1-20 chars, lowercase alphanumeric | YES | TAG_PATTERN regex per item |
| Enterprise: at least 2 tags | YES | Conditional check on type === "enterprise" |
| Trim all string inputs | YES | trimInput() applied to name and tags |
| Reject XSS patterns | YES | containsXSS() checks 3 patterns on name and tags |
| UUID v4 for widget IDs | YES | Separate validateWidgetId() function |
| Return all errors (no short-circuit) | YES | Errors accumulated in array, not thrown |
| Stateless validation | YES | No database or external calls |

## Quality Assessment

**Strengths:**
- Clean separation between input validation and business logic (uniqueness, clamping)
- All errors collected and returned together
- XSS prevention covers documented patterns
- Partial update support via the \`partial\` parameter

**Gaps:**
- No explicit <5ms performance assertion (would need benchmarking, not validation logic)
- Config object itself is not required in the schema -- could add a check for POST requests

## Verdict
The validation module covers 13/13 applicable constraints. The two noted items (uniqueness deferral, maxRetries clamping) are correctly handled as service-layer concerns per the requirements spec. Code is ready for integration.
`;

function buildScripts(taskId: string): MockScript | null {
  switch (taskId) {
    case "task-001":
      return [
        // Step 1: read both docs
        {
          tool_calls: [
            { name: "read_file", input: { path: "docs/api-spec.md" } },
            { name: "read_file", input: { path: "docs/requirements.md" } },
          ],
        },
        {
          text: "Read both documents. The API spec defines 4 CRUD endpoints for widgets with typed config fields. The requirements add business rules, security constraints, and performance targets.",
        },
        // Step 2: write summary
        {
          tool_calls: [
            {
              name: "write_file",
              input: {
                path: "summaries/api-requirements-brief.md",
                content: SUMMARY_BRIEF,
              },
            },
          ],
        },
        {
          text: "Written requirements brief to workspace/summaries/api-requirements-brief.md covering all endpoints, validation constraints, security rules, and behavioral requirements.",
        },
      ];

    case "task-002":
      return [
        // Step 1: read the brief
        {
          tool_calls: [
            {
              name: "read_file",
              input: { path: "summaries/api-requirements-brief.md" },
            },
          ],
        },
        {
          text: "Read the requirements brief. Need to implement: name validation, type enum, config field ranges, premium/enterprise constraints, XSS prevention, UUID validation, and multi-error collection.",
        },
        // Step 2: write the module
        {
          tool_calls: [
            {
              name: "write_file",
              input: {
                path: "src/validate-input.ts",
                content: VALIDATION_MODULE,
              },
            },
          ],
        },
        {
          text: "Generated validate-input.ts with validateWidgetInput() and validateWidgetId() functions covering all 13 documented constraints.",
        },
      ];

    case "task-003":
      return [
        // Step 1: read code + brief
        {
          tool_calls: [
            { name: "read_file", input: { path: "src/validate-input.ts" } },
            {
              name: "read_file",
              input: { path: "summaries/api-requirements-brief.md" },
            },
          ],
        },
        {
          text: "Read both the generated validation module and the requirements brief. Will now assess coverage of each constraint.",
        },
        // Step 2: write review
        {
          tool_calls: [
            {
              name: "write_file",
              input: {
                path: "reviews/validation-review.md",
                content: REVIEW_REPORT,
              },
            },
          ],
        },
        {
          text: "Review complete. 13/13 applicable constraints covered. Two items correctly deferred to service layer. Code is ready for integration.",
        },
      ];

    default:
      return null;
  }
}

// --- Mock executor conversation engine ---

export class MockLLM {
  private scripts: Map<string, { turns: MockTurn[]; cursor: number }> =
    new Map();
  private idCounter = 0;

  loadTask(taskId: string): boolean {
    const script = buildScripts(taskId);
    if (!script) return false;
    this.scripts.set(taskId, { turns: script, cursor: 0 });
    return true;
  }

  nextResponse(
    taskId: string
  ): { type: "tool_use"; calls: MockToolCallWithId[] } | { type: "text"; text: string } | null {
    const state = this.scripts.get(taskId);
    if (!state || state.cursor >= state.turns.length) return null;

    const turn = state.turns[state.cursor];
    state.cursor++;

    if (turn.tool_calls) {
      return {
        type: "tool_use",
        calls: turn.tool_calls.map((tc) => ({
          ...tc,
          id: `mock_${++this.idCounter}`,
        })),
      };
    }

    return { type: "text", text: turn.text ?? "" };
  }
}

export interface MockToolCallWithId {
  id: string;
  name: string;
  input: Record<string, unknown>;
}
