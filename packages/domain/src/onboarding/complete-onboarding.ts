import { validateFieldLocation, type FieldLocation } from "../fields/field-location.js";
import { createVerifiedSubject, type VerifiedSubject } from "../identity/auth-provider.js";

export type FirstFieldSummary = {
  id: string;
  name: string;
  representativePoint: { type: "Point"; coordinates: [number, number] };
  createdAt: string | Date;
  boundary?: {
    id: string;
    version: number;
    verificationStatus: string;
    geometry: Extract<FieldLocation, { type: "Polygon" }>;
  };
};

export type FirstFieldPersistenceOutcome =
  | { kind: "created" | "replayed" | "already_completed"; field: FirstFieldSummary }
  | { kind: "conflict" };

export type PersistFirstFieldInput = {
  identity: VerifiedSubject;
  name: string;
  location: FieldLocation;
  idempotencyKey: string;
  payloadFingerprint: string;
};

/** The one persistence seam for first-field completion. */
export interface OnboardingCompletionRepository {
  persistFirstFieldOnboardingCompletion(
    input: PersistFirstFieldInput,
  ): Promise<FirstFieldPersistenceOutcome>;
}

export type CompleteOnboardingRequest = {
  idempotencyKey: string;
  name?: unknown;
  location: unknown;
};

export type OnboardingCompletionResult = FirstFieldPersistenceOutcome;

export class OnboardingAuthenticationRequiredError extends Error {
  constructor() {
    super("A verified identity is required to complete onboarding");
    this.name = "OnboardingAuthenticationRequiredError";
  }
}

export class OnboardingCommandInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnboardingCommandInputError";
  }
}

/** Validate and normalize command input before delegating atomic persistence. */
export async function completeOnboarding(
  identityInput: VerifiedSubject,
  request: CompleteOnboardingRequest,
  repository: OnboardingCompletionRepository,
): Promise<OnboardingCompletionResult> {
  const identity = createVerifiedSubject(identityInput);
  if (!identity) throw new OnboardingAuthenticationRequiredError();
  if (typeof request !== "object" || request === null) {
    throw new OnboardingCommandInputError("A completion request is required");
  }
  if (typeof request.idempotencyKey !== "string" || request.idempotencyKey.trim().length === 0) {
    throw new OnboardingCommandInputError("A non-empty idempotency key is required");
  }
  if (request.name !== undefined && typeof request.name !== "string") {
    throw new OnboardingCommandInputError("Field name must be a string when provided");
  }

  validateFieldLocation(request.location);
  const name = typeof request.name === "string" && request.name.trim().length > 0
    ? request.name.trim()
    : "Tarla 1";
  const location = request.location as FieldLocation;
  const payloadFingerprint = await fingerprintPayload({ name, location });

  return repository.persistFirstFieldOnboardingCompletion({
    identity,
    name,
    location,
    idempotencyKey: request.idempotencyKey,
    payloadFingerprint,
  });
}

async function fingerprintPayload(payload: { name: string; location: FieldLocation }): Promise<string> {
  const canonicalPayload = JSON.stringify({
    name: payload.name,
    location: canonicalize(payload.location),
  });
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalPayload),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}
