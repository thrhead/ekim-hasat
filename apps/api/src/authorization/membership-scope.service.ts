import {
  type VerifiedSubject,
} from "@ekim-hasat/domain/identity/auth-provider";
import { ForbiddenException } from "@nestjs/common";
import type { PrismaClient } from "../generated/prisma/client.js";

export type AuthorizedBusinessScope = Readonly<{
  userId: string;
  businessId: string;
  membershipId: string;
  role: string;
}>;

/** One privacy-safe outcome for every unusable saved business context. */
export class BusinessScopeForbiddenError extends ForbiddenException {
  constructor() {
    super("Business context is unavailable or not authorized");
    this.name = "BusinessScopeForbiddenError";
  }
}

/**
 * Resolves only the server-owned default business context for a verified
 * subject. A business identifier supplied elsewhere in the request is never
 * accepted by this API. Membership is the sole authorization authority.
 */
export class MembershipScopeService {
  constructor(private readonly prisma: PrismaClient) {}

  async resolveDefaultBusinessScope(
    identity: VerifiedSubject,
  ): Promise<AuthorizedBusinessScope | null> {
    return this.prisma.$transaction(
      async (tx) => {
        const user = await tx.applicationUser.findUnique({
          where: {
            authProvider_authSubject: {
              authProvider: identity.provider,
              authSubject: identity.subject,
            },
          },
          select: { id: true, defaultBusinessId: true },
        });

        // A new authenticated user has no application context yet. Callers
        // such as onboarding status can treat this as first-time onboarding.
        if (!user || user.defaultBusinessId === null) return null;

        const business = await tx.business.findUnique({
          where: { id: user.defaultBusinessId },
          select: { id: true },
        });
        if (!business) throw new BusinessScopeForbiddenError();

        const membership = await tx.membership.findUnique({
          where: {
            businessId_userId: {
              businessId: business.id,
              userId: user.id,
            },
          },
          select: { id: true, role: true, status: true },
        });
        if (!membership || membership.status !== "ACTIVE") {
          throw new BusinessScopeForbiddenError();
        }

        return Object.freeze({
          userId: user.id,
          businessId: business.id,
          membershipId: membership.id,
          role: membership.role,
        });
      },
      { isolationLevel: "RepeatableRead" },
    );
  }
}
