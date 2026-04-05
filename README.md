# Brain Agent

An autonomous task orchestration agent that plans, executes, and verifies multi-step work with built-in safety gates. No UI, no database, no cloud infrastructure -- just a TypeScript process that reads a task queue and does the work.

Built for the [Microsoft AI Agents Hackathon](https://microsoft.github.io/AI_Agents_Hackathon/) (JS/TS track).

## What It Does

Brain Agent picks up tasks from a file-based queue, decomposes each into steps using an LLM, executes those steps via sandboxed tools, and decides whether to continue or stop. Before every write operation, a **verdict gate** checks that task state is consistent -- if something is wrong, the write is blocked.

```
Queue --> Claim --> Plan --> Execute (with verdict gates) --> Complete --> Escalate
  |                                                                         |
  +---- next task <-- CONTINUE                               STOP --> halt -+
```

### Key Properties

- **Autonomous multi-step execution.** The agent decomposes tasks into steps and executes them without human input.
- **Dependency ordering.** Tasks declare dependencies. The agent respects the DAG -- task-002 waits for task-001 to succeed.
- **Verdict gate.** Every write operation triggers a state consistency check. If task files are corrupted, duplicated, or missing timestamps, the write is blocked and the task fails safely.
- **Authority surfaces.** Each task declares which directories it can write to. Writes outside those boundaries are rejected.
- **Escalation policy.** After each task, the agent evaluates whether to continue or stop. Chain depth limits prevent unbounded autonomous runs.
- **Structured audit trail.** Every decision, tool call, and result is logged to `logs/events.jsonl`.

## Quick Start

### Mock Mode (no API key required)

Mock mode runs the full pipeline with deterministic LLM responses. This is the default demo path.

```bash
git clone https://github.com/gmgnrepeat/brain-agent-hackathon
cd brain-agent-hackathon
npm install
npm start
```

This processes 3 seeded tasks:
1. **Research** -- reads API spec and requirements docs, writes a summary brief
2. **Generate** -- reads the brief, writes a TypeScript validation module
3. **Review** -- reads the generated code, writes a coverage report

Each task depends on the previous one. The agent respects the dependency chain.

### Live Mode (Claude API)

Live mode uses Claude to dynamically decompose and execute tasks. Requires an Anthropic API key.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm run start:live
```

### Verdict Fail Demo

Demonstrates the safety gate. After the first task completes, state corruption is injected. The agent detects the inconsistency and blocks the next write.

```bash
npm run demo:verdict-fail
```

You will see:
```
[verdict]  DRIFT: Duplicate task ID found across stages
[tool_result]  write_file -> FAIL (91b)
[task_fail]  task-002 FAILED: VERDICT GATE BLOCKED
```

### Reset

To re-run after a demo:

```bash
npm run reset
```

## Architecture

```
src/
  index.ts          CLI entry point
  agent.ts          Core loop: claim, plan, execute, escalate
  task-queue.ts     File-based queue/active/completed lifecycle
  planner.ts        LLM-driven step decomposition
  executor.ts       Step runner with tool dispatch
  verdict.ts        Pre-mutation state coherence check
  escalation.ts     Continue/stop policy engine
  logger.ts         Structured JSONL + colored terminal output
  mock.ts           Deterministic offline demo engine
  tools/
    read-file.ts    Read from workspace
    write-file.ts   Write to workspace (verdict-gated)
    list-files.ts   List directory contents
    search-files.ts Search file contents
```

### Task Lifecycle

Tasks are JSON files that move between directories:

```
tasks/queue/       Waiting to be claimed
tasks/active/      Currently being executed (one at a time)
tasks/completed/   Finished (succeeded or failed, with result)
```

Each task declares:
- **priority** (P1-P4) -- higher priority tasks are claimed first
- **depends_on** -- IDs of tasks that must succeed before this one starts
- **authority_surfaces** -- directories the task is allowed to write to

### Safety Model

**Verdict Gate:** Before every `write_file` call, the agent checks:
- No task ID appears in multiple lifecycle stages
- Active tasks have `claimed_at` timestamps
- Completed tasks have `completed_at` timestamps

If any check fails, the verdict returns DRIFT and the write is blocked.

**Escalation Policy:** After each task completes, the agent checks chain depth against a configurable limit. Reaching the limit triggers a STOP signal, halting the agent for human review.

**Authority Surfaces:** The `write_file` tool verifies that the target path falls within the task's declared `authority_surfaces`. Writes outside the boundary are rejected regardless of verdict status.

### Tool Surface

| Tool | Description | Gated |
|------|-------------|-------|
| `read_file` | Read a file from workspace | No |
| `write_file` | Write a file to workspace | Verdict + authority check |
| `list_files` | List directory contents | No |
| `search_files` | Search file contents by pattern | No |

All paths are sandboxed to the `workspace/` directory. Path traversal (`..`) is rejected.

## Inspecting Results

After a run:

```bash
# Structured event log
cat logs/events.jsonl | head -20

# Completed task files with results
cat tasks/completed/task-001.json

# Generated artifacts
cat workspace/summaries/api-requirements-brief.md
cat workspace/src/validate-input.ts
cat workspace/reviews/validation-review.md
```

## Design Philosophy

This agent is extracted from a production knowledge orchestration system that has been running autonomously for months. The patterns here -- file-based task queues, verdict gates, authority surfaces, escalation policies -- are not theoretical. They solve real problems that emerge when you let an AI agent run unsupervised:

- **What if state gets corrupted mid-run?** Verdict gate catches it before damage spreads.
- **What if the agent writes where it shouldn't?** Authority surfaces enforce boundaries per task.
- **What if it runs forever?** Chain depth limits force a stop for human review.

The design principle: **autonomy is granted, not assumed.** Every task gets a scoped permission set. Every write gets a safety check. Every chain gets a limit.

## Configuration

| Flag | Default | Description |
|------|---------|-------------|
| `MOCK_LLM=1` | Set in `npm start` | Use deterministic mock responses |
| `--max-chain=N` | 10 | Maximum tasks before forced stop |
| `--demo-verdict-fail` | off | Inject state corruption after first task |

## License

MIT
