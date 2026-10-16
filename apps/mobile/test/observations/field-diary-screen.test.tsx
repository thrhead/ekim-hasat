import { act, create, type TestRenderer } from "react-test-renderer";
import type { ApiClient, ObservationDiaryComponents } from "../../../../packages/api-client/src/index";
import { FieldDiaryScreen } from "../../src/features/observations/field-diary-screen";
import { readFieldDiary } from "../../src/features/observations/diary-client";

type Page = ObservationDiaryComponents["schemas"]["DiaryPage"];
const observation: Page["items"][number] = { kind: "OBSERVATION", id: "observation-1", fieldId: "field-1", seasonId: null, description: "Yapraklar sarardı", occurredAt: "2026-10-05T09:00:00Z" };
const completion: Page["items"][number] = { kind: "TASK_COMPLETION", id: "completion-1", fieldId: "field-1", seasonId: "season-1", taskId: "task-1", title: "Sulamayı kontrol et", occurredAt: "2026-10-04T09:00:00Z", plannedLocalDate: "2026-10-03", sourceKind: "VALIDATED_TEMPLATE", templateVersionId: "template-1" };
const skipped: Page["items"][number] = { kind: "TASK_SKIPPED", id: "skip-1", fieldId: "field-1", seasonId: "season-1", taskId: "task-2", title: "Sürmeyi atla", skippedAt: "2026-10-04T10:00:00Z", plannedLocalDate: "2026-10-03", sourceKind: "VALIDATED_TEMPLATE", templateVersionId: "template-1", skipId: "skip-1" };
const irrigation: Page["items"][number] = { kind: "IRRIGATION", id: "irrigation-1", fieldId: "field-1", seasonId: "season-1", method: "Damlama", durationMinutes: 15, waterVolumeCubicMetres: "2.5", note: "Sabah sulaması", occurredAt: "2026-10-05T09:00:00Z", recordedAt: "2026-10-05T09:05:00Z", businessTimezone: "Europe/Istanbul" };
const expense: Extract<Page["items"][number], { kind: "EXPENSE" }> = { kind: "EXPENSE", id: "expense-1", fieldId: "field-1", seasonId: "season-1", amount: "12.345678", currency: "TRY", category: "FERTILIZER", expenseDate: "2026-10-05", note: null };
function page(items: Page["items"] = [], nextCursor: string | null = null): Page { return { items, nextCursor, businessTimezone: "Europe/Istanbul" }; }
function success(data: Page) { return { data, response: { ok: true, status: 200 } }; }
function forbidden() { return { error: { error: { code: "FORBIDDEN", message: "private detail", requestId: "r1" } }, response: { ok: false, status: 403 } }; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}
function node(screen: TestRenderer, label: string) {
  const found = screen.root.findAll(({ props }) => props.accessibilityLabel === label)[0];
  expect(found).toBeDefined(); return found!;
}
function text(screen: TestRenderer) {
  return screen.root.findAll(({ props }) => typeof props.children === "string" || Array.isArray(props.children)).flatMap(({ props }) => [props.children].flat().filter((child) => typeof child === "string")).join(" ");
}
async function mount(GET: jest.Mock, onAddObservation?: () => void, observationStore?: { list: jest.Mock }, onAddIrrigation?: () => void, onAddExpense?: () => void) {
  let screen!: TestRenderer;
  await act(async () => { screen = create(<FieldDiaryScreen client={{ GET } as unknown as ApiClient} fieldId="field-1" fieldName="Kuzey" seasonId="season-1" seasonName="Buğday" onAddObservation={onAddObservation} onAddIrrigation={onAddIrrigation} onAddExpense={onAddExpense} accountId={observationStore ? "account-1" : undefined} observationStore={observationStore as never} />); });
  return screen;
}
async function press(screen: TestRenderer, label: string) {
  await act(async () => { (node(screen, label).props.onPress as () => void)(); });
}

describe("Field/Season diary", () => {
  it("requests exactly one bounded generated API page with Field, Season and cursor scope", async () => {
    const data = page([observation]);
    const GET = jest.fn().mockResolvedValue(success(data));
    expect(await readFieldDiary({ GET } as unknown as ApiClient, "field-1", { seasonId: "season-1", cursor: "opaque" })).toEqual(data);
    expect(GET).toHaveBeenCalledTimes(1);
    expect(GET).toHaveBeenCalledWith("/fields/{fieldId}/diary", { params: { path: { fieldId: "field-1" }, query: { limit: 50, seasonId: "season-1", cursor: "opaque", includeIrrigation: true } } });
  });

  it("keeps structured permission failures privacy safe", async () => {
    const GET = jest.fn().mockResolvedValue({ error: { error: { code: "NOT_FOUND", message: "private detail", requestId: "r1" } }, response: { ok: false, status: 404 } });
    await expect(readFieldDiary({ GET } as unknown as ApiClient, "other-field")).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    await expect(readFieldDiary({ GET } as unknown as ApiClient, "other-field")).rejects.not.toThrow("private detail");
  });

  it("shows mixed rows in server order with Business-timezone occurrence and completion provenance", async () => {
    const manual = { ...completion, id: "manual", sourceKind: "MANUAL", templateVersionId: null, title: "Elle eklenen işin adı" } as Page["items"][number];
    const screen = await mount(jest.fn().mockResolvedValue(success(page([observation, completion, manual]))));
    const rendered = text(screen);
    expect(rendered).toContain("Kuzey"); expect(rendered).toContain("Buğday");
    expect(rendered).toContain("Gözlem"); expect(rendered).toContain("Tamamlanan iş");
    expect(rendered).toContain("Yapraklar sarardı"); expect(rendered).toContain("Sulamayı kontrol et");
    expect(rendered.indexOf("Yapraklar sarardı")).toBeLessThan(rendered.indexOf("Sulamayı kontrol et"));
    expect(rendered).toContain("12:00"); expect(rendered).toContain("Europe/Istanbul");
    expect(rendered).toContain("Planlanan gün:"); expect(rendered).toContain("03 Eki 2026");
    expect(rendered).toContain("Onaylı plana göre"); expect(rendered).toContain("Elle eklenen iş");
    expect(rendered).not.toContain("template-1");
    expect(node(screen, "Günlük yüklendi").props.accessibilityLiveRegion).toBe("polite");
    await act(async () => screen.unmount());
  });

  it("orders timed entries by kind before descending UUID when instants tie", async () => {
    const observationTie = { ...observation, id: "00000000-0000-4000-8000-000000000001", occurredAt: "2026-10-05T09:00:00Z" };
    const completionTie = { ...completion, id: "ffffffff-ffff-4fff-8fff-ffffffffffff", occurredAt: "2026-10-05T09:00:00Z" };
    const screen = await mount(jest.fn().mockResolvedValue(success(page([completionTie, observationTie]))));
    const rendered = text(screen);
    expect(rendered.indexOf("Yapraklar sarardı")).toBeLessThan(rendered.indexOf("Sulamayı kontrol et"));
    await act(async () => screen.unmount());
  });

  it("renders skipped work as its own diary event, never as a completion", async () => {
    const screen = await mount(jest.fn().mockResolvedValue(success(page([skipped]))));
    const rendered = text(screen);
    expect(rendered).toContain("Görev atlandı"); expect(rendered).toContain("Sürmeyi atla");
    expect(rendered).toContain("Planlanan gün"); expect(rendered).toContain("Atlanma zamanı");
    expect(rendered).not.toContain("Tamamlanan iş"); expect(rendered).not.toContain("Sezonda tamamlanan iş");
  });

  it("renders irrigation as a distinct Business-timezone event outside observation reconciliation", async () => {
    const acceptedObservation = { accountId: "account-1", observationId: "observation-local", fieldId: "field-1", seasonId: "season-1", description: "Yerelde kabul edilen gözlem", occurredAtLocal: "2026-10-05T12:00", occurredAt: "2026-10-05T09:00:00Z", capturedBusinessTimezone: "Europe/Istanbul", state: "ACCEPTED", acceptedResult: { id: "observation-local" } };
    const store = { list: jest.fn().mockResolvedValue([acceptedObservation]) };
    const screen = await mount(jest.fn().mockResolvedValue(success(page([irrigation]))), undefined, store);
    const rendered = text(screen);
    expect(rendered).toContain("Sulama kaydı"); expect(rendered).toContain("Damlama");
    expect(rendered).toContain("2,5 m³"); expect(rendered).toContain("15 dakika");
    expect(rendered).toContain("12:00"); expect(rendered).toContain("Europe/Istanbul");
    expect(rendered).toContain("Yerelde kabul edilen gözlem");
    expect(rendered).not.toContain("Tamamlanan iş"); expect(rendered).not.toContain("Planlanan gün");
    expect(node(screen, "Günlük yüklendi").props.children).toBe("1 kayıt gösteriliyor");
    await act(async () => screen.unmount());
  });

  it("announces loading then an empty state with the permitted create action", async () => {
    const pending = deferred<ReturnType<typeof success>>();
    const onAdd = jest.fn();
    const screen = await mount(jest.fn(() => pending.promise), onAdd);
    expect(node(screen, "Günlük yükleniyor").props.accessibilityRole).toBe("progressbar");
    expect(node(screen, "Günlük yükleniyor").props.accessibilityLiveRegion).toBe("polite");
    expect(text(screen)).not.toContain("Henüz kayıt yok");
    await act(async () => { pending.resolve(success(page())); });
    expect(node(screen, "Henüz kayıt yok").props.accessibilityLiveRegion).toBe("polite");
    await press(screen, "Gözlem ekle"); expect(onAdd).toHaveBeenCalledTimes(1);
    await act(async () => screen.unmount());
  });

  it("opens irrigation capture from the diary when the entry action is supplied", async () => {
    const onAddIrrigation = jest.fn();
    const screen = await mount(jest.fn().mockResolvedValue(success(page())), undefined, undefined, onAddIrrigation);
    await press(screen, "Sulama kaydı ekle");
    expect(onAddIrrigation).toHaveBeenCalledTimes(1);
    await act(async () => screen.unmount());
  });

  it("shows retryable initial failure without fabricating accepted entries", async () => {
    const GET = jest.fn().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce(success(page([observation])));
    const screen = await mount(GET);
    expect(screen.root.findAll(({ props }) => props.accessibilityRole === "alert" && props.accessibilityLiveRegion === "assertive")).not.toHaveLength(0);
    expect(text(screen)).not.toContain("Henüz kayıt yok");
    await press(screen, "Günlüğü yeniden dene");
    expect(text(screen)).toContain(observation.description);
    await act(async () => screen.unmount());
  });

  it("loads older entries only on request, preserving the cursor and rows across continuation failure", async () => {
    const GET = jest.fn().mockResolvedValueOnce(success(page([observation], "older"))).mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce(success(page([completion])));
    const screen = await mount(GET);
    expect(GET).toHaveBeenCalledTimes(1);
    await press(screen, "Daha eski kayıtları yükle");
    expect(text(screen)).toContain(observation.description);
    await press(screen, "Günlüğü yeniden dene");
    expect(GET.mock.calls[1]).toEqual(GET.mock.calls[2]);
    expect(GET.mock.calls[2]![1].params.query.cursor).toBe("older");
    expect(text(screen)).toContain(observation.description); expect(text(screen)).toContain(completion.title);
    expect(node(screen, "Günlük yüklendi").props.children).toBe("2 kayıt gösteriliyor");
    expect(screen.root.findAll(({ props }) => props.accessibilityLabel === "Daha eski kayıtları yükle")).toHaveLength(0);
    await act(async () => screen.unmount());
  });

  it("prevents duplicate continuation requests while older records are loading", async () => {
    const pending = deferred<ReturnType<typeof success>>();
    const GET = jest.fn().mockResolvedValueOnce(success(page([observation], "older"))).mockImplementationOnce(() => pending.promise);
    const screen = await mount(GET);
    const more = node(screen, "Daha eski kayıtları yükle").props.onPress as () => void;
    await act(async () => { more(); more(); });
    expect(GET).toHaveBeenCalledTimes(2);
    expect(node(screen, "Daha eski kayıtları yükle").props.accessibilityState).toMatchObject({ disabled: true, busy: true });
    expect(node(screen, "Eski kayıtlar yükleniyor").props.accessibilityLiveRegion).toBe("polite");
    await act(async () => { pending.resolve(success(page([completion]))); });
    await act(async () => screen.unmount());
  });

  it.each(["field", "season"])("ignores obsolete success when %s context changes", async (change) => {
    const old = deferred<ReturnType<typeof success>>();
    const GET = jest.fn().mockImplementationOnce(() => old.promise).mockResolvedValueOnce(success(page([{ ...observation, description: "Yeni bağlam" }])));
    const client = { GET } as unknown as ApiClient;
    let screen!: TestRenderer;
    await act(async () => { screen = create(<FieldDiaryScreen client={client} fieldId="field-1" seasonId="season-1" />); });
    await act(async () => { screen.update(<FieldDiaryScreen client={client} fieldId={change === "field" ? "field-2" : "field-1"} seasonId="season-2" />); });
    await act(async () => { old.resolve(success(page([observation]))); });
    expect(text(screen)).toContain("Yeni bağlam"); expect(text(screen)).not.toContain(observation.description);
    await act(async () => screen.unmount());
  });

  it("clears accepted rows when continuation revalidates access and denies it", async () => {
    const GET = jest.fn().mockResolvedValueOnce(success(page([observation], "older"))).mockResolvedValueOnce({ error: { error: { code: "FORBIDDEN", message: "private", requestId: "r1" } }, response: { ok: false, status: 403 } });
    const screen = await mount(GET);
    await press(screen, "Daha eski kayıtları yükle");
    expect(text(screen)).not.toContain(observation.description);
    expect(text(screen)).toContain("erişiminiz doğrulanamadı");
    expect(text(screen)).not.toContain("private");
    await act(async () => screen.unmount());
  });

  it("ignores obsolete errors after a new Season context successfully loads", async () => {
    const old = deferred<ReturnType<typeof success>>();
    const GET = jest.fn().mockImplementationOnce(() => old.promise).mockResolvedValueOnce(success(page([observation])));
    const client = { GET } as unknown as ApiClient;
    let screen!: TestRenderer;
    await act(async () => { screen = create(<FieldDiaryScreen client={client} fieldId="field-1" seasonId="season-1" />); });
    await act(async () => { screen.update(<FieldDiaryScreen client={client} fieldId="field-1" seasonId="season-2" />); });
    await act(async () => { old.reject(new TypeError("old offline")); });
    expect(text(screen)).toContain(observation.description);
    expect(screen.root.findAll(({ props }) => props.accessibilityRole === "alert")).toHaveLength(0);
    await act(async () => screen.unmount());
  });
});

describe("Expense-enabled Field Diary", () => {
  it("loads the OWNER projection and renders an Expense date without an implied occurrence time", async () => {
    const onAddExpense = jest.fn();
    const GET = jest.fn().mockResolvedValue(success(page([irrigation, expense])));
    const screen = await mount(GET, undefined, undefined, undefined, onAddExpense);
    expect(GET).toHaveBeenCalledWith("/fields/{fieldId}/diary", { params: { path: { fieldId: "field-1" }, query: { limit: 50, seasonId: "season-1", includeIrrigation: true, includeExpenses: true } } });
    const expenseRow = screen.root.findAll(({ props }) => typeof props.accessibilityLabel === "string" && props.accessibilityLabel.startsWith("Gider,"))[0];
    expect(expenseRow).toBeDefined();
    expect(expenseRow!.props.accessibilityLabel).toContain("12.345678 TRY");
    expect(expenseRow!.props.accessibilityLabel).toContain("05 Eki 2026");
    expect(expenseRow!.props.accessibilityLabel).not.toMatch(/\d{2}:\d{2}|Europe\/Istanbul|Gerçekleşti/);
    expect(text(screen)).toContain("Sulama kaydı");
    await press(screen, "Gider ekle");
    expect(onAddExpense).toHaveBeenCalledTimes(1);
    await act(async () => screen.unmount());
  });

  it("keeps same-Business-day timed rows ahead of a date-only Expense in a negative-offset timezone", async () => {
    const timed = { ...observation, description: "Sabah kontrolü", occurredAt: "2026-10-06T10:00:00Z" };
    const data = { ...page([timed, { ...expense, expenseDate: "2026-10-06" }]), businessTimezone: "America/Los_Angeles" };
    const screen = await mount(jest.fn().mockResolvedValue(success(data)), undefined, undefined, undefined, jest.fn());
    const rendered = text(screen);
    expect(rendered.indexOf("Sabah kontrolü")).toBeLessThan(rendered.indexOf("12.345678"));
    const expenseRow = screen.root.findAll(({ props }) => {
      const label = props.accessibilityLabel;
      return typeof label === "string" && label.startsWith("Gider, 12.345678");
    })[0];
    const expenseLabel = expenseRow?.props.accessibilityLabel;
    expect(typeof expenseLabel).toBe("string");
    if (typeof expenseLabel !== "string") throw new Error("Expense row accessibility label was missing");
    expect(expenseLabel).not.toMatch(/\d{2}:\d{2}|America\/Los_Angeles|Gerçekleşti/);
    await act(async () => screen.unmount());
  });

  it("retries a denied first V2 page exactly once as V1 from the first page", async () => {
    const GET = jest.fn().mockResolvedValueOnce(forbidden()).mockResolvedValueOnce(success(page([observation])));
    const screen = await mount(GET, undefined, undefined, undefined, jest.fn());
    expect(GET).toHaveBeenCalledTimes(2);
    expect(GET.mock.calls[0]![1].params.query.includeExpenses).toBe(true);
    expect(GET.mock.calls[1]![1].params.query).toEqual({ limit: 50, seasonId: "season-1", includeIrrigation: true });
    expect(text(screen)).toContain(observation.description);
    expect(text(screen)).not.toContain("private detail");
    expect(screen.root.findAll(({ props }) => props.accessibilityLabel === "Gider ekle")).toHaveLength(0);
    await act(async () => screen.unmount());
  });

  it("abandons a denied later V2 page, hides old Expenses immediately, and keeps ordinary rows during V1 retry", async () => {
    const fallback = deferred<ReturnType<typeof success>>();
    const GET = jest.fn().mockResolvedValueOnce(success(page([observation, expense], "v2-cursor")))
      .mockResolvedValueOnce(forbidden()).mockImplementationOnce(() => fallback.promise);
    const screen = await mount(GET, undefined, undefined, undefined, jest.fn());
    expect(screen.root.findAll(({ props }) => typeof props.accessibilityLabel === "string" && props.accessibilityLabel.startsWith("Gider,"))).toHaveLength(2);
    await press(screen, "Daha eski kayıtları yükle");
    expect(GET).toHaveBeenCalledTimes(3);
    expect(GET.mock.calls[1]![1].params.query.cursor).toBe("v2-cursor");
    expect(GET.mock.calls[2]![1].params.query).toEqual({ limit: 50, seasonId: "season-1", includeIrrigation: true });
    expect(text(screen)).toContain(observation.description);
    expect(screen.root.findAll(({ props }) => typeof props.accessibilityLabel === "string" && props.accessibilityLabel.startsWith("Gider,"))).toHaveLength(0);
    await act(async () => { fallback.resolve(success(page([observation]))); });
    await act(async () => screen.unmount());
  });

  it("replaces V2 rows with the V1 first page, then continues only with the V1 cursor", async () => {
    const fresh = { ...observation, id: "observation-fresh", description: "V1 ilk sayfa kaydı" };
    const older = { ...observation, id: "observation-older", description: "V1 eski sayfa kaydı" };
    const GET = jest.fn().mockResolvedValueOnce(success(page([observation, expense], "v2-cursor")))
      .mockResolvedValueOnce(forbidden()).mockResolvedValueOnce(success(page([fresh], "v1-cursor")))
      .mockResolvedValueOnce(success(page([older])));
    const screen = await mount(GET, undefined, undefined, undefined, jest.fn());
    await press(screen, "Daha eski kayıtları yükle");
    expect(text(screen)).toContain(fresh.description);
    expect(text(screen)).not.toContain(observation.description);
    expect(screen.root.findAll(({ props }) => typeof props.accessibilityLabel === "string" && props.accessibilityLabel.startsWith("Gider,"))).toHaveLength(0);
    await press(screen, "Daha eski kayıtları yükle");
    expect(GET.mock.calls[3]![1].params.query).toEqual({ limit: 50, seasonId: "season-1", includeIrrigation: true, cursor: "v1-cursor" });
    expect(text(screen)).toContain(fresh.description);
    expect(text(screen)).toContain(older.description);
    expect(text(screen)).not.toContain(observation.description);
    await act(async () => screen.unmount());
  });

  it.each(["initial", "later"])("clears inaccessible rows when V1 also denies after %s V2 denial", async (phase) => {
    const GET = phase === "initial"
      ? jest.fn().mockResolvedValueOnce(forbidden()).mockResolvedValueOnce(forbidden())
      : jest.fn().mockResolvedValueOnce(success(page([observation, expense], "v2-cursor")))
        .mockResolvedValueOnce(forbidden()).mockResolvedValueOnce(forbidden());
    const screen = await mount(GET, undefined, undefined, undefined, jest.fn());
    if (phase === "later") await press(screen, "Daha eski kayıtları yükle");
    expect(GET).toHaveBeenCalledTimes(phase === "initial" ? 2 : 3);
    expect(text(screen)).toContain("erişiminiz doğrulanamadı");
    expect(text(screen)).not.toContain(observation.description);
    expect(screen.root.findAll(({ props }) => typeof props.accessibilityLabel === "string" && props.accessibilityLabel.startsWith("Gider,"))).toHaveLength(0);
    expect(text(screen)).not.toContain("private detail");
    await act(async () => screen.unmount());
  });
});
