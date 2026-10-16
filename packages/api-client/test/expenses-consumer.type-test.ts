import {
  createApiClient,
  type ExpenseComponents,
  type ExpenseOperations,
  type ExpensePaths,
  type operations,
  type paths,
} from "@ekim-hasat/api-client";

const client = createApiClient();

const createResult = client.POST("/fields/{fieldId}/expenses", {
  params: { path: { fieldId: "8c6705c6-d80c-4b88-8722-b66cc32a6d4f" } },
  body: {
    expenseId: "9c071bf4-5fa3-46d7-b015-1fd32dc8c33c",
    amount: "125.40",
    currency: "TRY",
    category: "FERTILIZER",
    expenseDate: "2026-10-05",
  },
});

const optionalContextResult = client.POST("/fields/{fieldId}/expenses", {
  params: { path: { fieldId: "8c6705c6-d80c-4b88-8722-b66cc32a6d4f" } },
  body: {
    expenseId: "9c071bf4-5fa3-46d7-b015-1fd32dc8c33d",
    seasonId: "d04f1ae7-fc54-45cf-86a8-c9e7fa3a3ef2",
    amount: "125.40",
    currency: "TRY",
    category: "FERTILIZER",
    expenseDate: "2026-10-05",
    note: "North field",
  },
});

type Assert<T extends true> = T;
type HasExpensePath = Assert<"/fields/{fieldId}/expenses" extends keyof paths ? true : false>;
type HasCreateExpenseOperation = Assert<"createFieldExpense" extends keyof ExpenseOperations ? true : false>;
type HasExpenseOperationInUnifiedClient = Assert<"createFieldExpense" extends keyof operations ? true : false>;
type HasExpensePathInUnifiedClient = Assert<"/fields/{fieldId}/expenses" extends keyof ExpensePaths ? true : false>;
type CreateResponse = ExpenseOperations["createFieldExpense"]["responses"][201]["content"]["application/json"];
type GeneratedExpenseResponse = Assert<CreateResponse extends ExpenseComponents["schemas"]["Expense"] ? true : false>;
type ExpenseCreateBody = ExpenseOperations["createFieldExpense"]["requestBody"]["content"]["application/json"];
type HasRequiredExpenseId = Assert<"expenseId" extends keyof ExpenseComponents["schemas"]["CreateExpenseRequest"] ? true : false>;
type HasNoClientBusinessId = Assert<"businessId" extends keyof ExpenseCreateBody ? false : true>;

void (0 as unknown as HasExpensePath);
void (0 as unknown as HasCreateExpenseOperation);
void (0 as unknown as HasExpenseOperationInUnifiedClient);
void (0 as unknown as HasExpensePathInUnifiedClient);
void (0 as unknown as GeneratedExpenseResponse);
void (0 as unknown as HasRequiredExpenseId);
void (0 as unknown as HasNoClientBusinessId);
void createResult;
void optionalContextResult;

void client.POST("/fields/{fieldId}/expenses", {
  params: { path: { fieldId: "8c6705c6-d80c-4b88-8722-b66cc32a6d4f" } },
  body: {
    expenseId: "9c071bf4-5fa3-46d7-b015-1fd32dc8c33e",
    amount: "125.40",
    currency: "TRY",
    category: "FERTILIZER",
    expenseDate: "2026-10-05",
    // @ts-expect-error Business scope is resolved from authorization, not the client payload.
    businessId: "client-cannot-select-this",
  },
});
