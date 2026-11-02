import { act, create, type TestRenderer } from "react-test-renderer";
import { FieldDiaryScreen } from "../../src/features/observations/field-diary-screen";
import type { ApiClient } from "../../../../packages/api-client/src/index";

test.each([["OWNER", "ACTIVE", "APPROVED", true], ["WORKER", "ACTIVE", "APPROVED", false], ["ADVISOR", "ACTIVE", "APPROVED", false], ["OWNER", "DRAFT", "DRAFT", false], ["OWNER", "ACTIVE", "DRAFT", false]])("entry is fail-closed for role %s, season %s, plan %s", async (role, status, planStatus, allowed) => {
  const GET = jest.fn(async (path: string) => path.includes("diary")
    ? { response: { ok: true, status: 200 }, data: { items: [], nextCursor: null, businessTimezone: "Europe/Istanbul", viewerRole: role } }
    : path === "/fields/{fieldId}" ? { response: { ok: true, status: 200 }, data: { id: "field", name: "Kuzey" } }
    : { response: { ok: true, status: 200 }, data: { id: "season", fieldId: "field", viewerRole: role, status, sowingPlantingDate: "2024-01-01", plan: { status: planStatus, source: { kind: "MANUAL" }, tasks: [] } } });
  const saveContext = jest.fn().mockResolvedValue(undefined); let screen!: TestRenderer;
  await act(async () => { screen = create(<FieldDiaryScreen client={{ GET } as unknown as ApiClient} accountId="account" fieldId="field" seasonId="season" manualTaskStore={{ saveContext } as never} onAddManualTask={jest.fn()} />); });
  expect(screen.root.findAll(node => node.props.accessibilityLabel === "Görev ekle").length > 0).toBe(allowed);
  expect(saveContext).toHaveBeenCalledTimes(allowed ? 1 : 0);
});

test("original account can reopen retained task records when creation is no longer eligible", async () => {
  const GET = jest.fn(async (path: string) => path.includes("diary")
    ? { response: { ok: true, status: 200 }, data: { items: [], nextCursor: null, businessTimezone: "Europe/Istanbul", viewerRole: "WORKER" } }
    : path === "/fields/{fieldId}" ? { response: { ok: true, status: 200 }, data: { id: "field", name: "Kuzey" } }
    : { response: { ok: true, status: 200 }, data: { id: "season", fieldId: "field", viewerRole: "WORKER", status: "ACTIVE", sowingPlantingDate: "2024-01-01", plan: { status: "APPROVED", source: { kind: "MANUAL" }, tasks: [] } } });
  const store = { saveContext: jest.fn(), clearContext: jest.fn().mockResolvedValue(undefined), list: jest.fn().mockResolvedValue([{ accountId: "account", fieldId: "field", seasonId: "season", taskId: "task", state: "REJECTED" }]), subscribe: () => () => {} };
  let screen!: TestRenderer;
  await act(async () => { screen = create(<FieldDiaryScreen client={{ GET } as unknown as ApiClient} accountId="account" fieldId="field" seasonId="season" manualTaskStore={store as never} onAddManualTask={jest.fn()} />); });
  expect(screen.root.findAll(node => node.props.accessibilityLabel === "Görev ekle")).toHaveLength(0);
  expect(screen.root.findAll(node => node.props.accessibilityLabel === "Görev kayıtlarını görüntüle").length).toBeGreaterThan(0);
});

test("failed local context persistence does not offer task creation", async () => {
  const GET = jest.fn(async (path: string) => path.includes("diary")
    ? { response: { ok: true, status: 200 }, data: { items: [], nextCursor: null, businessTimezone: "Europe/Istanbul", viewerRole: "OWNER" } }
    : path === "/fields/{fieldId}" ? { response: { ok: true, status: 200 }, data: { id: "field", name: "Kuzey" } }
    : { response: { ok: true, status: 200 }, data: { id: "season", fieldId: "field", viewerRole: "OWNER", status: "ACTIVE", sowingPlantingDate: "2024-01-01", plan: { status: "APPROVED", source: { kind: "MANUAL" }, tasks: [] } } });
  let screen!: TestRenderer;
  await act(async () => { screen = create(<FieldDiaryScreen client={{ GET } as unknown as ApiClient} accountId="account" fieldId="field" seasonId="season" manualTaskStore={{ saveContext: jest.fn().mockRejectedValue(new Error("disk full")) } as never} onAddManualTask={jest.fn()} />); });
  expect(screen.root.findAll(node => node.props.accessibilityLabel === "Görev ekle")).toHaveLength(0);
});
