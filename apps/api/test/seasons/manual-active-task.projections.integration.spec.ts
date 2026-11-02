import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createManualTaskFixture } from "../support/spec014-fixture.js";
import { ManualActiveTaskRepository } from "../../src/seasons/manual-active-task.repository.js";
import { TodayRepository } from "../../src/seasons/today.repository.js";
import { CalendarPagesService } from "../../src/calendar/calendar-pages.service.js";
import { CalendarReadRepository } from "../../src/calendar/calendar-read.repository.js";

test("Today and Calendar preserve manual task origin and legacy plan provenance", async () => {
  const f = await createManualTaskFixture({ validated: true });
  try {
    const taskId = randomUUID();
    await new ManualActiveTaskRepository(f.prisma).create(f.users.OWNER.identity, f.seasonId, { taskId, mutationId: randomUUID(), title: "Manual", plannedLocalDate: "2024-01-01" });
    const today = await new TodayRepository(f.prisma, () => new Date("2024-01-01T12:00:00Z")).readToday(f.users.OWNER.identity);
    assert.equal(today.tasks.find(task => task.id === taskId)?.sourceKind, "MANUAL");
    assert.equal(today.tasks.find(task => task.id === taskId)?.templateVersionId, null);
    assert.equal(today.tasks.find(task => task.id === f.legacyTaskId)?.sourceKind, "VALIDATED_TEMPLATE");
    assert.equal(today.tasks.find(task => task.id === f.legacyTaskId)?.templateVersionId, f.templateId);
    const connection = await f.pool.connect();
    try { await connection.query("INSERT INTO planned_tasks(id,season_plan_id,title,planned_local_date,origin) SELECT gen_random_uuid(),$1,'bulk','2024-01-01','POST_ACTIVATION_MANUAL' FROM generate_series(1,51)", [f.planId]); } finally { connection.release(); }
    const calendar = await new CalendarReadRepository(f.prisma).createRead(f.users.OWNER.identity, { selectedDate: "2024-01-01" });
    const page = calendar.overdueTasksPage;
    assert.ok(page.nextCursor);
    const next = await new CalendarPagesService(f.prisma).read(f.users.OWNER.identity, { readId: calendar.readId, group: "overdueTasks", cursor: page.nextCursor });
    const items = [...page.items, ...next.items, ...calendar.selectedDateTasksPage.items];
    const manual = items.find(task => task.taskId === taskId), legacy = items.find(task => task.taskId === f.legacyTaskId);
    assert.equal(manual?.sourceKind, "MANUAL"); assert.equal(manual?.templateVersionId, null);
    assert.equal(JSON.parse(manual!.planContext!).source, "VALIDATED_TEMPLATE");
    assert.equal(legacy?.sourceKind, "VALIDATED_TEMPLATE"); assert.equal(legacy?.templateVersionId, f.templateId);
    const snapshot = await f.prisma.calendarReadSnapshotTask.findFirst({ where: { readId: calendar.readId, taskId } });
    assert.equal((snapshot?.planContext as { taskSourceKind?: string } | null)?.taskSourceKind, "MANUAL");
  } finally { await f.close(); }
});
