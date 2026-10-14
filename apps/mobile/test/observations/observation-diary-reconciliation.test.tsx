import * as diary from "../../src/features/observations/field-diary-screen";
import type { ObservationCommand } from "../../src/features/observations/observation-command-store";
import type { DiaryEntry } from "../../src/features/observations/diary-client";

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
