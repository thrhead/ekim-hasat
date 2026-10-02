import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { WeatherRepository } from "../../src/weather/weather.repository.js";

test("overview query count is bounded independently of the number of returned fields", async () => {
  const fields = [1, 2, 3].map((index) => ({ id: `field-${index}`, name: `Field ${index}`, businessId: "business-1" }));
  let queryCount = 0;
  const tx = {
    applicationUser: { async findUnique() { queryCount += 1; return { id: "user-1", defaultBusinessId: "business-1" }; } },
    business: { async findUnique() { queryCount += 1; return { id: "business-1" }; } },
    membership: { async findUnique() { queryCount += 1; return { id: "membership-1", role: "OWNER", status: "ACTIVE" }; } },
  };
  const prisma = {
    async $transaction<T>(operation: (client: typeof tx) => Promise<T>) { return operation(tx); },
    business: { async findFirst() { queryCount += 1; return { timezone: "Europe/Istanbul" }; } },
    field: { async findMany(args: { take: number }) { queryCount += 1; return fields.slice(0, args.take); } },
    async $queryRaw() {
      queryCount += 1;
      return fields.map(({ id }) => ({ id, longitude: 29, latitude: 41 }));
    },
    weatherSnapshot: {
      async findMany() { queryCount += 1; return []; },
      async findUnique() { queryCount += 1; return null; },
    },
  } as unknown as PrismaClient;
  const repository = new WeatherRepository(prisma, { now: () => new Date("2026-10-01T06:00:00.000Z") });
  const identity = { provider: "test", subject: "subject-1" };
  const countFor = async (limit: number) => {
    queryCount = 0;
    await repository.readWeatherOverview(identity, { limit });
    return queryCount;
  };

  const oneFieldQueries = await countFor(1);
  const threeFieldQueries = await countFor(3);
  assert.ok(oneFieldQueries <= 8, `single page uses bounded query groups: ${oneFieldQueries}`);
  assert.equal(threeFieldQueries, oneFieldQueries);
});
