import { act, create, type TestRenderer } from "react-test-renderer";
import type { ApiClient } from "../../../../packages/api-client/src/index";
import { ObservationCreateScreen } from "../../src/features/observations/observation-create-screen";

function node(screen: TestRenderer, label: string) {
  return screen.root.findAll(({ props }) => props.accessibilityLabel === label)[0]! as unknown as { props: { onChangeText: (value: string) => void; onPress: () => void } };
}

it("announces a failed local write as an error, without claiming capture", async () => {
  const GET = jest.fn().mockRejectedValue(new TypeError("offline"));
  const enqueue = jest.fn().mockRejectedValue(new Error("Storage full"));
  const getContext = jest.fn().mockResolvedValue({ fieldId: "field-1", seasonId: null, businessTimezone: "Europe/Istanbul" });
  let screen!: TestRenderer;
  await act(async () => { screen = create(<ObservationCreateScreen client={{ GET } as unknown as ApiClient}
    fieldId="field-1" accountId="account-a" offlineStore={{ getContext, enqueue } as never}
    now={() => new Date("2026-10-14T12:00:00Z")} createId={() => "123e4567-e89b-42d3-a456-426614174000"} />); });
  await act(async () => {
    node(screen, "Gözlem notu").props.onChangeText("Damp soil");
    node(screen, "Gözlem tarihi ve saati").props.onChangeText("2026-10-14T12:00");
  });
  await act(async () => { node(screen, "Gözlemi kaydet").props.onPress(); });
  expect(screen.root.findAll(({ props }) => props.accessibilityRole === "alert" && props.children === "Not cihazda kaydedilemedi. Yeniden deneyin.").length).toBeGreaterThan(0);
  expect(screen.root.findAll(({ props }) => props.accessibilityLabel === "Gözlem cihazda kaydedildi, gönderilmeyi bekliyor")).toHaveLength(0);
  await act(async () => screen.unmount());
});

it("announces pending and accepted states with distinct readable text", async () => {
  const pending = { accountId: "account-a", observationId: "123e4567-e89b-42d3-a456-426614174000",
    fieldId: "field-1", seasonId: null, description: "Damp soil", occurredAtLocal: "2026-10-14T12:00",
    occurredAt: "2026-10-14T09:00:00.000Z", capturedBusinessTimezone: "Europe/Istanbul", state: "PENDING" };
  let commands = [pending];
  let changed: (() => void) | undefined;
  let screen!: TestRenderer;
  await act(async () => { screen = create(<ObservationCreateScreen fieldId="field-1" accountId="account-a"
    offlineStore={{ getContext: async () => ({ fieldId: "field-1", seasonId: null, businessTimezone: "Europe/Istanbul" }),
      list: async () => commands, subscribe: (listener: () => void) => { changed = listener; return () => {}; } } as never}
    now={() => new Date("2026-10-14T12:00:00Z")} />); });
  const pendingStatus = screen.root.findAll(({ props }) => props.accessibilityLabel === "Gözlem gönderilmeyi bekliyor")[0];
  expect(pendingStatus).toBeDefined();
  expect(pendingStatus!.props.accessibilityLiveRegion).toBe("polite");
  expect(screen.root.findAll(({ props }) => props.accessibilityLabel === "Gözlem sunucuda kabul edildi")).toHaveLength(0);
  expect(screen.root.findAll(({ props }) => props.accessibilityLabel === "Gözlem notu").length).toBeGreaterThan(0);
  expect(screen.root.findAll(({ props }) => props.accessibilityLabel === "Gözlem gönderilmeyi bekliyor")[0]!.props.children).toContain("Damp soil");

  commands = [{ ...pending, state: "ACCEPTED" }];
  await act(async () => { changed?.(); });
  const acceptedStatus = screen.root.findAll(({ props }) => props.accessibilityLabel === "Gözlem sunucuda kabul edildi")[0];
  expect(acceptedStatus).toBeDefined();
  expect(acceptedStatus!.props.accessibilityLiveRegion).toBe("polite");
  expect(screen.root.findAll(({ props }) => props.accessibilityLabel === "Gözlem gönderilmeyi bekliyor")).toHaveLength(0);
  await act(async () => screen.unmount());
});

it("keeps the capture controls named and readable without relying on color", async () => {
  let screen!: TestRenderer;
  await act(async () => { screen = create(<ObservationCreateScreen fieldId="field-1" accountId="account-a"
    offlineStore={{ getContext: async () => ({ fieldId: "field-1", seasonId: null, businessTimezone: "Europe/Istanbul" }) } as never}
    now={() => new Date("2026-10-14T12:00:00Z")} />); });
  expect(screen.root.findAll(({ props }) => props.accessibilityRole === "header" && props.children === "Gözlem ekle").length).toBeGreaterThan(0);
  expect(screen.root.findAll(({ props }) => props.accessibilityLabel === "Gözlem notu" && props.editable === true).length).toBeGreaterThan(0);
  expect(screen.root.findAll(({ props }) => props.accessibilityLabel === "Gözlem tarihi ve saati" && props.editable === true).length).toBeGreaterThan(0);
  expect(screen.root.findAll(({ props }) => props.accessibilityLabel === "Gözlemi kaydet").length).toBeGreaterThan(0);
  expect(screen.root.findAll(({ props }) => props.children === "Gözlem ekle").length).toBeGreaterThan(0);
  await act(async () => screen.unmount());
});
