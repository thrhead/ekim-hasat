import { Body, Controller, Get, Headers, Inject, NotFoundException, Param, Post, Query, type DynamicModule, Module } from "@nestjs/common";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import { validateCalendarReadRequest, validateCalendarReadResponse } from "./calendar.dto.js";
import { authenticateSeasonRequest } from "../seasons/seasons-read.controller.js";
import { ApiError } from "../observability/api-error.filter.js";

const readIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const calendarGroups = new Set(["selectedDateTasks", "overdueTasks"]);
const dependenciesKey = Symbol("CALENDAR_CONTROLLER_DEPENDENCIES");

export type CalendarControllerDependencies = Readonly<{
  verify: (token: string) => Promise<VerifiedSubject | null>;
  createRead: (identity: VerifiedSubject, request: ReturnType<typeof validateCalendarReadRequest>) => Promise<unknown>;
  readPage: (identity: VerifiedSubject, request: { readId: string; group: "selectedDateTasks" | "overdueTasks"; cursor: string }) => Promise<unknown>;
}>;

@Controller("v1/calendar/reads")
class CalendarController {
  constructor(@Inject(dependenciesKey) private readonly dependencies: CalendarControllerDependencies) {}

  @Post()
  async create(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = await authenticateSeasonRequest(authorization, this.dependencies.verify);
    const request = validateCalendarReadRequest(body);
    return validateCalendarReadResponse(await this.dependencies.createRead(identity, request));
  }

  @Get(":readId/pages")
  async page(
    @Headers("authorization") authorization: string | undefined,
    @Param("readId") readId: string,
    @Query("group") groupValue: string | undefined,
    @Query("cursor") cursor: string | undefined,
  ): Promise<unknown> {
    const identity = await authenticateSeasonRequest(authorization, this.dependencies.verify);
    if (!readIdPattern.test(readId)) throw new NotFoundException();
    if (!groupValue || !calendarGroups.has(groupValue) || !cursor) {
      throw new ApiError(400, "INVALID_REQUEST", "Choose a valid Calendar page group and cursor");
    }
    const group = groupValue as "selectedDateTasks" | "overdueTasks";
    return this.dependencies.readPage(identity, { readId, group, cursor });
  }
}

export function createCalendarControllerModule(dependencies: CalendarControllerDependencies): DynamicModule {
  @Module({
    controllers: [CalendarController],
    providers: [{ provide: dependenciesKey, useValue: dependencies }],
  })
  class ConfiguredCalendarControllerModule {}
  return { module: ConfiguredCalendarControllerModule };
}
