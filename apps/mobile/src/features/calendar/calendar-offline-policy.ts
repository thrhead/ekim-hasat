export type CalendarOfflineScope = Readonly<{
  businessId: string;
  selectedDate: string;
  fieldScope: Readonly<{ mode: "allAuthorized" | "oneField"; fieldId?: string; includedFieldIds: readonly string[] }>;
}>;
export type CalendarFallbackError = Readonly<{ retryable?: boolean; status?: number; code?: string }>;
export type CalendarSavedViewIdentity = CalendarOfflineScope & Readonly<{
  accountId: string;
  readId: string;
  coverageStatus: "COMPLETE";
}>;

export function canUseCalendarSavedView(input: Readonly<{
  error: CalendarFallbackError;
  accountId: string;
  requested: CalendarOfflineScope;
  savedView: CalendarSavedViewIdentity | null;
}>): boolean {
  const { error, savedView, accountId, requested } = input;
  if (!savedView || error.retryable !== true || (error.status !== undefined && error.status >= 400 && error.status < 500)
    || error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN" || error.code === "MEMBERSHIP_REVOKED"
    || error.code === "ACCESS_REVOKED" || error.code === "ACCESS_DENIED") return false;
  return savedView.coverageStatus === "COMPLETE" && savedView.accountId === accountId
    && savedView.businessId === requested.businessId && savedView.selectedDate === requested.selectedDate
    && savedView.fieldScope.mode === requested.fieldScope.mode
    && savedView.fieldScope.fieldId === requested.fieldScope.fieldId
    && sameIds(savedView.fieldScope.includedFieldIds, requested.fieldScope.includedFieldIds);
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
