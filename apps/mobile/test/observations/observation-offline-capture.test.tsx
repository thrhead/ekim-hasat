import { act, create, type TestRenderer } from "react-test-renderer";
import type { ApiClient } from "../../../../packages/api-client/src/index";
import { ObservationCreateScreen } from "../../src/features/observations/observation-create-screen";

const observationId = "123e4567-e89b-42d3-a456-426614174000";
const now = () => new Date("2026-10-14T12:00:00.000Z");
function node(screen: TestRenderer, label: string) {
  return screen.root.findAll(({ props }) => props.accessibilityLabel === label)[0]! as unknown as {
    props: {
      onChangeText: (value: string) => void;
      onPress: () => void;
      accessibilityLiveRegion: string;
      disabled?: boolean;
    };
  };
}

describe("offline observation capture", () => {
  it("saves Field and Season context only after the authorized diary read succeeds", async () => {
    const GET = jest.fn().mockResolvedValue({ data: { businessTimezone: "Europe/Istanbul", items: [], nextCursor: null }, response: { ok: true, status: 200 } });
    const saveContext = jest.fn().mockResolvedValue(undefined);
    let screen!: TestRenderer;
    await act(async () => { screen = create(<ObservationCreateScreen client={{ GET } as unknown as ApiClient}
      fieldId="field-1" seasonId="season-1" accountId="account-a"
      offlineStore={{ saveContext } as never} now={now} />); });
    expect(GET).toHaveBeenCalledWith("/fields/{fieldId}/diary", { params: { path: { fieldId: "field-1" }, query: { limit: 1, seasonId: "season-1" } } });
    expect(saveContext).toHaveBeenCalledWith("account-a", {
      fieldId: "field-1", seasonId: "season-1", businessTimezone: "Europe/Istanbul",
    });
    await act(async () => screen.unmount());
  });

  it("saves a note locally after retryable offline restore without making an API request", async () => {
    const POST = jest.fn();
    const enqueue = jest.fn().mockResolvedValue(undefined);
    const onPending = jest.fn();
    const onSignIn = jest.fn();
    const getContext = jest.fn().mockResolvedValue({ fieldId: "field-1", seasonId: null, businessTimezone: "Europe/Istanbul" });
    let screen!: TestRenderer;
    await act(async () => { screen = create(<ObservationCreateScreen
      fieldId="field-1" accountId="account-a" offlineStore={{ getContext, enqueue } as never}
      now={now} createId={() => observationId} onPending={onPending} onSignIn={onSignIn} />); });
    await act(async () => { node(screen, "Oturum aç").props.onPress(); });
    expect(onSignIn).toHaveBeenCalledTimes(1);
    await act(async () => {
      node(screen, "Gözlem notu").props.onChangeText("Soil is damp");
      node(screen, "Gözlem tarihi ve saati").props.onChangeText("2026-10-14T12:00");
    });
    await act(async () => { node(screen, "Gözlemi kaydet").props.onPress(); });
    expect(enqueue).toHaveBeenCalledWith("account-a", expect.objectContaining({ observationId, description: "Soil is damp", state: "PENDING" }));
    expect(onPending).toHaveBeenCalledTimes(1);
    expect(POST).not.toHaveBeenCalled();
    expect(node(screen, "Gözlem cihazda kaydedildi, gönderilmeyi bekliyor").props.accessibilityLiveRegion).toBe("polite");
    await act(async () => screen.unmount());
  });

  it("keeps an add-another action available after the first offline note is saved", async () => {
    const firstId = observationId;
    const secondId = "223e4567-e89b-42d3-a456-426614174000";
    const commands: Array<{ observationId: string; accountId: string; fieldId: string; seasonId: null; description: string;
      occurredAtLocal: string; occurredAt: string; capturedBusinessTimezone: string; state: "PENDING" }> = [];
    let listener: (() => void) | undefined;
    const store = { getContext: async () => ({ fieldId: "field-1", seasonId: null, businessTimezone: "Europe/Istanbul" }),
      enqueue: async (_account: string, command: (typeof commands)[number]) => { commands.push(command); listener?.(); },
      list: async () => commands, subscribe: (onChange: () => void) => { listener = onChange; return () => { listener = undefined; }; } };
    const createId = jest.fn().mockReturnValueOnce(firstId).mockReturnValueOnce(secondId);
    let screen!: TestRenderer;
    await act(async () => { screen = create(<ObservationCreateScreen accountId="account-a" fieldId="field-1"
      offlineStore={store as never} now={now} createId={createId} />); });
    await act(async () => {
      node(screen, "Gözlem notu").props.onChangeText("First offline note");
      node(screen, "Gözlem tarihi ve saati").props.onChangeText("2026-10-14T12:00");
    });
    await act(async () => { node(screen, "Gözlemi kaydet").props.onPress(); });
    expect(commands.map((command) => command.observationId)).toEqual([firstId]);
    expect(screen.root.findAll(({ props }) => props.accessibilityLabel === "Yeni gözlem ekle").length).toBeGreaterThan(0);
    await act(async () => { node(screen, "Yeni gözlem ekle").props.onPress(); });
    await act(async () => {
      node(screen, "Gözlem notu").props.onChangeText("Second offline note");
      node(screen, "Gözlem tarihi ve saati").props.onChangeText("2026-10-14T12:10");
    });
    await act(async () => { node(screen, "Gözlemi kaydet").props.onPress(); });
    expect(commands.map((command) => command.observationId)).toEqual([firstId, secondId]);
    await act(async () => screen.unmount());
  });

  it("does not enqueue the same confirmation twice while the durable write is pending", async () => {
    let finishWrite!: () => void;
    const enqueue = jest.fn(() => new Promise<void>((resolve) => { finishWrite = resolve; }));
    let screen!: TestRenderer;
    await act(async () => { screen = create(<ObservationCreateScreen fieldId="field-1" accountId="account-a"
      offlineStore={{ getContext: async () => ({ fieldId: "field-1", seasonId: null, businessTimezone: "Europe/Istanbul" }), enqueue } as never}
      now={now} createId={() => observationId} />); });
    await act(async () => {
      node(screen, "Gözlem notu").props.onChangeText("Soil is damp");
      node(screen, "Gözlem tarihi ve saati").props.onChangeText("2026-10-14T12:00");
    });
    const confirm = node(screen, "Gözlemi kaydet").props.onPress;
    await act(async () => { confirm(); confirm(); });
    expect(enqueue).toHaveBeenCalledTimes(1);
    await act(async () => { finishWrite(); });
    expect(node(screen, "Gözlem cihazda kaydedildi, gönderilmeyi bekliyor")).toBeDefined();
    await act(async () => screen.unmount());
  });

  it("refuses offline capture when no saved observation context is available", async () => {
    const getContext = jest.fn().mockResolvedValue(null);
    const enqueue = jest.fn();
    let screen!: TestRenderer;
    await act(async () => { screen = create(<ObservationCreateScreen fieldId="field-1" accountId="account-a"
      offlineStore={{ getContext, enqueue } as never} now={now} />); });
    expect(getContext).toHaveBeenCalledWith("account-a", "field-1", null);
    expect(node(screen, "Gözlemi kaydet").props.disabled).toBe(true);
    expect(screen.root.findAll(({ props }) => props.accessibilityRole === "alert").map(({ props }) => props.children).join(" "))
      .toContain("Tarla bilgileri yüklenemedi");
    expect(enqueue).not.toHaveBeenCalled();
    await act(async () => screen.unmount());
  });

  it("updates a locally pending note after the durable canonical result arrives", async () => {
    const base = { accountId: "account-a", observationId, fieldId: "field-1", seasonId: null,
      description: "Soil is damp", occurredAtLocal: "2026-10-14T12:00",
      occurredAt: "2026-10-14T09:00:00.000Z", capturedBusinessTimezone: "Europe/Istanbul" };
    let commands = [{ ...base, state: "PENDING" }];
    let listener: (() => void) | undefined;
    const store = { getContext: async () => ({ fieldId: "field-1", seasonId: null, businessTimezone: "Europe/Istanbul" }),
      enqueue: jest.fn(), list: async () => commands,
      subscribe: (value: () => void) => { listener = value; return () => { listener = undefined; }; } };
    let screen!: TestRenderer;
    await act(async () => { screen = create(<ObservationCreateScreen accountId="account-a" fieldId="field-1"
      offlineStore={store as never} now={now} />); });
    expect(node(screen, "Gözlem gönderilmeyi bekliyor")).toBeDefined();
    commands = [{ ...base, state: "ACCEPTED" }];
    await act(async () => { listener?.(); });
    expect(node(screen, "Gözlem sunucuda kabul edildi")).toBeDefined();
    expect(screen.root.findAll(({ props }) => props.accessibilityLabel === "Gözlem gönderilmeyi bekliyor")).toHaveLength(0);
    await act(async () => screen.unmount());
  });

  it("does not reuse saved context after the server definitively denies the current Field read", async () => {
    const GET = jest.fn().mockResolvedValue({ response: { ok: false, status: 403 }, error: { error: { code: "FORBIDDEN" } } });
    const enqueue = jest.fn();
    const getContext = jest.fn().mockResolvedValue({ fieldId: "field-1", seasonId: null, businessTimezone: "Europe/Istanbul" });
    let screen!: TestRenderer;
    await act(async () => { screen = create(<ObservationCreateScreen client={{ GET } as unknown as ApiClient}
      accountId="account-a" fieldId="field-1" offlineStore={{ getContext, enqueue } as never} now={now} />); });
    expect(node(screen, "Gözlemi kaydet").props).toMatchObject({ disabled: true });
    expect(getContext).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    await act(async () => screen.unmount());
  });

  it("does not fall back to saved context when the authorized response has an invalid timezone", async () => {
    const GET = jest.fn().mockResolvedValue({ response: { ok: true, status: 200 }, data: { businessTimezone: "Invalid/Timezone" } });
    const getContext = jest.fn().mockResolvedValue({ fieldId: "field-1", seasonId: null, businessTimezone: "Europe/Istanbul" });
    let screen!: TestRenderer;
    await act(async () => { screen = create(<ObservationCreateScreen client={{ GET } as unknown as ApiClient}
      accountId="account-a" fieldId="field-1" offlineStore={{ getContext, enqueue: jest.fn() } as never} now={now} />); });
    expect(node(screen, "Gözlemi kaydet").props).toMatchObject({ disabled: true });
    expect(getContext).not.toHaveBeenCalled();
    await act(async () => screen.unmount());
  });

  it("removes the local pending announcement after canonical acceptance is durably recorded", async () => {
    let commands: Array<{ accountId: string; observationId: string; fieldId: string; seasonId: null;
      description: string; occurredAtLocal: string; occurredAt: string; capturedBusinessTimezone: string; state: "PENDING" | "ACCEPTED" }> = [];
    let listener: (() => void) | undefined;
    const store = { getContext: async () => ({ fieldId: "field-1", seasonId: null, businessTimezone: "Europe/Istanbul" }),
      enqueue: async (_account: string, command: (typeof commands)[number]) => {
        commands.push(command); listener?.();
      },
      list: async () => commands, subscribe: (value: () => void) => { listener = value; return () => { listener = undefined; }; } };
    let screen!: TestRenderer;
    await act(async () => { screen = create(<ObservationCreateScreen accountId="account-a" fieldId="field-1"
      offlineStore={store as never} now={now} createId={() => observationId} />); });
    await act(async () => {
      node(screen, "Gözlem notu").props.onChangeText("Soil is damp");
      node(screen, "Gözlem tarihi ve saati").props.onChangeText("2026-10-14T12:00");
    });
    await act(async () => { node(screen, "Gözlemi kaydet").props.onPress(); });
    expect(node(screen, "Gözlem cihazda kaydedildi, gönderilmeyi bekliyor")).toBeDefined();
    commands = commands.map((command) => ({ ...command, state: "ACCEPTED" }));
    await act(async () => { listener?.(); });
    expect(screen.root.findAll(({ props }) => props.accessibilityLabel === "Gözlem cihazda kaydedildi, gönderilmeyi bekliyor")).toHaveLength(0);
    expect(node(screen, "Gözlem sunucuda kabul edildi")).toBeDefined();
    await act(async () => screen.unmount());
  });
});
