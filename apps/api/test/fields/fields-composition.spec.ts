import assert from "node:assert/strict";
import test from "node:test";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { createFieldsModule } from "../../src/fields/fields.module.js";
import { createRegionsModule, EXISTING_FIELD_REGION_RESOLUTION, REGION_RESOLVER_PORT } from "../../src/regions/regions.module.js";
import { UnavailableRegionResolver } from "../../src/regions/unavailable-region-resolver.js";
import type { FieldComponents } from "@ekim-hasat/api-client";

const id = "00000000-0000-4000-8000-000000000001";
const identity = { provider: "composition-test", subject: "farmer" };
const field: FieldComponents["schemas"]["FieldDetail"] = {
  id, name: "North field", version: 2,
  representativePoint: { type: "Point", coordinates: [29.02, 41.01] },
  hasCurrentBoundary: false, boundary: null, activeSeason: null,
  regionContext: {
    administrativeLocation: { state: "UNRESOLVED", resolvedAt: null },
    agriculturalRegion: { state: "UNRESOLVED", resolvedAt: null },
    agriculturalRegionOverride: null,
  },
};

test("Fields module exposes authorized routes while Regions supplies a provider-neutral unavailable resolver and bounded operation", async () => {
  let readCalls = 0, createCalls = 0, updateCalls = 0;
  const fields = createFieldsModule({
    read: {
      verify: async (token) => token === "valid" ? identity : null,
      readPage: async () => { readCalls++; return { items: [], nextCursor: null }; },
      readField: async () => field,
    },
    create: { verify: async () => identity, createField: async () => { createCalls++; return { kind: "created", field }; } },
    update: { verify: async () => identity, updateField: async () => { updateCalls++; return field; } },
  });
  const app = await NestFactory.create<NestFastifyApplication>(fields, new FastifyAdapter(), { logger: false });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  try {
    const list = await app.inject({ method: "GET", url: "/v1/fields", headers: { authorization: "Bearer valid" } });
    assert.equal(list.statusCode, 200);
    const create = await app.inject({ method: "POST", url: "/v1/fields", headers: { authorization: "Bearer valid", "idempotency-key": "create-1" }, payload: { location: { type: "POINT", point: { type: "Point", coordinates: [29.02, 41.01] } } } });
    assert.equal(create.statusCode, 201);
    const update = await app.inject({ method: "PATCH", url: `/v1/fields/${id}`, headers: { authorization: "Bearer valid", "if-match": '"1"' }, payload: { name: "Updated field" } });
    assert.equal(update.statusCode, 200);
    assert.equal(update.headers.etag, '"2"');
    assert.deepEqual([readCalls, createCalls, updateCalls], [1, 1, 1]);
  } finally { await app.close(); }

  @Module({ imports: [createRegionsModule({ prisma: {} as PrismaClient })] })
  class TestRegionsRoot {}
  const context = await NestFactory.createApplicationContext(TestRegionsRoot, { logger: false });
  try {
    const resolver = context.get<UnavailableRegionResolver>(REGION_RESOLVER_PORT);
    const operation = context.get<{ execute: (who: typeof identity, fieldId: string) => Promise<unknown> }>(EXISTING_FIELD_REGION_RESOLUTION);
    assert.ok(resolver instanceof UnavailableRegionResolver);
    assert.equal(typeof operation.execute, "function");
    assert.deepEqual(await resolver.resolveAdministrative({ longitude: 29, latitude: 41 }), { state: "UNRESOLVED", reason: "SOURCE_UNAVAILABLE" });
  } finally { await context.close(); }
});
