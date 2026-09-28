import assert from "node:assert/strict";
import test from "node:test";
import * as selection from "../../src/seasons/crop-selection.ts";

const catalog = [
  { id: "definition-1", cropKey: "unlisted-crop", displayName: "Unlisted crop", selectable: true },
  { id: "definition-2", cropKey: "retired-crop", displayName: "Retired crop", selectable: false },
];

test("accepts selectable server catalog identities without restricting the crop list", () => {
  assert.deepEqual(selection.selectCentralCrop("definition-1", catalog), {
    kind: "CENTRAL", cropKey: "unlisted-crop", cropDefinitionVersionId: "definition-1", displayName: "Unlisted crop",
  });
  assert.deepEqual(selection.listSelectableCentralCrops(catalog), [{
    kind: "CENTRAL", cropKey: "unlisted-crop", cropDefinitionVersionId: "definition-1", displayName: "Unlisted crop",
  }]);
});

test("central selection rejects unavailable IDs and never resolves a display name as identity", () => {
  for (const id of ["definition-2", "missing-definition", "Unlisted crop", "unlisted-crop"]) {
    assert.throws(() => selection.selectCentralCrop(id, catalog), { code: "CROP_NOT_AVAILABLE" });
  }
});

test("central logical identity remains stable across immutable definition versions", () => {
  const first = selection.selectCentralCrop("definition-1", catalog);
  const second = selection.selectCentralCrop("definition-3", [{
    id: "definition-3", cropKey: "unlisted-crop", displayName: "New label", selectable: true,
  }]);
  assert.deepEqual(selection.cropLogicalIdentity(first), { kind: "CENTRAL", cropKey: "unlisted-crop" });
  assert.deepEqual(selection.cropLogicalIdentity(second), { kind: "CENTRAL", cropKey: "unlisted-crop" });
  assert.equal(second.cropDefinitionVersionId, "definition-3");
});

test("custom names trim surrounding whitespace while preserving internal whitespace, spelling and case", () => {
  assert.equal(selection.normalizeCustomCropDisplayName(" \tİki  Sözcük\n\u00a0"), "İki  Sözcük");
  assert.deepEqual(selection.createCustomCropReference("custom-1", "business-1", "  İki  Sözcük  "), {
    kind: "CUSTOM", customCropId: "custom-1", businessId: "business-1", displayName: "İki  Sözcük",
  });
});

test("blank, nonstring and oversized custom names fail without allocating a valid crop", () => {
  for (const name of [undefined, null, 1, "", " \n\t ", "a".repeat(121)]) {
    assert.throws(() => selection.normalizeCustomCropDisplayName(name), { code: "INVALID_CUSTOM_CROP_NAME" });
  }
  assert.equal(selection.normalizeCustomCropDisplayName("a".repeat(120)).length, 120);
});

test("equal custom labels retain independently supplied business-scoped ID identity without central aliasing", () => {
  const first = selection.createCustomCropReference("custom-1", "business-1", " Unlisted crop ");
  const second = selection.createCustomCropReference("custom-2", "business-1", "Unlisted crop");
  const otherBusiness = selection.createCustomCropReference("custom-1", "business-2", "Unlisted crop");
  assert.deepEqual(selection.cropLogicalIdentity(first), { kind: "CUSTOM", businessId: "business-1", customCropId: "custom-1" });
  assert.deepEqual(selection.cropLogicalIdentity(second), { kind: "CUSTOM", businessId: "business-1", customCropId: "custom-2" });
  assert.deepEqual(selection.cropLogicalIdentity(otherBusiness), { kind: "CUSTOM", businessId: "business-2", customCropId: "custom-1" });
});

test("existing custom selection matches only authorized business and ID with privacy-safe misses", () => {
  const crops = [
    { id: "custom-1", businessId: "business-1", displayName: "Local crop" },
    { id: "custom-2", businessId: "business-2", displayName: "Local crop" },
  ];
  assert.deepEqual(selection.selectCustomCrop("custom-1", "business-1", crops), {
    kind: "CUSTOM", customCropId: "custom-1", businessId: "business-1", displayName: "Local crop",
  });
  for (const id of ["custom-2", "unknown", "Local crop"]) {
    assert.throws(() => selection.selectCustomCrop(id, "business-1", crops), { code: "CROP_NOT_AVAILABLE" });
  }
});
