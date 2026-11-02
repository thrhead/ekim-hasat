import { createElement } from "react";
import { act, create, type TestRenderer } from "react-test-renderer";
import { Alert } from "react-native";
import { ManualTaskCreateScreen as Screen } from "../../src/features/tasks/manual-task-create-screen";
import { createManualTaskStore, type ManualTaskState, type ManualTaskStorage } from "../../src/features/tasks/manual-task-store";
const context = { fieldId: "field", seasonId: "season", role: "OWNER" as const, seasonStatus: "ACTIVE" as const, planStatus: "APPROVED" as const, actualPlantingDate: "2024-01-01", businessTimezone: "Europe/Istanbul", fieldName: "Kuzey", seasonName: "Buğday" };
function memory(): ManualTaskStorage { let s: ManualTaskState = { activeAccount: null, contexts: [], commands: [] }; return { read: async () => JSON.parse(JSON.stringify(s)), update: async fn => { s = fn(JSON.parse(JSON.stringify(s))); } }; }
function button(screen: TestRenderer, label: string) { return screen.root.findAll(node => node.props.accessibilityLabel === label)[0]! as unknown as { props: { onChangeText(value: string): void; onPress(): void } }; }

test("task form validates planting boundary and saves local pending work accessibly", async () => {
  expect(typeof Screen).toBe("function");
  const store = createManualTaskStore({ storage: memory() }); await store.setAuthenticatedAccount("a"); await store.saveContext("a", context);
  const ids = ["task", "mutation"]; let screen!: TestRenderer;
  await act(async () => { screen = create(createElement(Screen, { accountId: "a", fieldId: "field", seasonId: "season", store, createId: () => ids.shift()! })); });
  expect(JSON.stringify((screen as unknown as { toJSON(): unknown }).toJSON())).toContain("Kuzey");
  expect(JSON.stringify((screen as unknown as { toJSON(): unknown }).toJSON())).toContain("Buğday");
  await act(async () => { button(screen, "Görev adı").props.onChangeText("Kontrol"); button(screen, "Görev tarihi").props.onChangeText("2023-12-31"); });
  await act(async () => { button(screen, "Görevi kaydet").props.onPress(); });
  expect(JSON.stringify((screen as unknown as { toJSON(): unknown }).toJSON())).toContain("Görev tarihi ekim tarihinden önce olamaz");
  await act(async () => { button(screen, "Görev tarihi").props.onChangeText("2024-01-01"); });
  await act(async () => { button(screen, "Görevi kaydet").props.onPress(); });
  expect((await store.list("a"))[0]).toMatchObject({ title: "Kontrol", state: "PENDING" });
  expect(JSON.stringify((screen as unknown as { toJSON(): unknown }).toJSON())).toContain("Cihazda kaydedildi, gönderilmeyi bekliyor");
});

test("rejected records expose explicit recovery while uncertain records cannot be removed", async () => {
  expect(typeof Screen).toBe("function");
  const store = createManualTaskStore({ storage: memory() }); await store.setAuthenticatedAccount("a"); await store.saveContext("a", context);
  const command = { accountId: "a", fieldId: "field", seasonId: "season", taskId: "task", mutationId: "mutation", title: "Kontrol", plannedLocalDate: "2024-01-01" };
  await store.enqueue("a", command); await store.startAttempt("a", "task"); await store.finishAttempt("a", "task", "UNCONFIRMED"); store.releaseAttempt("a", "task");
  let screen!: TestRenderer; await act(async () => { screen = create(createElement(Screen, { accountId: "a", fieldId: "field", seasonId: "season", store })); });
  expect(JSON.stringify((screen as unknown as { toJSON(): unknown }).toJSON())).toContain("Gönderim sonucu henüz doğrulanamadı");
  expect(screen.root.findAll(node => node.props.accessibilityLabel === "Reddedilen kaydı cihazdan kaldır")).toHaveLength(0);
});

test("definitively rejected task offers retry, correction and confirmed local-only removal", async () => {
  const store = createManualTaskStore({ storage: memory() }); await store.setAuthenticatedAccount("a"); await store.saveContext("a", context);
  const command = { accountId: "a", fieldId: "field", seasonId: "season", taskId: "task", mutationId: "mutation", title: "Kontrol", plannedLocalDate: "2024-01-01" };
  await store.enqueue("a", command); await store.startAttempt("a", "task"); await store.finishAttempt("a", "task", "REJECTED", "INVALID_TASK"); store.releaseAttempt("a", "task");
  let screen!: TestRenderer; await act(async () => { screen = create(createElement(Screen, { accountId: "a", fieldId: "field", seasonId: "season", store, createId: jest.fn().mockReturnValueOnce("new-task").mockReturnValueOnce("new-mutation") })); });
  expect(button(screen, "Reddedilen görevi yeniden dene")).toBeDefined();
  expect(button(screen, "Reddedilen kaydı cihazdan kaldır")).toBeDefined();
  await act(async () => { button(screen, "Düzelterek yeni görev oluştur").props.onPress(); });
  await act(async () => { button(screen, "Görev adı").props.onChangeText("Düzeltilmiş"); });
  await act(async () => { button(screen, "Görevi kaydet").props.onPress(); });
  expect((await store.list("a")).map(item => [item.taskId, item.state])).toEqual([["task", "REJECTED"], ["new-task", "PENDING"]]);
  const alert = jest.spyOn(Alert, "alert").mockImplementation((...args: unknown[]) => (args[2] as Array<{ style?: string; onPress(): void }>).find(option => option.style === "destructive")?.onPress());
  await act(async () => { button(screen, "Reddedilen kaydı cihazdan kaldır").props.onPress(); });
  expect(alert).toHaveBeenCalled(); expect((await store.list("a")).map(item => item.taskId)).toEqual(["new-task"]); alert.mockRestore();
});

test("an ineligible season explains why a definitively rejected task needs attention", async () => {
  const store = createManualTaskStore({ storage: memory() }); await store.setAuthenticatedAccount("a"); await store.saveContext("a", context);
  await store.enqueue("a", { accountId: "a", fieldId: "field", seasonId: "season", taskId: "task", mutationId: "mutation", title: "Kontrol", plannedLocalDate: "2024-01-01" });
  await store.startAttempt("a", "task"); await store.finishAttempt("a", "task", "REJECTED", "SEASON_INELIGIBLE"); store.releaseAttempt("a", "task");
  let screen!: TestRenderer; await act(async () => { screen = create(createElement(Screen, { accountId: "a", fieldId: "field", seasonId: "season", store })); });
  expect(JSON.stringify((screen as unknown as { toJSON(): unknown }).toJSON())).toContain("Sezon artık görev eklemeye uygun değil");
});

test("validation appears beside the affected input and clears when corrected", async () => {
  const store = createManualTaskStore({ storage: memory() }); await store.setAuthenticatedAccount("a"); await store.saveContext("a", context);
  let screen!: TestRenderer; await act(async () => { screen = create(createElement(Screen, { accountId: "a", fieldId: "field", seasonId: "season", store })); });
  await act(async () => { button(screen, "Görevi kaydet").props.onPress(); });
  expect(screen.root.findAll(node => String(node.props.accessibilityLabel).startsWith("Görev adı hatası:")).length).toBeGreaterThan(0);
  expect(screen.root.findAll(node => String(node.props.accessibilityLabel).startsWith("Görev tarihi hatası:"))).toHaveLength(0);
  await act(async () => { button(screen, "Görev adı").props.onChangeText("Kontrol"); });
  expect(screen.root.findAll(node => String(node.props.accessibilityLabel).startsWith("Görev adı hatası:"))).toHaveLength(0);
  await act(async () => { button(screen, "Görevi kaydet").props.onPress(); });
  expect(screen.root.findAll(node => String(node.props.accessibilityLabel).startsWith("Görev tarihi hatası:")).length).toBeGreaterThan(0);
  await act(async () => { button(screen, "Görev tarihi").props.onChangeText("2024-01-01"); });
  expect(screen.root.findAll(node => String(node.props.accessibilityLabel).startsWith("Görev tarihi hatası:"))).toHaveLength(0);
});

test("retained rejected task keeps field and season visible after eligibility is lost", async () => {
  const store = createManualTaskStore({ storage: memory() }); await store.setAuthenticatedAccount("a"); await store.saveContext("a", context);
  await store.enqueue("a", { accountId: "a", fieldId: "field", seasonId: "season", taskId: "task", mutationId: "mutation", title: "Kontrol", plannedLocalDate: "2024-01-01" });
  await store.startAttempt("a", "task"); await store.finishAttempt("a", "task", "REJECTED", "SEASON_INELIGIBLE"); store.releaseAttempt("a", "task");
  let screen!: TestRenderer; await act(async () => { screen = create(createElement(Screen, { accountId: "a", fieldId: "field", seasonId: "season", store })); });
  const tree = JSON.stringify((screen as unknown as { toJSON(): unknown }).toJSON());
  expect(tree).toContain("Kuzey"); expect(tree).toContain("Buğday");
});

test("loading context does not announce an access error before lookup finishes", async () => {
  let finish!: (value: typeof context | null) => void;
  const pending = new Promise<typeof context | null>(resolve => { finish = resolve; });
  const store = { getContext: () => pending, list: async () => [], subscribe: () => () => {} };
  let screen!: TestRenderer; await act(async () => { screen = create(createElement(Screen, { accountId: "a", fieldId: "field", seasonId: "season", store: store as never })); });
  let tree = JSON.stringify((screen as unknown as { toJSON(): unknown }).toJSON());
  expect(tree).toContain("Görev bilgileri yükleniyor");
  expect(tree).not.toContain("Bu sezonun görev bilgileri kullanılamıyor");
  await act(async () => { finish(null); await pending; });
  tree = JSON.stringify((screen as unknown as { toJSON(): unknown }).toJSON());
  expect(tree).toContain("Bu sezonun görev bilgileri kullanılamıyor");
});
