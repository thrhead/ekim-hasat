import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createManualTaskFixture } from "../support/spec014-fixture.js";
import { ManualActiveTaskRepository } from "../../src/seasons/manual-active-task.repository.js";
import { TaskCompletionRepository } from "../../src/tasks/task-completion.repository.js";
import { TaskDateAdjustmentRepository } from "../../src/tasks/task-date-adjustment.repository.js";
import { ObservationDiaryRepository } from "../../src/observations/observation-diary.repository.js";
import { TaskSkipRepository } from "../../src/tasks/task-skip.repository.js";

test("completion and skip history retain truthful manual and legacy task provenance", async () => {
  const f = await createManualTaskFixture({ validated: true });
  try {
    const create = new ManualActiveTaskRepository(f.prisma), completion = new TaskCompletionRepository(f.prisma), skip = new TaskSkipRepository(f.prisma);
    const completeId = randomUUID(), skipId = randomUUID(), adjustId = randomUUID();
    for (const taskId of [completeId, skipId, adjustId]) await create.create(f.users.OWNER.identity, f.seasonId, { taskId, mutationId: randomUUID(), title: "Manual", plannedLocalDate: "2024-01-01" });
    const diaryReader = new ObservationDiaryRepository(f.prisma, completion, skip);
    assert.equal((await diaryReader.read(f.users.OWNER.identity, f.fieldId)).items.length, 0);
    const adjustment = await new TaskDateAdjustmentRepository(f.prisma).adjust(f.users.OWNER.identity, adjustId, 1, { adjustmentId: randomUUID(), newPlannedLocalDate: "2024-01-02" });
    assert.equal(adjustment.kind, "accepted");
    const cmd = { completionId: randomUUID(), occurredAt: "2024-01-01T12:00:00.000Z" };
    const accepted = await completion.complete(f.users.OWNER.identity, completeId, 1, cmd);
    assert.equal(accepted.completion.sourceKind, "MANUAL"); assert.equal(accepted.completion.templateVersionId, null);
    assert.deepEqual((await completion.complete(f.users.OWNER.identity, completeId, 1, cmd)).completion, accepted.completion);
    const legacy = await completion.complete(f.users.OWNER.identity, f.legacyTaskId, 1, { completionId: randomUUID(), occurredAt: cmd.occurredAt });
    assert.equal(legacy.completion.sourceKind, "VALIDATED_TEMPLATE"); assert.equal(legacy.completion.templateVersionId, f.templateId);
    await skip.skip(f.users.OWNER.identity, skipId, 1, { skipId: randomUUID() });
    const history = await completion.readOutcomeHistory(f.users.OWNER.identity, f.fieldId);
    assert.equal(history.items.find(item => item.taskId === skipId)?.sourceKind, "MANUAL");
    assert.equal(history.items.find(item => item.taskId === completeId)?.sourceKind, "MANUAL");
    const diary = await skip.readDiaryCandidates(f.users.OWNER.identity, f.fieldId, undefined, null, 50);
    assert.equal(diary.find(item => item.taskId === skipId)?.sourceKind, "MANUAL");
    const fieldDiary = await diaryReader.read(f.users.OWNER.identity, f.fieldId);
    assert.equal(fieldDiary.items.find((item) => item.taskId === completeId)?.sourceKind, "MANUAL");
    assert.equal(fieldDiary.items.find((item) => item.taskId === skipId)?.sourceKind, "MANUAL");
    assert.equal(fieldDiary.items.some((item) => item.taskId === adjustId), false);
  } finally { await f.close(); }
});
