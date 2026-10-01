import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, relative } from "node:path";

const mode = process.argv[2];
const cwd = process.cwd();

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function matches(mode, path) {
  const normalizedPath = path.replaceAll("\\", "/");
  const name = normalizedPath.split("/").at(-1);
  if (mode === "domain") {
    return (
      (normalizedPath.startsWith("src/") && name.endsWith(".test.ts")) ||
      (normalizedPath.startsWith("test/onboarding/") && name.endsWith(".spec.ts"))
    );
  }
  if (mode === "api-unit") {
    return normalizedPath.startsWith("test/") && name.endsWith(".spec.ts") && !name.endsWith(".integration.spec.ts");
  }
  if (mode === "api-integration") {
    return normalizedPath.startsWith("test/") && name.endsWith(".integration.spec.ts");
  }
  if (mode === "api-contract") {
    return (
      normalizedPath.startsWith("test/") &&
      name.endsWith(".spec.ts") &&
      !name.endsWith(".integration.spec.ts") &&
      (/(^|\/)contracts?(\/|$)/.test(normalizedPath) || /contract/i.test(name))
    );
  }
  throw new Error(`Unknown test discovery mode: ${mode}`);
}

const roots =
  mode === "domain"
    ? ["src", "test/onboarding"].filter((path) => existsSync(path))
    : ["test"];
const files = roots.flatMap(walk)
  .map((path) => relative(cwd, path))
  .filter((path) => matches(mode, path))
  .sort();

if (files.length === 0 && mode !== "api-contract") {
  console.error(`No test files discovered for ${mode} under ${cwd}`);
  process.exit(1);
}

if (mode === "api-contract" && files.length === 0) {
  console.log("No API contract spec files yet; generated client checks still run.");
  process.exit(0);
}

const command = "node";
const args =
  mode === "domain"
    ? ["--import", "tsx", "--test", ...files]
    : mode === "api-integration"
      ? ["--import", "tsx", "--test", "--test-concurrency=1", ...files]
      : ["--import", "tsx", "--test", ...files];
const result = spawnSync(command, args, { cwd, stdio: "inherit", env: process.env });

if (result.error) throw result.error;
process.exit(result.status ?? 1);
