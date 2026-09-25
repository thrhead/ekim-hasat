import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { UnauthorizedException } from "@nestjs/common";
import {
  createVerifiedSubject,
  type Authenticator,
  type VerifiedSubject,
} from "@ekim-hasat/domain/identity/auth-provider";

/** Credential failures intentionally reveal no provider response details. */
export class AuthenticationFailure extends UnauthorizedException {
  constructor() {
    super("Authentication failed");
    this.name = "AuthenticationFailure";
  }
}

/** Narrow structural seam for tests; provider SDK types stay in this adapter. */
type SupabaseUserVerifier = Pick<SupabaseClient["auth"], "getUser">;

/** Verifies bearer access tokens through Supabase Auth and returns only identity. */
export class SupabaseAuthAdapter implements Authenticator<string> {
  private readonly verifier: SupabaseUserVerifier;

  constructor(config: { url: string; anonKey: string }, verifier?: SupabaseUserVerifier) {
    this.verifier = verifier ?? createClient(config.url, config.anonKey).auth;
  }

  async verify(credential: string): Promise<VerifiedSubject> {
    if (typeof credential !== "string" || credential.trim().length === 0) {
      throw new AuthenticationFailure();
    }

    try {
      const { data, error } = await this.verifier.getUser(credential);
      if (error || !data.user) throw new AuthenticationFailure();

      // Only the verified stable subject crosses the adapter boundary. Ignore
      // app_metadata/user_metadata, roles, sessions, and all other SDK payload.
      const verified = createVerifiedSubject({ provider: "supabase", subject: data.user.id });
      if (!verified) throw new AuthenticationFailure();
      return verified;
    } catch {
      // Do not expose or log provider errors, token material, or user payload.
      throw new AuthenticationFailure();
    }
  }
}
