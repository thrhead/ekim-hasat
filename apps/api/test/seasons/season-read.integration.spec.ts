import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { NotFoundException } from "@nestjs/common";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { SeasonReadRepository } from "../../src/seasons/seasons-read.repository.js";
import { BusinessScopeForbiddenError } from "../../src/authorization/membership-scope.service.js";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "postgresql://ekim_hasat:ekim_hasat_local@localhost:5432/ekim_hasat" }) });
const businessId = randomUUID(); const otherBusinessId = randomUUID();
const userId = randomUUID(); const fieldId = randomUUID(); const otherFieldId = randomUUID();
const cropId = randomUUID(); const unsupportedCropId = randomUUID(); const emptyCropId = randomUUID();
const templateId = randomUUID(); const emptyTemplateId = randomUUID();
const seasonId = randomUUID(); const foreignSeasonId = randomUUID();
const identity = { provider: "test-season-read", subject: randomUUID() };
const cropKey = randomUUID();
const diagnostics: unknown[] = [];
const repository = new SeasonReadRepository(prisma, (diagnostic) => diagnostics.push(diagnostic));

before(async () => {
  await prisma.business.createMany({ data: [{ id: businessId }, { id: otherBusinessId }] });
  await prisma.applicationUser.create({ data: { id: userId, authProvider: identity.provider, authSubject: identity.subject, defaultBusinessId: businessId } });
  await prisma.membership.create({ data: { userId, businessId, role: "MEMBER", status: "ACTIVE" } });
  await prisma.$executeRaw`INSERT INTO fields (id, business_id, name, representative_point) VALUES (${fieldId}::uuid, ${businessId}::uuid, 'Read fixture', ST_SetSRID(ST_MakePoint(29,41),4326)), (${otherFieldId}::uuid, ${otherBusinessId}::uuid, 'Private fixture', ST_SetSRID(ST_MakePoint(29,41),4326))`;
  await prisma.cropDefinitionVersion.createMany({ data: [
    { id: cropId, cropKey, version: "1", displayName: "Supported fixture" },
    { id: unsupportedCropId, cropKey: randomUUID(), version: "1", displayName: "Unsupported fixture" },
    { id: emptyCropId, cropKey: randomUUID(), version: "1", displayName: "Empty fixture" },
  ] });
  await prisma.validatedTemplateVersion.createMany({ data: [
    { id: templateId, templateKey: randomUUID(), version: "1", cropDefinitionVersionId: cropId, taskDefinitions: [{ key: "fixture", title: "Fixture task", offsetDays: 0 }] },
    { id: emptyTemplateId, templateKey: randomUUID(), version: "1", cropDefinitionVersionId: emptyCropId, taskDefinitions: [] },
  ] });
  for (const [id, business, field] of [[seasonId, businessId, fieldId], [foreignSeasonId, otherBusinessId, otherFieldId]]) {
    await prisma.season.create({ data: { id, businessId: business!, fieldId: field!, cropKey, cropDefinitionVersionId: cropId, actualPlantingDate: new Date("2026-08-01T00:00:00Z"), plan: { create: { source: "VALIDATED_TEMPLATE", templateVersionId: templateId, sourceSnapshot: {}, tasks: { create: { title: "Copied fixture", plannedLocalDate: new Date("2026-08-01T00:00:00Z"), sourceTemplateTaskKey: "fixture" } } } } } });
  }
});

after(async () => {
  await prisma.plannedTask.deleteMany({ where: { seasonPlan: { seasonId: { in: [seasonId, foreignSeasonId] } } } });
  await prisma.seasonPlan.deleteMany({ where: { seasonId: { in: [seasonId, foreignSeasonId] } } });
  await prisma.season.deleteMany({ where: { id: { in: [seasonId, foreignSeasonId] } } });
  await prisma.validatedTemplateVersion.deleteMany({ where: { id: { in: [templateId, emptyTemplateId] } } });
  await prisma.cropDefinitionVersion.deleteMany({ where: { id: { in: [cropId, unsupportedCropId, emptyCropId] } } });
  await prisma.field.deleteMany({ where: { id: { in: [fieldId, otherFieldId] } } });
  await prisma.applicationUser.delete({ where: { id: userId } });
  await prisma.business.deleteMany({ where: { id: { in: [businessId, otherBusinessId] } } });
  await prisma.$disconnect();
});

test("active MEMBER gets authorized field options with usable, unsupported and empty template distinction", async () => {
  const options = await repository.readOptions(identity, fieldId);
  assert.equal(options.fieldId, fieldId);
  assert.equal(options.customCropAllowed, true);
  assert.equal(options.crops.find((crop) => crop.id === cropId)?.templateAvailability, "AVAILABLE");
  assert.equal(options.crops.find((crop) => crop.id === cropId)?.manualPlanAllowed, false);
  assert.equal(options.crops.find((crop) => crop.id === unsupportedCropId)?.templateAvailability, "NOT_APPLICABLE");
  assert.equal(options.crops.find((crop) => crop.id === emptyCropId)?.templateAvailability, "EMPTY_TASK_DEFINITIONS");
  assert.equal(diagnostics.length, 1);
});

test("draft recovery preserves crop/template binding and copied task calendar dates", async () => {
  const result = await repository.readSeason(identity, seasonId);
  assert.equal(result.status, "DRAFT");
  assert.equal(result.sowingPlantingDate, "2026-08-01");
  assert.equal(result.plan.source.templateVersionId, templateId);
  assert.equal(result.plan.source.validationLabel, "CENTRALLY_VALIDATED");
  assert.equal(result.plan.tasks[0]?.title, "Copied fixture");
  assert.equal(result.plan.tasks[0]?.plannedLocalDate, "2026-08-01");
  await prisma.validatedTemplateVersion.update({ where: { id: templateId }, data: { available: false } });
  assert.deepEqual(await repository.readSeason(identity, seasonId), result);
});


test("ACTIVE recovery returns the confirmed saved result without performing activation", async () => {
  const activatedAt = new Date("2026-08-03T08:00:00Z");
  // This fixture represents an existing ACTIVE season; activation is outside T008.
  await prisma.season.update({ where: { id: seasonId }, data: { status: "ACTIVE", activatedAt, version: 2 } });
  try {
    const result = await repository.readSeason(identity, seasonId);
    assert.equal(result.status, "ACTIVE");
    assert.equal("activatedAt" in result && result.activatedAt, activatedAt.toISOString());
    assert.equal(result.version, 2);
    assert.equal(result.plan.tasks[0]?.title, "Copied fixture");
  } finally {
    await prisma.season.update({ where: { id: seasonId }, data: { status: "DRAFT", activatedAt: null, version: 1 } });
  }
});

test("forged business claims cannot select cross-business or nonexistent fields/seasons", async () => {
  const forged = { ...identity, businessId: otherBusinessId, role: "OWNER" };
  for (const id of [otherFieldId, randomUUID()]) await assert.rejects(repository.readOptions(forged, id), NotFoundException);
  for (const id of [foreignSeasonId, randomUUID()]) await assert.rejects(repository.readSeason(forged, id), NotFoundException);
});

test("revoked membership denies both reads and no saved default context is forbidden", async () => {
  await prisma.membership.updateMany({ where: { userId }, data: { status: "REVOKED" } });
  for (const operation of [() => repository.readOptions(identity, fieldId), () => repository.readSeason(identity, seasonId)]) await assert.rejects(operation(), BusinessScopeForbiddenError);
  await assert.rejects(repository.readOptions({ provider: identity.provider, subject: "absent" }, fieldId), BusinessScopeForbiddenError);
});
