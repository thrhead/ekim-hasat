/**
 * The minimum identity the application may trust after an auth adapter has
 * verified a provider credential. This identifies an external subject only;
 * it carries no application-user, business, membership, or role authority.
 */
export type VerifiedSubject = Readonly<{
  provider: string;
  subject: string;
}>;

/** Provider-neutral boundary implemented by an API-side authentication adapter. */
export interface Authenticator<Credential = unknown> {
  verify(credential: Credential): Promise<VerifiedSubject | null>;
}

/**
 * Validate and freeze an adapter result before passing it to application code.
 * Invalid or absent subjects are authentication-boundary failures, not domain
 * values the domain should guess how to repair.
 */
export function createVerifiedSubject(input: unknown): VerifiedSubject | null {
  if (typeof input !== "object" || input === null) return null;

  const candidate = input as Record<string, unknown>;
  if (
    typeof candidate.provider !== "string" ||
    candidate.provider.trim().length === 0 ||
    typeof candidate.subject !== "string" ||
    candidate.subject.trim().length === 0
  ) {
    return null;
  }

  return Object.freeze({
    provider: candidate.provider,
    subject: candidate.subject,
  });
}
