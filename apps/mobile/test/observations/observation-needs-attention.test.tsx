import { act, create } from "react-test-renderer";
import type { ApiClient } from "../../../../packages/api-client/src/index";
import { ObservationCreateScreen } from "../../src/features/observations/observation-create-screen";
import type { ObservationCommand } from "../../src/features/observations/observation-command-store";

it("requires an explicit farmer action and a new identity for a corrected local observation", async () => {
  const old: ObservationCommand = { accountId: "a", observationId: "123e4567-e89b-42d3-a456-426614174000",
    fieldId: "f", seasonId: "s", description: "Old note", occurredAtLocal: "2026-10-14T12:00",
    occurredAt: "2026-10-14T09:00:00Z", capturedBusinessTimezone: "Europe/Istanbul", state: "NEEDS_ATTENTION",
    failureCode: "BUSINESS_TIMEZONE_CHANGED" };
  const original = { ...old };
  const enqueue = jest.fn().mockResolvedValue(undefined);
  const store = { list: async () => [old], getContext: async () => ({ fieldId: "f", seasonId: "s", businessTimezone: "Europe/Istanbul" }), enqueue };
  let screen!: ReturnType<typeof create>;
  await act(async () => { screen = create(<ObservationCreateScreen client={{ GET: jest.fn().mockRejectedValue(new TypeError("offline")) } as unknown as ApiClient}
    accountId="a" fieldId="f" seasonId="s" offlineStore={store as never} now={() => new Date("2026-10-14T12:00:00Z")}
    createId={() => "223e4567-e89b-42d3-a456-426614174000"} />); });
  const correction = screen.root.findAll(({ props }) => props.accessibilityLabel === "Düzeltilmiş yeni gözlem oluştur")[0];
  expect(correction).toBeDefined();
  expect(enqueue).not.toHaveBeenCalled();
  await act(async () => { (correction!.props as { onPress(): void }).onPress(); });
  expect((screen.root.findAll(({ props }) => props.accessibilityLabel === "Gözlem notu")[0]!.props as { value: string }).value).toBe("Old note");
  expect((screen.root.findAll(({ props }) => props.accessibilityLabel === "Gözlem tarihi ve saati")[0]!.props as { value: string }).value).toBe("2026-10-14T12:00");
  await act(async () => {
    (screen.root.findAll(({ props }) => props.accessibilityLabel === "Gözlem notu")[0]!.props as { onChangeText(value: string): void }).onChangeText("Corrected field note");
    (screen.root.findAll(({ props }) => props.accessibilityLabel === "Gözlem tarihi ve saati")[0]!.props as { onChangeText(value: string): void }).onChangeText("2026-10-14T13:15");
  });
  await act(async () => { (screen.root.findAll(({ props }) => props.accessibilityLabel === "Gözlemi kaydet")[0]!.props as { onPress(): void }).onPress(); });
  expect(enqueue).toHaveBeenCalledWith("a", expect.objectContaining({
    accountId: "a", observationId: "223e4567-e89b-42d3-a456-426614174000", fieldId: "f", seasonId: "s",
    description: "Corrected field note", occurredAtLocal: "2026-10-14T13:15",
    occurredAt: "2026-10-14T10:15:00.000Z", capturedBusinessTimezone: "Europe/Istanbul", state: "PENDING",
  }));
  expect(old).toEqual(original);
  await act(async () => screen.unmount());
});

it("keeps validation, association, and identity conflicts visible for an explicit decision without retry controls", async () => {
  const commands: ObservationCommand[] = [
    { accountId: "a", observationId: "123e4567-e89b-42d3-a456-426614174000", fieldId: "f", seasonId: "s",
      description: "Validation conflict note", occurredAtLocal: "2026-10-14T12:00", occurredAt: "2026-10-14T09:00:00Z",
      capturedBusinessTimezone: "Europe/Istanbul", state: "NEEDS_ATTENTION", failureCode: "INVALID_REQUEST" },
    { accountId: "a", observationId: "323e4567-e89b-42d3-a456-426614174000", fieldId: "f", seasonId: "s",
      description: "Association conflict note", occurredAtLocal: "2026-10-14T12:00", occurredAt: "2026-10-14T09:00:00Z",
      capturedBusinessTimezone: "Europe/Istanbul", state: "NEEDS_ATTENTION", failureCode: "NOT_FOUND" },
    { accountId: "a", observationId: "423e4567-e89b-42d3-a456-426614174000", fieldId: "f", seasonId: "s",
      description: "Identity conflict note", occurredAtLocal: "2026-10-14T12:00", occurredAt: "2026-10-14T09:00:00Z",
      capturedBusinessTimezone: "Europe/Istanbul", state: "NEEDS_ATTENTION", failureCode: "IDEMPOTENCY_KEY_REUSED" },
  ];
  const enqueue = jest.fn();
  let screen!: ReturnType<typeof create>;
  await act(async () => { screen = create(<ObservationCreateScreen client={{ GET: jest.fn().mockRejectedValue(new TypeError("offline")) } as unknown as ApiClient}
    accountId="a" fieldId="f" seasonId="s" offlineStore={{ list: async () => commands, getContext: async () => ({ fieldId: "f", seasonId: "s", businessTimezone: "Europe/Istanbul" }), enqueue } as never} />); });
  const attention = screen.root.findAll(({ props }) => props.accessibilityLabel === "Gözlem için düzeltme gerekiyor");
  expect(attention.length).toBeGreaterThanOrEqual(3);
  const announced = JSON.stringify(attention.map(({ props }) => props.children));
  expect(announced).toContain("Validation conflict note");
  expect(announced).toContain("Association conflict note");
  expect(announced).toContain("Identity conflict note");
  expect(screen.root.findAll(({ props }) => props.accessibilityLabel === "Düzeltilmiş yeni gözlem oluştur").length).toBeGreaterThanOrEqual(3);
  expect(screen.root.findAll(({ props }) => props.accessibilityLabel === "Kaydı yeniden dene")).toHaveLength(0);
  expect(enqueue).not.toHaveBeenCalled();
  await act(async () => screen.unmount());
});
