import { act, create, type TestRenderer } from "react-test-renderer";
import type { ApiClient, ObservationDiaryComponents } from "../../../../packages/api-client/src/index";
import { FieldDiaryScreen } from "../../src/features/observations/field-diary-screen";
import { readFieldDiary } from "../../src/features/observations/diary-client";

type Page = ObservationDiaryComponents["schemas"]["DiaryPage"];
const observation: Page["items"][number] = { kind: "OBSERVATION", id: "observation-1", fieldId: "field-1", seasonId: null, description: "Yapraklar sarardı", occurredAt: "2026-10-05T09:00:00Z" };
const completion: Page["items"][number] = { kind: "TASK_COMPLETION", id: "completion-1", fieldId: "field-1", seasonId: "season-1", taskId: "task-1", title: "Sulamayı kontrol et", occurredAt: "2026-10-04T09:00:00Z", plannedLocalDate: "2026-10-03", sourceKind: "VALIDATED_TEMPLATE", templateVersionId: "template-1" };
function page(items: Page["items"] = [], nextCursor: string | null = null): Page { return { items, nextCursor, businessTimezone: "Europe/Istanbul" }; }
function success(data: Page) { return { data, response: { ok: true, status: 200 } }; }
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
async function mount(GET: jest.Mock, onAddObservation?: () => void) {
  let screen!: TestRenderer;
  await act(async () => { screen = create(<FieldDiaryScreen client={{ GET } as unknown as ApiClient} fieldId="field-1" fieldName="Kuzey" seasonId="season-1" seasonName="Buğday" onAddObservation={onAddObservation} />); });
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
    expect(GET).toHaveBeenCalledWith("/fields/{fieldId}/diary", { params: { path: { fieldId: "field-1" }, query: { limit: 50, seasonId: "season-1", cursor: "opaque" } } });
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
