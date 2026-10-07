import { randomBytes, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import type { CalendarTaskGroup } from "./calendar-read.repository.js";

export type CalendarCursorKey = Readonly<{ plannedLocalDate: string; taskId: string }>;
export type CalendarCursorPosition = Readonly<{ plannedLocalDate: string; taskId: string }>;

/** Cursor records are opaque, read-bound lookup keys, never authorization credentials. */
export class CalendarCursorRepository {
  constructor(private readonly db: PrismaClient | Prisma.TransactionClient) {}

  async issue(readId: string, group: CalendarTaskGroup, lastKey: CalendarCursorKey): Promise<string> {
    const row = await this.db.calendarReadCursor.upsert({
      where: {
        readId_group_lastPlannedLocalDate_lastTaskId: {
          readId,
          group,
          lastPlannedLocalDate: new Date(`${lastKey.plannedLocalDate}T00:00:00.000Z`),
          lastTaskId: lastKey.taskId,
        },
      },
      create: {
        id: randomUUID(),
        readId,
        group,
        token: randomBytes(32).toString("base64url"),
        lastPlannedLocalDate: new Date(`${lastKey.plannedLocalDate}T00:00:00.000Z`),
        lastTaskId: lastKey.taskId,
      },
      update: {},
      select: { token: true },
    });
    return row.token;
  }

  async resolve(readId: string, group: CalendarTaskGroup, token: string): Promise<CalendarCursorPosition | null> {
    const row = await this.db.calendarReadCursor.findFirst({
      where: { readId, group, token },
      select: { lastPlannedLocalDate: true, lastTaskId: true },
    });
    return row ? {
      plannedLocalDate: row.lastPlannedLocalDate.toISOString().slice(0, 10),
      taskId: row.lastTaskId,
    } : null;
  }
}
