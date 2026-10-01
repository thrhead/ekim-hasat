import { spawnSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatedRoot = join(apiRoot, "src/generated/prisma");
const generated = spawnSync("pnpm", ["exec", "prisma", "generate"], {
  cwd: apiRoot,
  env: process.env,
  stdio: "inherit",
});
if (generated.error) throw generated.error;
if (generated.status !== 0) process.exit(generated.status ?? 1);

// Prisma emits trailing whitespace in TypeScript output. Normalize only that
// generated tree so regeneration satisfies the repository whitespace gate.
async function normalize(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await normalize(path);
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      const source = await readFile(path, "utf8");
      const normalized = source.replace(/[\t ]+$/gm, "").replace(/\n+$/, "\n");
      if (normalized !== source) await writeFile(path, normalized);
    }
  }
}

await normalize(generatedRoot);
