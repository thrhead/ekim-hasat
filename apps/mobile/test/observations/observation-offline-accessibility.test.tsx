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
