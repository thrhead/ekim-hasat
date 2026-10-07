import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const contractPath = fileURLToPath(new URL("../../../../specs/007-calendar/contracts/calendar.openapi.yaml", import.meta.url));

test("Calendar OpenAPI contract preserves its frozen read and paging paths", async () => {
  const contract = (await readFile(contractPath, "utf8")).replace(/\r\n/g, "\n");
  assert.match(contract, /^openapi: 3\.1\.0/m);
  assert.deepEqual(
    [...contract.matchAll(/^  (\/[^:]+):$/gm)].map((match) => match[1]),
    ["/v1/calendar/reads", "/v1/calendar/reads/{readId}/pages"],
  );

  const create = /  \/v1\/calendar\/reads:\n    post:[\s\S]*?(?=\n  \/|\ncomponents:)/.exec(contract)?.[0];
  const pages = /  \/v1\/calendar\/reads\/\{readId\}\/pages:\n    get:[\s\S]*?(?=\n  \/|\ncomponents:)/.exec(contract)?.[0];
  assert.ok(create, "POST /v1/calendar/reads exists");
  assert.ok(pages, "GET /v1/calendar/reads/{readId}/pages exists");
  assert.match(create, /operationId: createCalendarRead/);
  assert.match(create, /bearerAuth/);
  assert.match(create, /selectedDate:[\s\S]*?format: date/);
  assert.doesNotMatch(create, /required:\s*\n\s*- selectedDate/);
  assert.match(create, /properties:[\s\S]*?selectedDate:[\s\S]*?fieldId:/);
  assert.doesNotMatch(create, /^\s+businessId:/m, "Business authority is not client-supplied");
  assert.match(create, /'201':[\s\S]*?CalendarRead/);
  assert.match(create, /'400':/);
  assert.match(create, /'401':/);
  assert.match(create, /'403':/);
  assert.match(create, /'404':/);
  assert.match(pages, /operationId: readCalendarPage/);
  assert.match(pages, /readId/);
  assert.match(pages, /enum: \[selectedDateTasks, overdueTasks\]/);
  assert.match(pages, /'410':/);
  assert.match(contract, /selectedDate:[\s\S]*?Resolved date bound to this Calendar read identity/);
  assert.match(contract, /monthIndicatorsComplete/);
  const read = /    CalendarRead:\n[\s\S]*?(?=\n    CalendarTaskPageFirst:)/.exec(contract)?.[0];
  assert.ok(read, "CalendarRead response schema exists");
  const required = /      required:\n([\s\S]*?)      properties:/.exec(read)?.[1] ?? "";
  for (const name of ["readId", "selectedDate", "monthIndicators", "monthIndicatorsComplete", "selectedDateTasksPage", "overdueTasksPage"]) {
    assert.match(required, new RegExp(`- ${name}(?:\\n|$)`), `${name} is required in the coherent read response`);
  }
  assert.match(contract, /'404': \{ description: Field is absent from the authorized Business scope/);
});

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForApi(child: ChildProcess, port: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  let lastFailure: unknown;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API exited before startup with code ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
      lastFailure = new Error(`Health endpoint returned ${response.status}`);
    } catch (error) {
      lastFailure = error;
    }
    await delay(50);
  }
  throw new Error(`API did not become ready: ${String(lastFailure)}`);
}

async function stopApi(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), delay(2_000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

test("production API registers Calendar read routes before authentication handling", { timeout: 15_000 }, async () => {
  const port = await availablePort();
  const apiRoot = fileURLToPath(new URL("../../", import.meta.url));
  const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
    cwd: apiRoot,
    env: {
      ...process.env,
      DATABASE_URL: "postgresql://ekim_hasat:ekim_hasat_local@127.0.0.1:5432/ekim_hasat_test",
      NODE_ENV: "test",
      PORT: String(port),
      SUPABASE_URL: "https://example.supabase.test",
      SUPABASE_ANON_KEY: "test-anon-key",
    },
    stdio: "ignore",
  });
  try {
    await waitForApi(child, port);
    const response = await fetch(`http://127.0.0.1:${port}/v1/calendar/reads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 401, "a registered Calendar route must authenticate before request validation");
  } finally {
    await stopApi(child);
  }
});
