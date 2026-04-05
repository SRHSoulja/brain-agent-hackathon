import { readFile, writeFile, readdir, unlink, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

export interface Task {
  id: string;
  title: string;
  description: string;
  priority: "P1" | "P2" | "P3" | "P4";
  status: "queued" | "active" | "completed" | "failed";
  authority_surfaces: string[];
  depends_on: string[];
  created_at: string;
  claimed_at?: string;
  completed_at?: string;
  result?: string;
}

const PRIORITY_ORDER: Record<string, number> = {
  P1: 0,
  P2: 1,
  P3: 2,
  P4: 3,
};

export class TaskQueue {
  private root: string;

  constructor(root: string) {
    this.root = root;
  }

  private dir(stage: string) {
    return resolve(this.root, "tasks", stage);
  }

  async listTasks(stage: string): Promise<Task[]> {
    const dir = this.dir(stage);
    try {
      const files = await readdir(dir);
      const tasks: Task[] = [];
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        const raw = await readFile(resolve(dir, f), "utf-8");
        tasks.push(JSON.parse(raw));
      }
      return tasks;
    } catch {
      return [];
    }
  }

  async getNextTask(): Promise<Task | null> {
    const queued = await this.listTasks("queue");
    const completed = await this.listTasks("completed");
    const active = await this.listTasks("active");
    // Only successfully completed tasks satisfy dependencies
    const successIds = new Set(
      completed.filter((t) => t.status === "completed").map((t) => t.id)
    );
    const inProgressIds = new Set(active.map((t) => t.id));

    const eligible = queued.filter((t) => {
      if (t.depends_on.length === 0) return true;
      return t.depends_on.every((dep) => successIds.has(dep));
    });

    if (eligible.length === 0) return null;

    eligible.sort(
      (a, b) =>
        (PRIORITY_ORDER[a.priority] ?? 9) -
        (PRIORITY_ORDER[b.priority] ?? 9)
    );
    return eligible[0];
  }

  async claimTask(taskId: string): Promise<Task> {
    const src = resolve(this.dir("queue"), `${taskId}.json`);
    const raw = await readFile(src, "utf-8");
    const task: Task = JSON.parse(raw);
    task.status = "active";
    task.claimed_at = new Date().toISOString();

    const dest = resolve(this.dir("active"), `${taskId}.json`);
    await writeFile(dest, JSON.stringify(task, null, 2));
    await unlink(src);
    return task;
  }

  async completeTask(taskId: string, result: string): Promise<Task> {
    const src = resolve(this.dir("active"), `${taskId}.json`);
    const raw = await readFile(src, "utf-8");
    const task: Task = JSON.parse(raw);
    task.status = "completed";
    task.completed_at = new Date().toISOString();
    task.result = result;

    const dest = resolve(this.dir("completed"), `${taskId}.json`);
    await mkdir(this.dir("completed"), { recursive: true });
    await writeFile(dest, JSON.stringify(task, null, 2));
    await unlink(src);
    return task;
  }

  async failTask(taskId: string, reason: string): Promise<Task> {
    const src = resolve(this.dir("active"), `${taskId}.json`);
    const raw = await readFile(src, "utf-8");
    const task: Task = JSON.parse(raw);
    task.status = "failed";
    task.completed_at = new Date().toISOString();
    task.result = `FAILED: ${reason}`;

    const dest = resolve(this.dir("completed"), `${taskId}.json`);
    await mkdir(this.dir("completed"), { recursive: true });
    await writeFile(dest, JSON.stringify(task, null, 2));
    await unlink(src);
    return task;
  }

  async verifyStateConsistency(): Promise<{
    consistent: boolean;
    reason?: string;
  }> {
    const queue = await this.listTasks("queue");
    const active = await this.listTasks("active");
    const completed = await this.listTasks("completed");

    // Check: no task appears in multiple stages
    const allIds = [
      ...queue.map((t) => t.id),
      ...active.map((t) => t.id),
      ...completed.map((t) => t.id),
    ];
    const uniqueIds = new Set(allIds);
    if (uniqueIds.size !== allIds.length) {
      return {
        consistent: false,
        reason: "Duplicate task ID found across stages",
      };
    }

    // Check: active tasks should have claimed_at
    for (const t of active) {
      if (!t.claimed_at) {
        return {
          consistent: false,
          reason: `Active task ${t.id} missing claimed_at timestamp`,
        };
      }
    }

    // Check: completed tasks should have completed_at
    for (const t of completed) {
      if (!t.completed_at) {
        return {
          consistent: false,
          reason: `Completed task ${t.id} missing completed_at timestamp`,
        };
      }
    }

    return { consistent: true };
  }
}
