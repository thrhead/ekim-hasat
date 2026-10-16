import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createExpensesApp } from "../../src/finance/expenses.module.js";

const contractPath = fileURLToPath(
  new URL("../../../../specs/012-simple-expense-record-capture/contracts/expenses.openapi.yaml", import.meta.url),
);
test("SPEC-012 expense create OpenAPI contract", async () => {
  const contract = (await readFile(contractPath, "utf8")).replace(/\r\n/g, "\n");
  const operation = /  \/fields\/\{fieldId\}\/expenses:\n    post:[\s\S]*?(?=\ncomponents:)/.exec(contract)?.[0] ?? "";
  const request = /CreateExpenseRequest:[\s\S]*?(?=\n    Expense:)/.exec(contract)?.[0] ?? "";

  assert.match(contract, /^openapi: 3\.1\.0/m);
  assert.ok(operation, "POST /v1/fields/{fieldId}/expenses exists");
  assert.match(operation, /operationId: createFieldExpense/);
  assert.match(operation, /requestBody:\n        required: true/);
  assert.match(request, /required: \[expenseId, amount, currency, category, expenseDate\]/);
  assert.match(request, /amount:[\s\S]*?type: string[\s\S]*?Positive exact decimal string; at most 18 integer digits and 6 fractional digits\. Excess precision\/range is rejected without rounding\./);
  assert.match(request, /currency:[\s\S]*?type: string[\s\S]*?Required uppercase ISO 4217[\s\S]*?repository-pinned, versioned ISO 4217/);
  assert.match(request, /category:[\s\S]*?enum: \[SEED_SEEDLING, FERTILIZER, PESTICIDE, FUEL, LABOR, IRRIGATION, OTHER\]/);
  assert.match(request, /expenseDate:[\s\S]*?type: string[\s\S]*?format: date/);
  assert.match(request, /note:[\s\S]*?Optional note\. No feature-specific length cap or trimming rule is defined\./);
  assert.match(operation, /'201':[\s\S]*?Expense accepted and committed/);
  assert.match(operation, /'200':[\s\S]*?Exact retry replayed the previously accepted Expense/);
  assert.match(operation, /'409':[\s\S]*?Expense ID was reused with a changed actor, payload, or context/);

});

test("create route returns contract-shaped acceptance and replay statuses", async () => {
  const fieldId = "8c6705c6-d80c-4b88-8722-b66cc32a6d4f";
  const request = {
    expenseId: "9c071bf4-5fa3-46d7-b015-1fd32dc8c33c",
    amount: "125.40", currency: "TRY", category: "FERTILIZER", expenseDate: "2026-10-05", note: "  input note  ",
  };
  let createCalls = 0;
  const app = await createExpensesApp({
    verify: async () => ({ provider: "contract-test", subject: "owner" }),
    create: async (_identity, _field, body) => {
      createCalls += 1;
      return {
        kind: createCalls === 1 ? "accepted" : "replayed",
        expense: {
          id: body.expenseId, businessId: "business-internal", fieldId, seasonId: null,
          actorUserId: "actor-internal", actorMembershipId: "membership-internal", amount: body.amount,
          currency: body.currency, category: body.category, expenseDate: body.expenseDate, note: body.note ?? null,
          recordedAt: "2026-10-05T12:00:00.000Z",
        },
      };
    },
  });
  const fastify = app.getHttpAdapter().getInstance();
  await app.init();
  await fastify.ready();
  try {
    const first = await fastify.inject({ method: "POST", url: `/v1/fields/${fieldId}/expenses`, headers: { authorization: "Bearer valid" }, payload: request });
    const replay = await fastify.inject({ method: "POST", url: `/v1/fields/${fieldId}/expenses`, headers: { authorization: "Bearer valid" }, payload: request });
    assert.equal(first.statusCode, 201);
    assert.equal(replay.statusCode, 200);
    const body = first.json();
    assert.deepEqual(body, {
      id: request.expenseId, fieldId, seasonId: null, amount: "125.40", currency: "TRY",
      category: "FERTILIZER", expenseDate: "2026-10-05", note: "  input note  ",
    });
    assert.equal("occurredAt" in body, false);
    assert.equal("recordedAt" in body, false);
    assert.equal("businessId" in body, false);
    assert.equal(createCalls, 2);
  } finally { await app.close(); }
});

test("create route rejects non-decimal amount, missing currency, and unknown category before service call", async () => {
  const fieldId = "8c6705c6-d80c-4b88-8722-b66cc32a6d4f";
  let createCalls = 0;
  const app = await createExpensesApp({
    verify: async () => ({ provider: "contract-test", subject: "owner" }),
    create: async () => { createCalls += 1; throw new Error("invalid request reached persistence"); },
  });
  const fastify = app.getHttpAdapter().getInstance();
  await app.init();
  await fastify.ready();
  try {
    const valid = { expenseId: "9c071bf4-5fa3-46d7-b015-1fd32dc8c33c", amount: "1.00", currency: "TRY", category: "OTHER", expenseDate: "2026-10-05" };
    for (const body of [
      { ...valid, amount: 1.25 },
      { ...valid, amount: "1.1234567" },
      { ...valid, currency: undefined },
      { ...valid, category: "CUSTOM" },
      { ...valid, expenseDate: "2026-02-30" },
    ]) {
      const response = await fastify.inject({ method: "POST", url: `/v1/fields/${fieldId}/expenses`, headers: { authorization: "Bearer valid" }, payload: body });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().error.code, "INVALID_REQUEST");
    }
    assert.equal(createCalls, 0);
  } finally { await app.close(); }
});
