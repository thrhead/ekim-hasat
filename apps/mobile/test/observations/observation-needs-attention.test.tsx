import { act, create } from "react-test-renderer";
import type { ApiClient } from "../../../../packages/api-client/src/index";
import { ObservationCreateScreen } from "../../src/features/observations/observation-create-screen";
import type { ObservationCommand } from "../../src/features/observations/observation-command-store";

it("requires an explicit farmer action and a new identity for a corrected local observation", async () => {
  const old: ObservationCommand = { accountId: "a", observationId: "123e4567-e89b-42d3-a456-426614174000",
    fieldId: "f", seasonId: null, description: "Old note", occurredAtLocal: "2026-10-14T12:00",
    occurredAt: "2026-10-14T09:00:00Z", capturedBusinessTimezone: "Europe/Istanbul", state: "NEEDS_ATTENTION" };
  const enqueue = jest.fn().mockResolvedValue(undefined);
  const store = { list: async () => [old], getContext: async () => ({ fieldId: "f", seasonId: null, businessTimezone: "Europe/Istanbul" }), enqueue };
  let screen!: ReturnType<typeof create>;
  await act(async () => { screen = create(<ObservationCreateScreen client={{ GET: jest.fn().mockRejectedValue(new TypeError("offline")) } as unknown as ApiClient}
    accountId="a" fieldId="f" offlineStore={store as never} now={() => new Date("2026-10-14T12:00:00Z")}
    createId={() => "223e4567-e89b-42d3-a456-426614174000"} />); });
  const correction = screen.root.findAll(({ props }) => props.accessibilityLabel === "Düzeltilmiş yeni gözlem oluştur")[0];
  expect(correction).toBeDefined();
  await act(async () => { (correction!.props as { onPress(): void }).onPress(); });
  expect((screen.root.findAll(({ props }) => props.accessibilityLabel === "Gözlem notu")[0]!.props as { value: string }).value).toBe("Old note");
  await act(async () => { (screen.root.findAll(({ props }) => props.accessibilityLabel === "Gözlemi kaydet")[0]!.props as { onPress(): void }).onPress(); });
  expect(enqueue).toHaveBeenCalledWith("a", expect.objectContaining({ observationId: "223e4567-e89b-42d3-a456-426614174000" }));
  expect(old.observationId).toBe("123e4567-e89b-42d3-a456-426614174000");
  await act(async () => screen.unmount());
});
