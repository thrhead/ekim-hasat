import assert from "node:assert/strict";
import test from "node:test";
import {
  createFieldRegionContext,
  effectiveAgriculturalRegion,
  fieldResolutionLocationKey,
  type FieldRegionContextInput,
} from "../../src/fields/field-region-context.ts";

const provenance = {
  code: "district-1",
  label: "District One",
  sourceId: "source-a",
  confidence: 0.9,
  dataVersion: "2026-01",
  resolvedAt: "2026-10-02T12:00:00.000Z",
};

test("administrative and agricultural region states resolve independently", () => {
  const context = createFieldRegionContext({
    resolutionLocationKey: "key-1",
    administrative: { state: "RESOLVED", result: provenance },
    agricultural: { state: "UNRESOLVED" },
  });

  assert.equal(context.administrative.state, "RESOLVED");
  assert.equal(context.agricultural.state, "UNRESOLVED");
  assert.equal(context.administrative.result?.resolvedAt, provenance.resolvedAt);
});

test("manual agricultural override takes precedence over an automatic suggestion", () => {
  const input: FieldRegionContextInput = {
    resolutionLocationKey: "key-1",
    administrative: { state: "UNRESOLVED" },
    agricultural: { state: "RESOLVED", result: provenance },
    agriculturalOverride: { code: "farmer-choice", label: "Farmer choice" },
  };

  assert.deepEqual(effectiveAgriculturalRegion(createFieldRegionContext(input)), {
    state: "RESOLVED",
    code: "farmer-choice",
    label: "Farmer choice",
    source: "MANUAL_OVERRIDE",
  });
});

test("location key follows representative point and polygon geometry, independently of weather fingerprint", () => {
  const point = { type: "Point" as const, coordinates: [10, 20] as [number, number] };
  const polygon = { type: "Polygon" as const, coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]] as [number, number][]] };
  const original = fieldResolutionLocationKey({ representativePoint: point, polygon });

  assert.equal(fieldResolutionLocationKey({ representativePoint: point, polygon }), original);
  assert.notEqual(fieldResolutionLocationKey({ representativePoint: { ...point, coordinates: [10.1, 20] }, polygon }), original);
  assert.notEqual(fieldResolutionLocationKey({ representativePoint: point, polygon: { ...polygon, coordinates: [[[0, 0], [3, 0], [2, 2], [0, 2], [0, 0]]] } }), original);
  assert.notEqual(fieldResolutionLocationKey({ representativePoint: point }), original);
});
