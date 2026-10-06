import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../../src/observability/api-error.filter.js";

type ObservationTimeResolver = (
  occurredAtLocal: string,
  submittedOccurredAt: string,
  businessTimezone: string | null | undefined,
) => { occurredAt: Date; businessTimezone: string };

async function resolver(): Promise<ObservationTimeResolver> {
  const module = await import("../../src/seasons/business-timezone.js");
  const fn = (module as unknown as Record<string, unknown>).resolveBusinessObservationInstant;
  assert.equal(typeof fn, "function", "Business timezone utility must resolve observation wall times");
  return fn as ObservationTimeResolver;
}

function assertInvalidRequest(action: () => unknown): void {
  assert.throws(action, (error: unknown) => error instanceof ApiError
    && error.getStatus() === 400
    && error.presentation.code === "INVALID_REQUEST");
}

test("resolves a unique valid Business wall time to its exact absolute instant", async () => {
  const resolve = await resolver();
  const result = resolve("2026-01-15T12:30", "2026-01-15T09:30:00.000Z", "Europe/Istanbul");
  assert.equal(result.occurredAt.toISOString(), "2026-01-15T09:30:00.000Z");
  assert.equal(result.businessTimezone, "Europe/Istanbul");
});

test("rejects a spring-forward nonexistent local wall time", async () => {
  const resolve = await resolver();
  assertInvalidRequest(() => resolve("2024-03-10T02:30", "2024-03-10T07:30:00Z", "America/New_York"));
});

test("rejects a fall-back ambiguous local wall time without choosing an offset", async () => {
  const resolve = await resolver();
  assertInvalidRequest(() => resolve("2024-11-03T01:30", "2024-11-03T05:30:00Z", "America/New_York"));
  assertInvalidRequest(() => resolve("2024-11-03T01:30", "2024-11-03T06:30:00Z", "America/New_York"));
});

test("uses the authorized Business timezone regardless of device timezone", async () => {
  const resolve = await resolver();
  const originalTimezone = process.env.TZ;
  try {
    process.env.TZ = "Asia/Tokyo";
    const result = resolve("2026-01-15T12:30", "2026-01-15T20:30:00Z", "America/Los_Angeles");
    assert.equal(result.occurredAt.toISOString(), "2026-01-15T20:30:00.000Z");
    assert.equal(result.businessTimezone, "America/Los_Angeles");
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test("uses Europe/Istanbul only when the authorized Business has no configured timezone", async () => {
  const resolve = await resolver();
  const result = resolve("2026-01-15T12:30", "2026-01-15T09:30:00Z", null);
  assert.equal(result.occurredAt.toISOString(), "2026-01-15T09:30:00.000Z");
  assert.equal(result.businessTimezone, "Europe/Istanbul");
});

test("rejects a supplied offset-aware instant that does not match the unique wall-time mapping", async () => {
  const resolve = await resolver();
  assertInvalidRequest(() => resolve("2026-01-15T12:30", "2026-01-15T12:30:00Z", "Europe/Istanbul"));
  const equivalentOffset = resolve("2026-01-15T12:30", "2026-01-15T12:30:00+03:00", "Europe/Istanbul");
  assert.equal(equivalentOffset.occurredAt.toISOString(), "2026-01-15T09:30:00.000Z");
});

test("rejects malformed local values, offset-free instants, and unknown Business timezones", async () => {
  const resolve = await resolver();
  assertInvalidRequest(() => resolve("2026-02-30T12:30", "2026-03-02T09:30:00Z", "Europe/Istanbul"));
  assertInvalidRequest(() => resolve("2026-01-15T12:30", "2026-01-15T09:30:00", "Europe/Istanbul"));
  assertInvalidRequest(() => resolve("2026-01-15T12:30", "2026-01-15T09:30:00Z", "Mars/Olympus"));
});
