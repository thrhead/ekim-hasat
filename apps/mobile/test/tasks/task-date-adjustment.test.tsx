import { createTaskDateAdjustmentFlow } from "../../src/features/tasks/task-date-adjustment";
import type { ApiClient, TaskDateAdjustmentComponents } from "../../../../packages/api-client/src/index";

type State = TaskDateAdjustmentComponents["schemas"]["TaskDateAdjustmentHistoryPage"];
type Accepted = TaskDateAdjustmentComponents["schemas"]["TaskDateAdjustment"];

const current: State = {
  task: { taskId: "task-1", plannedLocalDate: "2026-10-12", taskVersion: 4, adjustable: true },
  items: [],
  nextCursor: null,
};
const accepted: Accepted = {
  adjustmentId: "adjustment-1", taskId: "task-1", previousPlannedLocalDate: "2026-10-12",
  newPlannedLocalDate: "2026-10-14", baseTaskVersion: 4, acceptedTaskVersion: 5,
  adjustedAt: "2026-10-08T10:00:00.000Z",
};

function ok<T>(data: T) {
  return { data, error: undefined, response: { ok: true, status: 201 } };
}

function conflict(code: string) {
  return { data: undefined, error: { error: { code } }, response: { ok: false, status: 409 } };
}

describe("online task date adjustment flow", () => {
  test("keeps the exact accepted-unknown command identity and payload for an explicit retry", async () => {
    const requests: unknown[] = [];
    const POST = jest.fn(async (_path: string, request: unknown) => {
      requests.push(request);
      if (requests.length === 1) throw new Error("response lost after server commit");
      return ok(accepted);
    });
    const flow = createTaskDateAdjustmentFlow({
      client: { POST, GET: jest.fn() } as unknown as ApiClient,
      newAdjustmentId: () => "adjustment-1",
    });

    await expect(flow.submit("task-1", current.task, "2026-10-14")).rejects.toThrow();
    expect(flow.hasUncertainSubmission("task-1")).toBe(true);
    await expect(flow.retryUncertain("task-1")).resolves.toEqual(accepted);
    expect(requests).toEqual([
      { params: { path: { taskId: "task-1" }, header: { "If-Match": "4" } }, body: { adjustmentId: "adjustment-1", newPlannedLocalDate: "2026-10-14" } },
      { params: { path: { taskId: "task-1" }, header: { "If-Match": "4" } }, body: { adjustmentId: "adjustment-1", newPlannedLocalDate: "2026-10-14" } },
    ]);
  });

  test("does not report success before the server accepts the adjustment", async () => {
    let resolvePost!: (response: ReturnType<typeof ok<Accepted>>) => void;
    const POST = jest.fn(() => new Promise<ReturnType<typeof ok<Accepted>>>((resolve) => { resolvePost = resolve; }));
    const flow = createTaskDateAdjustmentFlow({ client: { POST, GET: jest.fn() } as unknown as ApiClient, newAdjustmentId: () => "adjustment-1" });
    let settled = false;
    const submission = flow.submit("task-1", current.task, "2026-10-14").then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    resolvePost(ok(accepted));
    await submission;
    expect(settled).toBe(true);
  });

  test("does not submit a date equal to the current canonical date", async () => {
    const POST = jest.fn();
    const flow = createTaskDateAdjustmentFlow({ client: { POST, GET: jest.fn() } as unknown as ApiClient, newAdjustmentId: () => "unused" });
    await expect(flow.submit("task-1", current.task, "2026-10-12")).rejects.toMatchObject({ code: "NO_DATE_CHANGE" });
    expect(POST).not.toHaveBeenCalled();
  });

  test("treats defensive NO_DATE_CHANGE as unsuccessful without refreshing current state", async () => {
    const POST = jest.fn().mockResolvedValue({ data: undefined, error: { error: { code: "NO_DATE_CHANGE" } }, response: { ok: false, status: 400 } });
    const GET = jest.fn().mockResolvedValue(ok(current));
    const flow = createTaskDateAdjustmentFlow({ client: { POST, GET } as unknown as ApiClient, newAdjustmentId: () => "adjustment-1" });
    await expect(flow.submit("task-1", current.task, "2026-10-14")).rejects.toMatchObject({ code: "NO_DATE_CHANGE" });
    expect(GET).not.toHaveBeenCalled();
  });

  test("reloads current task after stale conflict and requires a new farmer decision", async () => {
    const POST = jest.fn().mockResolvedValue(conflict("TASK_VERSION_CONFLICT"));
    const GET = jest.fn().mockResolvedValue(ok({ ...current, task: { ...current.task, plannedLocalDate: "2026-10-13", taskVersion: 5 } }));
    const flow = createTaskDateAdjustmentFlow({ client: { POST, GET } as unknown as ApiClient, newAdjustmentId: () => "adjustment-1" });
    await expect(flow.submit("task-1", current.task, "2026-10-14")).rejects.toMatchObject({ code: "TASK_VERSION_CONFLICT" });
    expect(GET).toHaveBeenCalledWith("/tasks/{taskId}/date-adjustments", { params: { path: { taskId: "task-1" } } });
    expect(POST).toHaveBeenCalledTimes(1);
  });
});
