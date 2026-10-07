import { validateLocalDate } from "@ekim-hasat/domain/seasons/local-date";
import { businessLocalDate, resolveBusinessTimezone } from "../seasons/business-timezone.js";

export type CalendarDateContext = Readonly<{
  selectedDate: string;
  businessLocalToday: string;
  timezone: string;
  monthStart: string;
  monthEnd: string;
  isOverdue: (plannedLocalDate: string) => boolean;
}>;

/** Resolve Calendar's date identity from the captured server instant and authorized Business timezone. */
export function resolveCalendarDates(input: {
  selectedDate?: unknown;
  timezone: string | null | undefined;
  asOf: Date;
}): CalendarDateContext {
  if (!(input.asOf instanceof Date) || !Number.isFinite(input.asOf.getTime())) {
    throw new Error("Calendar read requires a valid captured asOf instant");
  }

  const timezone = resolveBusinessTimezone(input.timezone);
  const businessLocalToday = businessLocalDate(input.asOf, timezone);
  const selectedDate = input.selectedDate === undefined
    ? businessLocalToday
    : validateLocalDate(input.selectedDate);
  const [year, month] = selectedDate.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  const monthStart = `${year!.toString().padStart(4, "0")}-${month!.toString().padStart(2, "0")}-01`;
  const monthEnd = `${year!.toString().padStart(4, "0")}-${month!.toString().padStart(2, "0")}-${lastDay.toString().padStart(2, "0")}`;

  return Object.freeze({
    selectedDate,
    businessLocalToday,
    timezone,
    monthStart,
    monthEnd,
    isOverdue: (plannedLocalDate: string) => validateLocalDate(plannedLocalDate) < businessLocalToday,
  });
}
