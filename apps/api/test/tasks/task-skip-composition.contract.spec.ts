import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const mainPath = fileURLToPath(new URL("../../src/main.ts", import.meta.url));

test("API composition wires the authenticated Task Skip repository and module", async () => {
  const main = (await readFile(mainPath, "utf8")).replace(/\r\n/g, "\n");
  assert.match(main, /new TaskSkipRepository\(prisma\)/);
  assert.match(main, /createTaskSkipModule\(\{ verify,[\s\S]*?taskSkipRepository\.skip/);
  assert.match(main, /imports: \[[^\]]*taskSkipModule/);
});
