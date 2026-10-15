import { act, create } from "react-test-renderer";
import type { ApiClient, ObservationDiaryComponents } from "../../../../packages/api-client/src/index";
import { ObservationCreateScreen } from "../../src/features/observations/observation-create-screen";
import { FieldDiaryScreen } from "../../src/features/observations/field-diary-screen";
import type { ObservationCommand } from "../../src/features/observations/observation-command-store";

type DiaryPage = ObservationDiaryComponents["schemas"]["DiaryPage"];

it("announces an original-account unconfirmed note without calling it accepted or rejected", async () => {
  const command: ObservationCommand = { accountId: "account-a", observationId: "123e4567-e89b-42d3-a456-426614174000",
    fieldId: "field-a", seasonId: null, description: "Damp soil", occurredAtLocal: "2026-10-14T12:00",
    occurredAt: "2026-10-14T09:00:00Z", capturedBusinessTimezone: "Europe/Istanbul", state: "UNCONFIRMED" };
  const store = { getContext: async () => ({ fieldId: "field-a", seasonId: null, businessTimezone: "Europe/Istanbul" }),
    enqueue: jest.fn(), list: async () => [command] };
  let screen!: ReturnType<typeof create>;
  await act(async () => { screen = create(<ObservationCreateScreen client={{ GET: jest.fn().mockRejectedValue(new TypeError("offline")) } as unknown as ApiClient}
    accountId="account-a" fieldId="field-a" offlineStore={store as never}
    now={() => new Date("2026-10-14T12:00:00Z")} />); });
  const label = "Gözlem sonucu doğrulanamadı";
  const nodes = screen.root.findAll(({ props }) => props.accessibilityLabel === label);
  expect(nodes.length).toBeGreaterThan(0);
  expect(nodes[0]!.props.accessibilityLiveRegion).toBe("polite");
  expect(JSON.stringify(nodes[0]!.props)).not.toMatch(/kabul edildi|reddedildi/);
  await act(async () => screen.unmount());
});

it("clears former-account canonical and local observations on account switch and sign-out", async () => {
  const privateText = "Account A private observation";
  const page: DiaryPage = { items: [{ kind: "OBSERVATION", id: "observation-a", fieldId: "field-a", seasonId: null,
    description: privateText, occurredAt: "2026-10-14T09:00:00.000Z" }], nextCursor: null, businessTimezone: "Europe/Istanbul" };
  let currentAccount: "a" | "b" | null = "a";
  const GET = jest.fn(async () => currentAccount === "a"
    ? { data: page, response: { ok: true, status: 200 } }
    : { error: { error: { code: "FORBIDDEN", message: "private response" } }, response: { ok: false, status: currentAccount ? 403 : 401 } });
  const client = { GET } as unknown as ApiClient;
  const localA: ObservationCommand = { accountId: "a", observationId: "observation-local-a", fieldId: "field-a", seasonId: null,
    description: "Account A local observation", occurredAtLocal: "2026-10-14T12:00", occurredAt: "2026-10-14T09:00:00Z",
    capturedBusinessTimezone: "Europe/Istanbul", state: "ACCEPTED", acceptedResult: { id: "observation-local-a" } };
  const list = jest.fn(async (accountId: string) => accountId === "a" ? [localA] : []);
  const observationStore = { list } as never;
  let screen!: ReturnType<typeof create>;
  await act(async () => { screen = create(<FieldDiaryScreen client={client} accountId="a" observationStore={observationStore} fieldId="field-a" />); });
  expect(screen.root.findAll(({ props }) => props.children === privateText).length).toBeGreaterThan(0);
  expect(screen.root.findAll(({ props }) => props.children === "Account A local observation").length).toBeGreaterThan(0);

  currentAccount = "b";
  await act(async () => { screen.update(<FieldDiaryScreen client={client} accountId="b" observationStore={observationStore} fieldId="field-a" />); });
  expect(GET).toHaveBeenCalledTimes(2);
  expect(screen.root.findAll(({ props }) => props.children === privateText)).toHaveLength(0);
  expect(screen.root.findAll(({ props }) => props.children === "Account A local observation")).toHaveLength(0);
  expect(screen.root.findAll(({ props }) => props.accessibilityRole === "alert" && String(props.children).includes("erişiminiz doğrulanamadı")).length).toBeGreaterThan(0);

  currentAccount = null;
  await act(async () => { screen.update(<FieldDiaryScreen client={client} observationStore={observationStore} fieldId="field-a" />); });
  expect(GET).toHaveBeenCalledTimes(3);
  expect(list).toHaveBeenCalledTimes(2);
  expect(screen.root.findAll(({ props }) => props.children === privateText)).toHaveLength(0);
  expect(screen.root.findAll(({ props }) => props.children === "Account A local observation")).toHaveLength(0);
  expect(screen.root.findAll(({ props }) => props.accessibilityRole === "alert" && String(props.children).includes("erişiminiz doğrulanamadı")).length).toBeGreaterThan(0);
  await act(async () => screen.unmount());
});

it("does not keep the former account's needs-attention note visible while another account or signed-out context loads", async () => {
  const former: ObservationCommand = { accountId: "account-a", observationId: "523e4567-e89b-42d3-a456-426614174000",
    fieldId: "field-a", seasonId: "season-a", description: "Former account private note", occurredAtLocal: "2026-10-14T12:00",
    occurredAt: "2026-10-14T09:00:00Z", capturedBusinessTimezone: "Europe/Istanbul", state: "NEEDS_ATTENTION" };
  let releaseB!: (commands: ObservationCommand[]) => void;
  const pendingB = new Promise<ObservationCommand[]>((resolve) => { releaseB = resolve; });
  const list = jest.fn((accountId: string) => accountId === "account-a" ? Promise.resolve([former]) : pendingB);
  const GET = jest.fn().mockRejectedValue(new TypeError("offline"));
  const client = { GET } as unknown as ApiClient;
  const store = { list, getContext: async (accountId: string) => accountId === "account-a"
    ? { fieldId: "field-a", seasonId: "season-a", businessTimezone: "Europe/Istanbul" } : null, enqueue: jest.fn() } as never;
  let screen!: ReturnType<typeof create>;
  await act(async () => { screen = create(<ObservationCreateScreen client={client} accountId="account-a" fieldId="field-a" seasonId="season-a" offlineStore={store} />); });
  expect(JSON.stringify(screen.root.findAll(({ props }) => props.accessibilityLabel === "Gözlem için düzeltme gerekiyor").map(({ props }) => props.children))).toContain(former.description);

  await act(async () => { screen.update(<ObservationCreateScreen client={client} accountId="account-b" fieldId="field-a" seasonId="season-a" offlineStore={store} />); });
  expect(list).toHaveBeenLastCalledWith("account-b");
  expect(JSON.stringify(screen.root.findAll(({ props }) => props.accessibilityLabel === "Gözlem için düzeltme gerekiyor").map(({ props }) => props.children))).not.toContain(former.description);

  await act(async () => { screen.update(<ObservationCreateScreen client={client} fieldId="field-a" seasonId="season-a" offlineStore={store} />); });
  expect(JSON.stringify(screen.root.findAll(({ props }) => props.accessibilityLabel === "Gözlem için düzeltme gerekiyor").map(({ props }) => props.children))).not.toContain(former.description);
  await act(async () => { releaseB([]); });
  await act(async () => screen.unmount());
});
