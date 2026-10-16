import assert from "node:assert/strict";
import test from "node:test";
import { ExpensesRepository } from "../../src/finance/expenses.repository.js";

const identity = { provider: "test", subject: "owner" };
const businessId = "business-id";
const fieldId = "field-id";
const membershipId = "membership-id";

function repository(role = "OWNER") {
  const observed: { fieldWhere?: unknown; seasonArgs?: unknown } = {};
  const prisma = {
    $transaction: async (work: (tx: unknown) => unknown) => work(prisma),
    applicationUser: { findUnique: async () => ({ id: "user-id", defaultBusinessId: businessId }) },
    business: { findUnique: async () => ({ id: businessId }) },
    membership: { findUnique: async () => ({ id: membershipId, role, status: "ACTIVE" }) },
    field: { findFirst: async (args: { where: unknown }) => { observed.fieldWhere = args.where; return { id: fieldId }; } },
    season: { findMany: async (args: { where: unknown }) => {
      observed.seasonArgs = args;
      return [
        { id: "draft-season", status: "DRAFT", cropDefinitionVersion: { displayName: "Buğday" }, customCrop: null },
        { id: "active-season", status: "ACTIVE", cropDefinitionVersion: null, customCrop: { displayName: "Özel ürün" } },
      ];
    } },
  };
  return { service: new ExpensesRepository(prisma as never), observed };
}

test("lists all same-Field Expense Seasons for OWNER with a business-scoped query", async () => {
  const { service, observed } = repository();
  const options = await service.listAvailableSeasons(identity, fieldId);
  assert.deepEqual(options, [
    { id: "draft-season", status: "DRAFT", cropLabel: "Buğday" },
    { id: "active-season", status: "ACTIVE", cropLabel: "Özel ürün" },
  ]);
  assert.deepEqual(observed.fieldWhere, {
    id: fieldId, businessId,
    business: { memberships: { some: { id: membershipId, userId: "user-id", status: "ACTIVE", role: "OWNER" } } },
  });
  assert.deepEqual(observed.seasonArgs, {
    where: { fieldId, businessId, status: { in: ["DRAFT", "ACTIVE"] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, status: true, cropDefinitionVersion: { select: { displayName: true } }, customCrop: { select: { displayName: true } } },
  });
});

test("denies non-OWNER Expense Season options", async () => {
  const { service } = repository("WORKER");
  await assert.rejects(service.listAvailableSeasons(identity, fieldId), (error: unknown) =>
    typeof error === "object" && error !== null && "getStatus" in error
      && typeof (error as { getStatus: () => number }).getStatus === "function"
      && (error as { getStatus: () => number }).getStatus() === 403);
});
