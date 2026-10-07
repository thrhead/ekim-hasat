import type { ApiClient, CalendarComponents } from "../../../../../packages/api-client/src/index";

export type CalendarRead = CalendarComponents["schemas"]["CalendarRead"];
export type CalendarRequestToken = Readonly<{
  revision: number;
  accountId: string;
  client: ApiClient;
}>;
export type CalendarActiveReadIdentity = Readonly<{
  accountId: string;
  businessId: string;
  readId: string;
  selectedDate: string;
  fieldScope: CalendarRead["fieldScope"];
}>;

/** Keeps asynchronous Calendar results tied to the current auth and server read scope. */
export class CalendarRequestState {
  private revision = 0;
  private accountId: string | null = null;
  private client: ApiClient | null = null;
  private identity: CalendarActiveReadIdentity | null = null;

  beginRead(accountId: string, client: ApiClient): CalendarRequestToken {
    if (this.accountId !== accountId || this.client !== client) this.identity = null;
    this.accountId = accountId;
    this.client = client;
    this.revision += 1;
    this.identity = null;
    return Object.freeze({ revision: this.revision, accountId, client });
  }

  beginPage(token: CalendarRequestToken, readId: string): CalendarRequestToken | null {
    return this.isCurrent(token) && this.identity?.readId === readId ? token : null;
  }

  acceptRead(token: CalendarRequestToken, read: CalendarRead): boolean {
    if (!this.isCurrent(token)) return false;
    this.identity = Object.freeze({
      accountId: token.accountId,
      businessId: read.businessId,
      readId: read.readId,
      selectedDate: read.selectedDate,
      fieldScope: read.fieldScope,
    });
    return true;
  }

  isCurrent(token: CalendarRequestToken): boolean {
    return token.revision === this.revision && token.accountId === this.accountId && token.client === this.client;
  }

  isCurrentRead(token: CalendarRequestToken, readId: string, businessId: string): boolean {
    return this.isCurrent(token) && this.identity?.accountId === token.accountId
      && this.identity.readId === readId && this.identity.businessId === businessId;
  }

  restartExpiredRead(token: CalendarRequestToken, readId: string, businessId: string): boolean {
    if (!this.isCurrentRead(token, readId, businessId)) return false;
    this.revision += 1;
    this.identity = null;
    return true;
  }

  currentIdentity(): CalendarActiveReadIdentity | null { return this.identity; }

  invalidate(): void {
    this.revision += 1;
    this.accountId = null;
    this.client = null;
    this.identity = null;
  }
}
