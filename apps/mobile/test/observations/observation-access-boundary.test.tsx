import { act, create } from "react-test-renderer";
import type { ApiClient } from "../../../../packages/api-client/src/index";
import { ObservationCreateScreen } from "../../src/features/observations/observation-create-screen";
import type { ObservationCommand } from "../../src/features/observations/observation-command-store";

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
