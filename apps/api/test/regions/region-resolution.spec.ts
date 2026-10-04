import assert from "node:assert/strict";
import test from "node:test";
import { RegionResolutionService } from "../../src/regions/region-resolution.service.ts";
import { UnavailableRegionResolver } from "../../src/regions/unavailable-region-resolver.ts";

const point = { longitude: 10, latitude: 20 };

test("unavailable resolver reports explicit unresolved outcomes for both region streams", async () => {
  const resolver = new UnavailableRegionResolver();
  assert.deepEqual(await resolver.resolveAdministrative(point), { state: "UNRESOLVED", reason: "SOURCE_UNAVAILABLE" });
  assert.deepEqual(await resolver.resolveAgricultural(point), { state: "UNRESOLVED", reason: "SOURCE_UNAVAILABLE" });
});

test("resolution service uses only qualified sources and timestamps accepted normalized results on the server", async () => {
  const resolver = new RegionResolutionService({
    administrative: {
      qualified: true,
      sourceId: "official-source",
      dataVersion: "snapshot-2026-09",
      resolve: async () => ({ code: "  area-1 ", label: " Area One ", confidence: 0.85 }),
    },
    agricultural: {
      qualified: false,
      sourceId: "unqualified",
      dataVersion: "unknown",
      resolve: async () => ({ code: "bad", label: "Bad", confidence: 1 }),
    },
  }, () => new Date("2026-10-02T12:00:00.000Z"));

  assert.deepEqual(await resolver.resolveAdministrative(point), {
    state: "RESOLVED",
    candidate: {
      code: "area-1",
      label: "Area One",
      sourceId: "official-source",
      confidence: 0.85,
      dataVersion: "snapshot-2026-09",
      resolvedAt: "2026-10-02T12:00:00.000Z",
    },
  });
  assert.deepEqual(await resolver.resolveAgricultural(point), { state: "UNRESOLVED", reason: "SOURCE_UNAVAILABLE" });
});

test("resolution service converts source failures, missing coverage, and invalid values to unresolved results", async () => {
  const resolver = new RegionResolutionService({
    administrative: { qualified: true, sourceId: "source", dataVersion: "v1", resolve: async () => { throw new Error("vendor detail"); } },
    agricultural: { qualified: true, sourceId: "source", dataVersion: "v1", resolve: async () => ({ code: "", label: "", confidence: 4 }) },
  });
  assert.deepEqual(await resolver.resolveAdministrative(point), { state: "UNRESOLVED", reason: "SOURCE_UNAVAILABLE" });
  assert.deepEqual(await resolver.resolveAgricultural(point), { state: "UNRESOLVED", reason: "INVALID_RESULT" });
});
