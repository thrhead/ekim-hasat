import type { VerifiedSubject } from "../identity/auth-provider.js";

/** Server-resolved scope after the user's default pointer and active Membership are checked. */
export type AuthorizedDefaultBusiness = Readonly<{
  userId: string;
  businessId: string;
}>;

/** The verified user exists, but has no server-owned default context pointer. */
export type MissingDefaultBusiness = Readonly<{ kind: "missing" }>;
export type DefaultBusinessResolution =
  | (AuthorizedDefaultBusiness & Readonly<{ kind: "authorized" }>)
  | MissingDefaultBusiness;

/** Persistence boundary for the minimum first-field onboarding status read. */
export interface OnboardingStatusRepository {
  /** Resolve the verified user and authorize any present server-owned pointer. */
  resolveDefaultBusiness(
    identity: VerifiedSubject,
  ): Promise<DefaultBusinessResolution>;
  /** Look up durable completion only inside the previously authorized scope. */
  hasCompletedOnboarding(context: AuthorizedDefaultBusiness): Promise<boolean>;
}

/** Privacy-safe failure for an invalid or unauthorized present default context. */
export class DefaultBusinessContextUnauthorizedError extends Error {
  constructor() {
    super("The default business context is not authorized for this user");
    this.name = "DefaultBusinessContextUnauthorizedError";
  }
}

export type OnboardingStatus = Readonly<{
  firstFieldOnboardingNeeded: boolean;
}>;

/**
 * Read durable completion only after authorizing a present default context.
 * A missing pointer is normal for a new farmer and means onboarding is needed.
 */
export async function getOnboardingStatus(
  identity: VerifiedSubject,
  repository: OnboardingStatusRepository,
): Promise<OnboardingStatus> {
  const context = await repository.resolveDefaultBusiness(identity);
  if (context.kind === "missing") {
    return { firstFieldOnboardingNeeded: true };
  }
  const completed = await repository.hasCompletedOnboarding(context);
  return { firstFieldOnboardingNeeded: !completed };
}
