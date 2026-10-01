import assert from "node:assert/strict";
import test from "node:test";
import {
  completeOnboarding,
  OnboardingAuthenticationRequiredError,
  type OnboardingCompletionRepository,
} from "../../src/onboarding/complete-onboarding.ts";
import {
  FieldLocationValidationError,
  validateFieldLocation,
  type FieldLocation,
} from "../../src/fields/field-location.ts";
import type { VerifiedSubject } from "../../src/identity/auth-provider.ts";

/*
 * Test-facing contract assumed by T023 for T028/T030:
 * - validateFieldLocation(location) validates provider-neutral GeoJSON and
 *   does not calculate geospatial representative points.
 * - completeOnboarding(identity, request, repository) validates and normalizes
 *   the command, fingerprints its canonical payload, and delegates persistence
 *   to the single repository completion operation. Polygon-only representative
 *   point derivation belongs to PostGIS in the repository.
 */

const identity: VerifiedSubject = { provider: "supabase", subject: "farmer-1" };

const point = (longitude: number, latitude: number) => ({
  type: "Point" as const,
  coordinates: [longitude, latitude] as [number, number],
});

const square: FieldLocation = {
  type: "Polygon",
  coordinates: [[
    [10, 20],
    [12, 20],
    [12, 22],
    [10, 22],
    [10, 20],
  ]],
};

function completionRepository(
  overrides: Partial<OnboardingCompletionRepository> = {},
) {
  const calls: Array<{ name: string; input?: unknown }> = [];
  const field = {
    id: "field-1",
    name: "Tarla 1",
    representativePoint: point(11, 21),
    createdAt: "2026-09-25T10:00:00.000Z",
  };
  const repository: OnboardingCompletionRepository = {
    persistFirstFieldOnboardingCompletion: async (input) => {
      calls.push({ name: "persist", input });
      return { kind: "created", field };
    },
    ...overrides,
  };
  return { repository, calls, field };
}

test("validates Point coordinates as WGS 84 longitude then latitude", async (t) => {
  await t.test("accepts inclusive longitude and latitude limits", () => {
    assert.doesNotThrow(() => validateFieldLocation(point(-180, -90)));
    assert.doesNotThrow(() => validateFieldLocation(point(180, 90)));
  });

  await t.test("rejects longitude or latitude outside its own range", () => {
    for (const invalid of [point(-180.0001, 0), point(180.0001, 0), point(0, -90.0001), point(0, 90.0001)]) {
      assert.throws(() => validateFieldLocation(invalid), FieldLocationValidationError);
    }
  });

  await t.test("rejects non-finite or incomplete coordinates", () => {
    const invalidLocations: unknown[] = [
      { type: "Point", coordinates: [Number.NaN, 0] },
      { type: "Point", coordinates: [0, Number.POSITIVE_INFINITY] },
      { type: "Point", coordinates: [1] },
      { type: "Point", coordinates: [0, 91] },
      { type: "MultiPoint", coordinates: [[0, 0]] },
    ];
    for (const location of invalidLocations) {
      assert.throws(() => validateFieldLocation(location as FieldLocation), FieldLocationValidationError);
    }
  });
});

test("validates Polygon geometry before creating a field", async (t) => {
  await t.test("requires a closed ring with at least four positions", () => {
    const openRing: FieldLocation = {
      type: "Polygon",
      coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2]]],
    };
    const tooShort: FieldLocation = {
      type: "Polygon",
      coordinates: [[[0, 0], [2, 0], [0, 0]]],
    };
    assert.throws(() => validateFieldLocation(openRing), FieldLocationValidationError);
    assert.throws(() => validateFieldLocation(tooShort), FieldLocationValidationError);
  });

  await t.test("rejects out-of-range Polygon coordinates", () => {
    const invalid: FieldLocation = {
      type: "Polygon",
      coordinates: [[[0, 0], [181, 0], [0, 2], [0, 0]]],
    };
    assert.throws(() => validateFieldLocation(invalid), FieldLocationValidationError);
  });

  await t.test("rejects degenerate and self-intersecting rings", () => {
    const collinear: FieldLocation = {
      type: "Polygon",
      coordinates: [[[0, 0], [1, 1], [2, 2], [0, 0]]],
    };
    const selfIntersecting: FieldLocation = {
      type: "Polygon",
      coordinates: [[[0, 0], [2, 2], [0, 2], [2, 0], [0, 0]]],
    };
    assert.throws(() => validateFieldLocation(collinear), FieldLocationValidationError);
    assert.throws(() => validateFieldLocation(selfIntersecting), FieldLocationValidationError);
  });

  await t.test("requires an outer ring and rejects unsupported geometry types", () => {
    assert.throws(
      () => validateFieldLocation({ type: "Polygon", coordinates: [] } as FieldLocation),
      FieldLocationValidationError,
    );
    assert.throws(
      () => validateFieldLocation({ type: "MultiPolygon", coordinates: [] } as FieldLocation),
      FieldLocationValidationError,
    );
  });
});

test("accepts valid Polygon geometry for repository persistence", () => {
  assert.doesNotThrow(() => validateFieldLocation(square));
});

test("Point-only completion persists the submitted representative point without a fabricated boundary", async () => {
  const location = point(29, 41);
  assert.doesNotThrow(() => validateFieldLocation(location));
  assert.deepEqual(location, point(29, 41));

  let capturedInput: unknown;
  const persistedField = {
    id: "point-field-1",
    name: "Tarla 1",
    representativePoint: location,
    createdAt: "2026-09-25T10:00:00.000Z",
  };
  const { repository } = completionRepository({
    persistFirstFieldOnboardingCompletion: async (input) => {
      capturedInput = input;
      return { kind: "created", field: persistedField };
    },
  });
  const result = await completeOnboarding(
    identity,
    { idempotencyKey: "point-request", location },
    repository,
  );

  assert.equal((capturedInput as { name: string }).name, "Tarla 1");
  assert.deepEqual((capturedInput as { location: FieldLocation }).location, location);
  assert.deepEqual((capturedInput as { identity: VerifiedSubject }).identity, identity);
  assert.equal(typeof (capturedInput as { payloadFingerprint: string }).payloadFingerprint, "string");
  assert.equal((capturedInput as { idempotencyKey: string }).idempotencyKey, "point-request");
  assert.equal(result.kind, "created");
  if (result.kind === "conflict") throw new Error("unexpected conflict");
  assert.deepEqual(result.field.representativePoint, location);
  assert.equal("boundary" in result.field, false);
});

test("completion normalizes optional field names and returns the created field summary", async (t) => {
  const cases: Array<{ label: string; name?: string; expectedName: string }> = [
    { label: "omitted name", expectedName: "Tarla 1" },
    { label: "whitespace-only name", name: " \t\n ", expectedName: "Tarla 1" },
    { label: "padded non-empty name", name: "  Kuzey Parsel  ", expectedName: "Kuzey Parsel" },
  ];

  for (const scenario of cases) {
    await t.test(scenario.label, async () => {
      const { repository, calls, field } = completionRepository();
      const result = await completeOnboarding(
        identity,
        { idempotencyKey: "request-1", location: point(29, 41), ...(scenario.name === undefined ? {} : { name: scenario.name }) },
        repository,
      );

      assert.equal(calls.filter((call) => call.name === "persist").length, 1);
      assert.equal((calls.find((call) => call.name === "persist")?.input as { name: string }).name, scenario.expectedName);
      assert.equal(result.kind, "created");
      if (result.kind === "conflict") throw new Error("unexpected conflict");
      assert.deepEqual(result.field, field);
      assert.equal(result.field.id, "field-1");
      assert.equal(result.field.createdAt, "2026-09-25T10:00:00.000Z");
    });
  }
});

test("passes Polygon to persistence and returns its persisted point and unverified versioned boundary", async () => {
  let capturedInput: unknown;
  const { repository, field } = completionRepository({
    persistFirstFieldOnboardingCompletion: async (input) => {
      capturedInput = input;
      return { kind: "created", field: {
        ...field,
        representativePoint: point(11.25, 21.5),
        boundary: {
          id: "boundary-1",
          version: 1,
          verificationStatus: "unverified",
          geometry: square,
        },
      } };
    },
  });

  const result = await completeOnboarding(
    identity,
    { idempotencyKey: "request-2", location: square },
    repository,
  );

  assert.equal((capturedInput as { name: string }).name, "Tarla 1");
  assert.deepEqual((capturedInput as { location: FieldLocation }).location, square);
  assert.equal(result.kind, "created");
  if (result.kind === "conflict") throw new Error("unexpected conflict");
  assert.deepEqual(result.field.representativePoint, point(11.25, 21.5));
  assert.deepEqual(result.field.boundary, {
    id: "boundary-1",
    version: 1,
    verificationStatus: "unverified",
    geometry: square,
  });
});

test("preserves repository replay, already-completed, and conflict outcomes", async (t) => {
  for (const kind of ["replayed", "already_completed"] as const) {
    await t.test(`preserves ${kind}`, async () => {
      const { repository, field } = completionRepository({
        persistFirstFieldOnboardingCompletion: async () => ({ kind, field }),
      });
      const result = await completeOnboarding(
        identity,
        { idempotencyKey: `request-${kind}`, location: point(29, 41) },
        repository,
      );
      assert.deepEqual(result, { kind, field });
    });
  }

  await t.test("preserves retained-key conflict without a field result", async () => {
    const { repository } = completionRepository({
      persistFirstFieldOnboardingCompletion: async () => ({ kind: "conflict" }),
    });
    const result = await completeOnboarding(
      identity,
      { idempotencyKey: "request-conflict", location: point(29, 41) },
      repository,
    );
    assert.deepEqual(result, { kind: "conflict" });
  });
});

test("rejects invalid location or idempotency key before repository persistence", async (t) => {
  await t.test("rejects unsupported geometry", async () => {
    const { repository, calls } = completionRepository();
    await assert.rejects(
      completeOnboarding(identity, {
        idempotencyKey: "invalid-location",
        location: { type: "MultiPolygon", coordinates: [] },
      }, repository),
      FieldLocationValidationError,
    );
    assert.equal(calls.length, 0);
  });

  await t.test("rejects an empty key", async () => {
    const { repository, calls } = completionRepository();
    await assert.rejects(
      completeOnboarding(identity, { idempotencyKey: "  ", location: point(29, 41) }, repository),
      /idempotency key/i,
    );
    assert.equal(calls.length, 0);
  });

  await t.test("rejects an unverified identity", async () => {
    const { repository, calls } = completionRepository();
    await assert.rejects(
      completeOnboarding({ provider: " ", subject: "farmer-1" }, {
        idempotencyKey: "valid-key",
        location: point(29, 41),
      }, repository),
      OnboardingAuthenticationRequiredError,
    );
    assert.equal(calls.length, 0);
  });
});

test("fingerprints normalized command payload before calling the repository", async () => {
  const fingerprints: string[] = [];
  const { repository } = completionRepository({
    persistFirstFieldOnboardingCompletion: async (input) => {
      fingerprints.push(input.payloadFingerprint);
      return { kind: "created", field: {
        id: "fingerprint-field",
        name: input.name,
        representativePoint: input.location.type === "Point" ? input.location : point(11, 21),
        createdAt: "2026-09-25T10:00:00.000Z",
      } };
    },
  });

  await completeOnboarding(identity, {
    idempotencyKey: "same-logical-request",
    name: "  Tarla 1  ",
    location: point(29, 41),
  }, repository);
  await completeOnboarding(identity, {
    idempotencyKey: "same-logical-request",
    name: "Tarla 1",
    location: point(29, 41),
  }, repository);

  assert.equal(fingerprints[0], fingerprints[1]);
  assert.match(fingerprints[0]!, /^[a-f0-9]{64}$/);
});
