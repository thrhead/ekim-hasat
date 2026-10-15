import { act, create, type TestRenderer } from "react-test-renderer";
import * as diary from "../../src/features/observations/field-diary-screen";
import type { ObservationCommand } from "../../src/features/observations/observation-command-store";
import type { DiaryEntry } from "../../src/features/observations/diary-client";

function isAccessibleObservationNode(candidate: { props: Record<string, unknown> }, description: string) {
  const node = candidate as unknown as {
    type: unknown;
    props: { accessible?: unknown; style?: { borderWidth?: number }; accessibilityLabel?: unknown };
  };
  return node.type === "View" && node.props.accessible === true && node.props.style?.borderWidth === 1
    && typeof node.props.accessibilityLabel === "string"
    && node.props.accessibilityLabel.startsWith(`Gözlem, ${description}`);
}

const command: ObservationCommand = { accountId: "a", observationId: "observation-a", fieldId: "field-a", seasonId: null,
  description: "Damp soil", occurredAtLocal: "2026-10-14T12:00", occurredAt: "2026-10-14T09:00:00Z",
  capturedBusinessTimezone: "Europe/Istanbul", state: "ACCEPTED",
  acceptedResult: { id: "observation-a", fieldId: "field-a", seasonId: null, description: "Damp soil",
    occurredAt: "2026-10-14T09:00:00Z", businessTimezone: "Europe/Istanbul" } };

it("shows one accepted observation when a retained result and canonical diary row share an ID", () => {
  const reconcile = (diary as unknown as { reconcileObservationRows?: (entries: DiaryEntry[], local: ObservationCommand[]) => unknown[] }).reconcileObservationRows;
  expect(typeof reconcile).toBe("function");
  const canonical: DiaryEntry = { kind: "OBSERVATION", id: "observation-a", fieldId: "field-a", seasonId: null,
    description: "Damp soil", occurredAt: "2026-10-14T09:00:00Z" };
  expect(reconcile!([canonical], [command])).toEqual([canonical]);
  expect(reconcile!([], [command])).toEqual([expect.objectContaining({ kind: "OBSERVATION", id: "observation-a" })]);
});

it("keeps diary occurrence ordering when a retained accepted result is newer than page one", () => {
  const older: DiaryEntry = { kind: "OBSERVATION", id: "older", fieldId: "field-a", seasonId: null,
    description: "Earlier", occurredAt: "2026-10-13T09:00:00Z" };
  expect(diary.reconcileObservationRows([older], [command]).map((entry) => entry.id)).toEqual(["observation-a", "older"]);
});

it("keeps a durable accepted result visible after refresh failure and when page one omits its ID", async () => {
  const older: DiaryEntry = { kind: "OBSERVATION", id: "older", fieldId: "field-a", seasonId: null,
    description: "Earlier field note", occurredAt: "2026-10-13T09:00:00Z" };
  const GET = jest.fn()
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValueOnce({ response: { ok: true, status: 200 }, data: {
      items: [older], nextCursor: "more", businessTimezone: "Europe/Istanbul",
    } });
  const store = { list: jest.fn(async () => [command]) };
  const props = { client: { GET } as never, fieldId: "field-a", accountId: "a", observationStore: store };
  let screen!: TestRenderer;

  await act(async () => { screen = create(<diary.FieldDiaryScreen {...props} />); });
  expect(screen.root.findAll(({ props: nodeProps }) => nodeProps.accessibilityRole === "alert")).not.toHaveLength(0);
  expect(screen.root.findAll((candidate) => isAccessibleObservationNode(candidate, "Damp soil"))).toHaveLength(1);
  await act(async () => screen.unmount());

  await act(async () => { screen = create(<diary.FieldDiaryScreen {...props} />); });
  expect(store.list).toHaveBeenCalledTimes(2);
  expect(screen.root.findAll((candidate) => isAccessibleObservationNode(candidate, "Damp soil"))).toHaveLength(1);
  expect(screen.root.findAll((candidate) => isAccessibleObservationNode(candidate, "Earlier field note"))).toHaveLength(1);
  await act(async () => screen.unmount());
});
