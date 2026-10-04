import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import { BusinessScopeForbiddenError, type AuthorizedBusinessScope, type MembershipScopeService } from "../authorization/membership-scope.service.js";
import type { FieldDetail, FieldPage, FieldPageQuery, FieldsReadRepository } from "./fields-read.repository.js";

export class FieldsReadService {
  constructor(
    private readonly membershipScope: MembershipScopeService,
    private readonly repository: FieldsReadRepository,
  ) {}

  private async authorizedScope(identity: VerifiedSubject): Promise<AuthorizedBusinessScope> {
    const scope = await this.membershipScope.resolveDefaultBusinessScope(identity);
    if (!scope) throw new BusinessScopeForbiddenError();
    return scope;
  }

  async list(identity: VerifiedSubject, query: FieldPageQuery): Promise<FieldPage> {
    const scope = await this.authorizedScope(identity);
    return this.repository.readPage(scope, query);
  }

  async read(identity: VerifiedSubject, fieldId: string): Promise<FieldDetail | null> {
    const scope = await this.authorizedScope(identity);
    return this.repository.readDetail(scope, fieldId);
  }
}
