// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (callback: () => void | Promise<void>) => Promise<void>;
  create: (element: React.ReactElement) => TestScreen;
};
import type { ApiClient, TaskSkipComponents } from "../../../../packages/api-client/src/index";
import { TaskSkipView } from "../../src/features/tasks/task-skip-view";
import { createTaskSkipFlow } from "../../src/features/tasks/task-skip";

type TaskSkip = TaskSkipComponents["schemas"]["TaskSkip"];
const accepted: TaskSkip = { skipId: "skip-1", taskId: "task-1", taskTitle: "Sulamayı kontrol et", seasonId: "season-1", fieldId: "field-1", plannedLocalDate: "2026-10-07", baseTaskVersion: 2, acceptedTaskVersion: 3, skippedAt: "2026-10-07T12:30:00Z" };
const task = { id: "task-1", title: accepted.taskTitle, plannedLocalDate: accepted.plannedLocalDate, taskVersion: 2 };
type TestScreen = { root: { findAllByType(type: unknown): { props: Record<string, unknown> }[]; findAll(predicate: (node: { props: Record<string, unknown> }) => boolean): { props: Record<string, unknown> }[] }; toJSON(): unknown };
function button(root: TestScreen, label: string) { return root.root.findAll((item) => item.props.accessibilityLabel === label)[0]!; }

describe("online task Skip", () => {
  it("creates a UUID mutation identity when crypto.randomUUID is unavailable", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
    try {
      const command = createTaskSkipFlow({ client: { POST: jest.fn() } as unknown as ApiClient }).createCommand(task.id, task.taskVersion);
      expect(command.skipId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
      else Reflect.deleteProperty(globalThis, "crypto");
    }
  });

  it("requires explicit confirmation and reports accepted server result with an accessible busy state", async () => {
    const POST = jest.fn().mockResolvedValue({ data: accepted, response: { ok: true, status: 201 } });
    const onAccepted = jest.fn(); let root!: TestScreen;
    await act(async () => { root = create(<TaskSkipView task={task} flow={createTaskSkipFlow({ client: { POST } as unknown as ApiClient, newSkipId: () => "skip-1" })} onAccepted={onAccepted} />); });
    await act(async () => { (button(root, "Görevi atla: Sulamayı kontrol et").props.onPress as () => void)(); });
    expect(JSON.stringify(root.toJSON())).toContain("Bu görev atlandı olarak kaydedilecek ve geri alınamayacak");
    expect(POST).not.toHaveBeenCalled();
    let finish!: (value: unknown) => void;
    POST.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await act(async () => {
      (button(root, "Atlamayı onayla").props.onPress as () => void)();
      (button(root, "Atlamayı onayla").props.onPress as () => void)();
    });
    expect(root.root.findAll(({ props }) => (props.accessibilityState as { busy?: boolean } | undefined)?.busy === true).length).toBeGreaterThan(0);
    await act(async () => { (button(root, "Atlamayı onayla").props.onPress as () => void)(); });
    expect(POST).toHaveBeenCalledTimes(1);
    await act(async () => finish({ data: accepted, response: { ok: true, status: 201 } }));
    expect(onAccepted).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(root.toJSON())).toContain("Görev atlandı");
  });

  it("retries uncertain transport with the exact same open command and does not queue offline", async () => {
    let online = false; const POST = jest.fn();
    const flow = createTaskSkipFlow({ client: { POST } as unknown as ApiClient, isOnline: () => online, newSkipId: () => "skip-1" });
    const command = flow.createCommand(task.id, task.taskVersion);
    await expect(flow.submit(command)).rejects.toMatchObject({ kind: "OFFLINE" });
    expect(POST).not.toHaveBeenCalled();
    online = true; POST.mockRejectedValueOnce(new Error("connection lost")).mockResolvedValueOnce({ data: accepted, response: { ok: true, status: 200 } });
    await expect(flow.submit(command)).rejects.toMatchObject({ kind: "UNCERTAIN" });
    expect(await flow.submit(command)).toEqual(accepted);
    expect(POST.mock.calls[0]).toEqual(POST.mock.calls[1]);
  });

  it("refreshes current work after a stale task conflict", async () => {
    const POST = jest.fn().mockResolvedValue({ response: { ok: false, status: 409 }, error: { error: { code: "TASK_VERSION_CONFLICT" } } });
    const onConflict = jest.fn(); let root!: TestScreen;
    await act(async () => { root = create(<TaskSkipView task={task} flow={createTaskSkipFlow({ client: { POST } as unknown as ApiClient, newSkipId: () => "skip-1" })} onAccepted={jest.fn()} onConflict={onConflict} />); });
    await act(async () => { (button(root, "Görevi atla: Sulamayı kontrol et").props.onPress as () => void)(); });
    await act(async () => { (button(root, "Atlamayı onayla").props.onPress as () => void)(); });
    expect(onConflict).toHaveBeenCalledWith(expect.objectContaining({ kind: "CONFLICT", code: "TASK_VERSION_CONFLICT" }));
    expect(JSON.stringify(root.toJSON())).toContain("Görev değişti");
  });

  it.each([[409, "TASK_VERSION_CONFLICT", "CONFLICT"], [409, "TASK_ALREADY_COMPLETED", "INELIGIBLE"], [403, "FORBIDDEN", "ACCESS"], [404, "NOT_FOUND", "ACCESS"]] as const)("maps %s/%s to recoverable %s feedback", async (status, code, kind) => {
    const POST = jest.fn().mockResolvedValue({ response: { ok: false, status }, error: { error: { code } } });
    const flow = createTaskSkipFlow({ client: { POST } as unknown as ApiClient, newSkipId: () => "skip-1" });
    await expect(flow.submit(flow.createCommand(task.id, task.taskVersion))).rejects.toMatchObject({ kind });
  });
});
