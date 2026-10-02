import type { ApiClient } from "../../../../packages/api-client/src/index";
import { TodayScreen } from "../../src/features/seasons/today-screen";
import type { TaskCompletionCommandStore, TodaySnapshot } from "../../src/features/tasks/task-completion-command-store";
import type { SeasonOperations, WeatherComponents } from "../../../../packages/api-client/src/index";

type Today = SeasonOperations["getTodayPlannedTasks"]["responses"][200]["content"]["application/json"];
type WeatherItem = WeatherComponents["schemas"]["FieldWeather"];
type WeatherResponse = { data: { items: WeatherItem[]; nextCursor: null }; error: undefined; response: { ok: true; status: 200 } };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}
function weatherItem(fieldName: string, status: "CURRENT" | "STALE" = "CURRENT"): WeatherItem {
  return {
    fieldId: fieldName, fieldName, status, businessTimezone: "Europe/Istanbul", fetchedAt: "2026-10-01T06:00:00.000Z",
    coverage: { startAt: "2026-09-30T21:00:00.000Z", endAt: "2026-10-03T21:00:00.000Z", localStartDate: "2026-10-01", localEndDate: "2026-10-03" },
    current: { observedAt: "2026-10-01T06:00:00.000Z", conditionCode: "CLEAR", conditionLabel: null, temperatureC: 20 },
    dailyForecasts: [],
  };
}
// react-test-renderer v19 ships without declarations; keep the test API narrowly typed.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (callback: () => void | Promise<void>) => Promise<void>;
  create: (element: React.ReactElement) => { toJSON: () => unknown };
};
import { readWeatherOverview } from "../../src/features/weather/weather-client";

describe("weather-owned mobile overview", () => {
  it("loads authorized field weather independently of Today task rows", async () => {
    const page = { items: [], nextCursor: null };
    const GET = jest.fn().mockResolvedValue({ data: page, error: undefined, response: { ok: true, status: 200 } });
    const result = await readWeatherOverview({ GET } as unknown as ApiClient);
    expect(GET).toHaveBeenCalledWith("/weather/fields");
    expect(result).toEqual(page);
    // No task IDs or task endpoint participate in field weather discovery.
    expect(GET.mock.calls[0]).toHaveLength(1);
  });

  it("preserves the API failure status for access and retry presentation", async () => {
    const GET = jest.fn().mockResolvedValue({ error: { error: { code: "FORBIDDEN", message: "Denied", requestId: "req-1" } }, response: { ok: false, status: 403 } });
    await expect(readWeatherOverview({ GET } as unknown as ApiClient)).rejects.toMatchObject({ status: 403 });
  });

  it("follows bounded overview cursors so weather discovery is complete without task identifiers", async () => {
    const first = { items: [{ fieldId: "field-1", fieldName: "A", status: "UNAVAILABLE" }], nextCursor: "next-page" };
    const second = { items: [{ fieldId: "field-2", fieldName: "B", status: "UNAVAILABLE" }], nextCursor: null };
    const GET = jest.fn()
      .mockResolvedValueOnce({ data: first, error: undefined, response: { ok: true, status: 200 } })
      .mockResolvedValueOnce({ data: second, error: undefined, response: { ok: true, status: 200 } });
    const result = await readWeatherOverview({ GET } as unknown as ApiClient);
    expect(GET).toHaveBeenNthCalledWith(1, "/weather/fields");
    expect(GET).toHaveBeenNthCalledWith(2, "/weather/fields", { params: { query: { cursor: "next-page" } } });
    expect(result.items.map(({ fieldId }) => fieldId)).toEqual(["field-1", "field-2"]);
    expect(result.nextCursor).toBeNull();
  });

  it("renders authorized weather in Today when the server returns zero due tasks", async () => {
    const today: Today = { localDate: "2026-10-01", businessTimezone: "Europe/Istanbul", tasks: [] };
    const weather: WeatherComponents["schemas"]["FieldWeather"] = {
      fieldId: "field-1", fieldName: "Kuzey tarla", status: "CURRENT", businessTimezone: "Europe/Istanbul",
      fetchedAt: "2026-10-01T06:15:00.000Z",
      coverage: { startAt: "2026-09-30T21:00:00.000Z", endAt: "2026-10-03T21:00:00.000Z", localStartDate: "2026-10-01", localEndDate: "2026-10-03" },
      current: { observedAt: "2026-10-01T05:30:00.000Z", conditionCode: "CLEAR", conditionLabel: null, temperatureC: 18 },
      dailyForecasts: ["2026-10-01", "2026-10-02", "2026-10-03"].map((localDate) => ({ localDate, conditionCode: "CLEAR", conditionLabel: null, temperatureHighC: 22, temperatureLowC: 12, precipitationChancePercent: 10, windSpeedKph: 8 })),
    };
    const GET = jest.fn(async (path: string) => path === "/today"
      ? { data: today, error: undefined, response: { ok: true, status: 200 } }
      : { data: { items: [weather], nextCursor: null }, error: undefined, response: { ok: true, status: 200 } });
    const snapshotStore = {
      list: jest.fn(async () => []), writeTodaySnapshot: jest.fn(async () => undefined),
      readTodaySnapshot: jest.fn(async () => null), enqueue: jest.fn(), recordAccepted: jest.fn(), recordConflict: jest.fn(),
    } as unknown as TaskCompletionCommandStore;
    let root!: ReturnType<typeof create>;

    await act(async () => {
      root = create(<TodayScreen client={{ GET } as unknown as ApiClient} accountId="account-1" store={snapshotStore} now={() => new Date("2026-10-01T10:00:00.000Z")} />);
    });

    const rendered = JSON.stringify(root.toJSON());
    expect(GET).toHaveBeenCalledWith("/today");
    expect(GET).toHaveBeenCalledWith("/weather/fields");
    expect(rendered).toContain("Bugün için planlanmış iş yok.");
    expect(rendered).toContain("Kuzey tarla");
    expect(rendered).toContain("Güncel hava durumu");
    expect(rendered).toContain("01 Eki");
    expect(rendered).toContain("09:15");
  });

  it("keeps cached Today tasks and pending completion state visible when weather is offline", async () => {
    const task: Today["tasks"][number] = {
      id: "task-offline", seasonId: "season-1", fieldId: "field-1", title: "Sulamayı kontrol et", cropDisplayName: "Arpa",
      plannedLocalDate: "2026-10-01", sourceKind: "MANUAL", taskVersion: 1,
    };
    const cachedToday: TodaySnapshot = {
      localDate: "2026-10-01", businessTimezone: "Europe/Istanbul", tasks: [task], fetchedAt: "2026-10-01T09:00:00.000Z",
    };
    const pending = {
      completionId: "completion-offline", taskId: task.id, seasonId: task.seasonId, fieldId: task.fieldId,
      title: task.title, cropDisplayName: task.cropDisplayName, sourceKind: task.sourceKind, plannedLocalDate: task.plannedLocalDate,
      baseTaskVersion: task.taskVersion, occurredAt: "2026-10-01T09:30:00.000Z",
      request: { completionId: "completion-offline", occurredAt: "2026-10-01T09:30:00.000Z" }, state: "PENDING",
    };
    const GET = jest.fn(async (path: string) => path === "/today"
      ? { data: undefined, error: { code: "UNAVAILABLE" }, response: { ok: false, status: 503 } }
      : Promise.reject(new TypeError("Network request failed")));
    const snapshotStore = {
      list: jest.fn(async () => [pending]), writeTodaySnapshot: jest.fn(async () => undefined),
      readTodaySnapshot: jest.fn(async () => cachedToday), enqueue: jest.fn(), recordAccepted: jest.fn(), recordConflict: jest.fn(),
    } as unknown as TaskCompletionCommandStore;
    let root!: ReturnType<typeof create>;

    await act(async () => {
      root = create(<TodayScreen client={{ GET } as unknown as ApiClient} accountId="account-1" store={snapshotStore} now={() => new Date("2026-10-01T10:00:00.000Z")} />);
    });

    const rendered = JSON.stringify(root.toJSON());
    expect(GET).toHaveBeenCalledWith("/today");
    expect(GET).toHaveBeenCalledWith("/weather/fields");
    expect(rendered).toContain("Çevrimdışı görünüm · sunucudan alınan iş tarihi");
    expect(rendered).toContain("Sulamayı kontrol et");
    expect(rendered).toContain("Eşitleme bekliyor");
    expect(rendered).toContain("Hava durumu yüklenemedi");
    expect(rendered).toContain("Hava durumunu yeniden dene");
    // Today restores commands once on mount and again when its own cached projection is selected.
    expect(snapshotStore.list).toHaveBeenCalledTimes(2);
    expect(snapshotStore.writeTodaySnapshot).not.toHaveBeenCalled();
    expect(snapshotStore.enqueue).not.toHaveBeenCalled();
    expect(snapshotStore.recordAccepted).not.toHaveBeenCalled();
    expect(snapshotStore.recordConflict).not.toHaveBeenCalled();
  });

  it("keeps the newer success when an older overlapping retry succeeds later", async () => {
    await assertWeatherRequestRace({ newest: "success", older: "success" });
  });

  it("keeps newer access denial when an older overlapping retry succeeds later", async () => {
    await assertWeatherRequestRace({ newest: "access-error", older: "success" });
  });

  it("keeps newer success when an older overlapping retry fails later", async () => {
    await assertWeatherRequestRace({ newest: "success", older: "error" });
  });
});

async function assertWeatherRequestRace(outcomes: { newest: "success" | "access-error"; older: "success" | "error" }) {
  const today: Today = { localDate: "2026-10-01", businessTimezone: "Europe/Istanbul", tasks: [] };
  const older = deferred<WeatherResponse>();
  const newest = deferred<WeatherResponse>();
  let weatherCalls = 0;
  const GET = jest.fn((path: string) => {
    if (path === "/today") return Promise.resolve({ data: today, error: undefined, response: { ok: true, status: 200 } });
    weatherCalls++;
    if (weatherCalls === 1) return Promise.resolve({ data: { items: [weatherItem("Başlangıç", "STALE")], nextCursor: null }, error: undefined, response: { ok: true, status: 200 } });
    return weatherCalls === 2 ? older.promise : newest.promise;
  });
  const store = {
    list: jest.fn(async () => []), writeTodaySnapshot: jest.fn(async () => undefined),
    readTodaySnapshot: jest.fn(async () => null), enqueue: jest.fn(), recordAccepted: jest.fn(), recordConflict: jest.fn(),
  } as unknown as TaskCompletionCommandStore;
  let screen!: ReturnType<typeof create>;
  const stableNow = () => new Date("2026-10-01T10:00:00.000Z");
  await act(async () => { screen = create(<TodayScreen client={{ GET } as unknown as ApiClient} accountId="account-race" store={store} now={stableNow} />); });
  const retry = (screen as unknown as { root: { findAll(predicate: (node: { props: Record<string, unknown> }) => boolean): { props: Record<string, unknown> }[] } }).root
    .findAll(({ props }) => props.accessibilityLabel === "Hava durumunu yeniden dene")[0];
  expect(retry).toBeDefined();
  // Call the stale card's retry twice in one event turn so both requests are in flight.
  act(() => {
    (retry!.props.onPress as () => void)();
    (retry!.props.onPress as () => void)();
  });
  expect(weatherCalls).toBe(3);

  if (outcomes.newest === "success") newest.resolve({ data: { items: [weatherItem("Yeni tarla")], nextCursor: null }, error: undefined, response: { ok: true, status: 200 } });
  else newest.resolve({ data: undefined, error: { error: { code: "FORBIDDEN", message: "Denied", requestId: "request-new" } }, response: { ok: false, status: 403 } } as unknown as WeatherResponse);
  await act(async () => { await newest.promise.catch(() => undefined); });

  if (outcomes.older === "success") older.resolve({ data: { items: [weatherItem("Eski tarla")], nextCursor: null }, error: undefined, response: { ok: true, status: 200 } });
  else older.reject(Object.assign(new Error("Old request failed"), { status: 503 }));
  await act(async () => { await older.promise.catch(() => undefined); });

  const rendered = JSON.stringify(screen.toJSON());
  if (outcomes.newest === "access-error") expect(rendered).toContain("Hava durumu erişiminiz doğrulanamadı");
  else {
    expect(rendered).toContain("Yeni tarla");
    expect(rendered).not.toContain("Eski tarla");
  }
  act(() => (screen as unknown as { unmount: () => void }).unmount());
}
