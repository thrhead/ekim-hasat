import assert from "node:assert/strict";
import test from "node:test";
import {
  applyFieldRegionResolution,
  createFieldRegionContext,
} from "../../src/fields/field-region-context.ts";

const resolved = {
  code: "region-1",
  label: "Region One",
  sourceId: "qualified-source",
  confidence: 0.8,
  dataVersion: "v2",
  resolvedAt: "2026-10-02T12:00:00.000Z",
};

test("region resolution requires the current location key and preserves overrides", () => {
  const current = createFieldRegionContext({
    resolutionLocationKey: "current-key",
    administrative: { state: "UNRESOLVED" },
    agricultural: { state: "UNRESOLVED" },
    agriculturalOverride: { code: "manual", label: "Manual" },
  });

  const stale = applyFieldRegionResolution(current, {
    target: "administrative",
    resolutionLocationKey: "old-key",
    state: "RESOLVED",
    result: resolved,
  });
  assert.equal(stale.kind, "stale");
  assert.equal(stale.context, current);

  const accepted = applyFieldRegionResolution(current, {
    target: "administrative",
    resolutionLocationKey: "current-key",
    state: "RESOLVED",
    result: resolved,
  });
  assert.equal(accepted.kind, "applied");
  assert.deepEqual(accepted.context.administrative, { state: "RESOLVED", result: resolved });
  assert.deepEqual(accepted.context.agriculturalOverride, { code: "manual", label: "Manual" });
  assert.equal(accepted.context.agricultural.state, "UNRESOLVED");
});

test("same-source-version replay does not create a new region context", () => {
  const current = createFieldRegionContext({
    resolutionLocationKey: "current-key",
    administrative: { state: "RESOLVED", result: resolved },
    agricultural: { state: "UNRESOLVED" },
  });
  const replay = applyFieldRegionResolution(current, {
    target: "administrative",
    resolutionLocationKey: "current-key",
    state: "RESOLVED",
    result: resolved,
  });
  assert.equal(replay.kind, "unchanged");
});
