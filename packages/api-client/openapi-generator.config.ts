import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const schema = new URL(
  "../../specs/001-farmer-onboarding-first-field/contracts/onboarding.openapi.yaml",
  import.meta.url,
);
const output = new URL("./src/generated/onboarding-api.ts", import.meta.url);
const generated = astToString(await openapiTS(schema, {
  alphabetize: true,
  exportType: true,
}));

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = await readFile(output, "utf8");
  } catch {
    throw new Error("Generated API client is missing; run the generate script");
  }
  if (current !== generated) {
    throw new Error("Generated API client is stale; run the generate script");
  }
} else {
  await mkdir(new URL("./src/generated/", import.meta.url), { recursive: true });
  await writeFile(fileURLToPath(output), generated, "utf8");
}
