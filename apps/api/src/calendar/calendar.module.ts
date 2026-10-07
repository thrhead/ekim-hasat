import { Module, type DynamicModule } from "@nestjs/common";
import { MembershipScopeService } from "../authorization/membership-scope.service.js";
import { createCalendarControllerModule, type CalendarControllerDependencies } from "./calendar.controller.js";

export const CALENDAR_MODULE_DEPENDENCIES = Symbol("CALENDAR_MODULE_DEPENDENCIES");

export type CalendarModuleDependencies = CalendarControllerDependencies & Readonly<{
  membershipScope: MembershipScopeService;
}>;

/** Calendar composition reuses the API verifier and shared Membership authorization boundary. */
export function createCalendarModule(dependencies: CalendarModuleDependencies): DynamicModule {
  @Module({
    imports: [createCalendarControllerModule(dependencies)],
    providers: [{ provide: CALENDAR_MODULE_DEPENDENCIES, useValue: dependencies }],
    exports: [CALENDAR_MODULE_DEPENDENCIES],
  })
  class ConfiguredCalendarModule {}

  return { module: ConfiguredCalendarModule };
}
