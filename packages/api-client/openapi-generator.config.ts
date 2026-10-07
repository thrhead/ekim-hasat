import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

// Generate independently so same-named components remain in their own contract.
// Public client paths compose these generated surfaces without rewriting schemas.
const contracts = [
  { schema: "../../specs/001-farmer-onboarding-first-field/contracts/onboarding.openapi.yaml", output: "./src/generated/onboarding-api.ts" },
  { schema: "../../specs/002-first-season-setup/contracts/seasons.openapi.yaml", output: "./src/generated/seasons-api.ts" },
  { schema: "../../specs/003-task-completion-history/contracts/task-completions.openapi.yaml", output: "./src/generated/task-completions-api.ts" },
  { schema: "../../specs/004-weather-context-display/contracts/weather.openapi.yaml", output: "./src/generated/weather-api.ts" },
  { schema: "../../specs/005-field-management-region-resolution/contracts/fields.openapi.yaml", output: "./src/generated/fields-api.ts" },
  { schema: "../../specs/006-field-observations-basic-diary/contracts/observations-diary.openapi.yaml", output: "./src/generated/observations-diary-api.ts" },
  { schema: "../../specs/007-calendar/contracts/calendar.openapi.yaml", output: "./src/generated/calendar-api.ts" },
];
const normalizeLineEndings = (text: string) => text.replace(/\r\n/g, "\n");

for (const contract of contracts) {
  const output = new URL(contract.output, import.meta.url);
  const generated = astToString(await openapiTS(new URL(contract.schema, import.meta.url), {
    alphabetize: true,
    exportType: true,
  }));
  if (process.argv.includes("--check")) {
    let current: string;
    try {
      current = await readFile(output, "utf8");
    } catch {
      throw new Error(`Generated API client ${contract.output} is missing; run the generate script`);
    }
    if (normalizeLineEndings(current) !== normalizeLineEndings(generated)) {
      throw new Error(`Generated API client ${contract.output} is stale; run the generate script`);
    }
  } else {
    await mkdir(new URL("./src/generated/", import.meta.url), { recursive: true });
    await writeFile(fileURLToPath(output), generated, "utf8");
  }
}
