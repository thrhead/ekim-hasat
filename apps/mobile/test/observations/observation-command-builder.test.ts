import * as observationClient from "../../src/features/observations/observation-client";

const build = (input: unknown) => (observationClient as unknown as { buildObservationCommand(value: unknown): unknown }).buildObservationCommand(input);
const valid = {
  accountId: "account-a", observationId: "123e4567-e89b-42d3-a456-426614174000", fieldId: "field-a", seasonId: null,
  description: "  Soil is damp  ", occurredAtLocal: "2026-10-14T12:00", capturedBusinessTimezone: "Europe/Istanbul",
  now: new Date("2026-10-14T12:00:00.000Z"),
};

describe("offline observation command builder", () => {
  it("retains exact original identity, text, wall time, timezone and absolute instant", () => {
    expect(build(valid)).toMatchObject({ accountId: "account-a", observationId: valid.observationId, fieldId: "field-a",
      description: "Soil is damp", occurredAtLocal: "2026-10-14T12:00", occurredAt: "2026-10-14T09:00:00.000Z",
      capturedBusinessTimezone: "Europe/Istanbul", state: "PENDING" });
  });

  it("uses the server's Unicode White_Space trimming before counting and saving", () => {
    expect(build({ ...valid, description: "\u0085Soil is damp\u0085" })).toMatchObject({ description: "Soil is damp" });
    expect(() => build({ ...valid, description: "\u0085" })).toThrow();
  });

  it.each([
    { description: "  " },
    { description: "x".repeat(2001) },
    { occurredAtLocal: "2026-10-14T16:00" },
    { occurredAtLocal: "2026-03-29T02:30", capturedBusinessTimezone: "Europe/Berlin" },
    { occurredAtLocal: "2026-10-25T02:30", capturedBusinessTimezone: "Europe/Berlin" },
  ])("refuses invalid local capture %j", (change) => {
    expect(typeof (observationClient as unknown as { buildObservationCommand?: unknown }).buildObservationCommand).toBe("function");
    expect(() => build({ ...valid, ...change })).toThrow();
  });
});
