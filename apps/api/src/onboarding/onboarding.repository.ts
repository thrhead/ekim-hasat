import { randomUUID } from "node:crypto";
import {
  DefaultBusinessContextUnauthorizedError as DomainDefaultBusinessContextUnauthorizedError,
  type DefaultBusinessResolution,
  type OnboardingStatusRepository,
  type AuthorizedDefaultBusiness,
} from "@ekim-hasat/domain/onboarding/get-onboarding-status";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import { Prisma, PrismaClient } from "../generated/prisma/client.js";

export type VerifiedIdentity = { provider: string; subject: string };

export type AuthorizedDefaultContext = {
  userId: string;
  businessId: string;
  membershipId: string;
};

export type FirstFieldLocation =
  | { type: "Point"; coordinates: [number, number] }
  | { type: "Polygon"; coordinates: [number, number][][] };

export type FirstFieldSummary = {
  id: string;
  name: string;
  representativePoint: { type: "Point"; coordinates: [number, number] };
  createdAt: Date;
  boundary?: {
    id: string;
    version: number;
    geometry: { type: "Polygon"; coordinates: [number, number][][] };
    verificationStatus: string;
  };
};

export type FirstFieldCompletionInput = {
  identity: VerifiedIdentity;
  name: string;
  location: FirstFieldLocation;
  idempotencyKey: string;
  payloadFingerprint: string;
};

export type FirstFieldCompletionOutcome =
  | { kind: "created" | "replayed" | "already_completed"; field: FirstFieldSummary }
  | { kind: "conflict" };

/** The saved default business has no active membership for this user. */
export class DefaultBusinessContextUnauthorizedError extends Error {
  constructor() {
    super("The default business context is not authorized for this user");
    this.name = "DefaultBusinessContextUnauthorizedError";
  }
}

/**
 * Resolves the user's default business while keeping bootstrap and the caller's
 * database work in one transaction. The verified auth identity is only used to
 * find the application user; Membership is the sole authorization authority.
 */
export class OnboardingRepository implements OnboardingStatusRepository {
  private static readonly maxTransactionAttempts = 3;

  constructor(private readonly prisma: PrismaClient) {}

  /** Resolve status context without creating or adopting any business. */
  async resolveDefaultBusiness(
    identity: VerifiedSubject,
  ): Promise<DefaultBusinessResolution> {
    const user = await this.prisma.applicationUser.findUnique({
      where: {
        authProvider_authSubject: {
          authProvider: identity.provider,
          authSubject: identity.subject,
        },
      },
      select: { id: true, defaultBusinessId: true },
    });
    if (!user || user.defaultBusinessId === null) return { kind: "missing" };

    const membership = await this.prisma.membership.findUnique({
      where: {
        businessId_userId: {
          businessId: user.defaultBusinessId,
          userId: user.id,
        },
      },
      select: { status: true },
    });
    if (!membership || membership.status !== "ACTIVE") {
      throw new DomainDefaultBusinessContextUnauthorizedError();
    }

    return {
      kind: "authorized",
      userId: user.id,
      businessId: user.defaultBusinessId,
    };
  }

  /** Read completion only within a context authorized by Membership above. */
  async hasCompletedOnboarding(context: AuthorizedDefaultBusiness): Promise<boolean> {
    const completion = await this.prisma.onboardingCompletion.findUnique({
      where: {
        userId_defaultBusinessId: {
          userId: context.userId,
          defaultBusinessId: context.businessId,
        },
      },
      select: { id: true },
    });
    return completion !== null;
  }

  /** Persist the first field and its durable completion in the authorized context. */
  async persistFirstFieldOnboardingCompletion(
    input: FirstFieldCompletionInput,
  ): Promise<FirstFieldCompletionOutcome> {
    const retentionHours = Number(process.env.ONBOARDING_IDEMPOTENCY_RETENTION_HOURS ?? "24");
    if (!Number.isFinite(retentionHours) || retentionHours <= 0) {
      throw new Error("ONBOARDING_IDEMPOTENCY_RETENTION_HOURS must be positive");
    }
    return this.withAuthorizedDefaultContext(input.identity, async (tx, context) => {
      const retained = await tx.idempotencyRecord.findUnique({
        where: { userId_key: { userId: context.userId, key: input.idempotencyKey } },
        select: { payloadFingerprint: true, fieldId: true, expiresAt: true },
      });
      if (retained && retained.expiresAt.getTime() > Date.now()) {
        if (retained.payloadFingerprint !== input.payloadFingerprint) {
          return { kind: "conflict" };
        }
        return {
          kind: "replayed",
          field: await this.readFirstFieldSummary(tx, retained.fieldId, context.businessId),
        };
      }

      const completion = await tx.onboardingCompletion.findUnique({
        where: {
          userId_defaultBusinessId: {
            userId: context.userId,
            defaultBusinessId: context.businessId,
          },
        },
        select: { fieldId: true },
      });
      if (completion) {
        return {
          kind: "already_completed",
          field: await this.readFirstFieldSummary(tx, completion.fieldId, context.businessId),
        };
      }

      const fieldId = randomUUID();
      if (input.location.type === "Point") {
        const [longitude, latitude] = input.location.coordinates;
        await tx.$executeRaw`
          INSERT INTO "fields" ("id", "business_id", "name", "representative_point")
          VALUES (${fieldId}::uuid, ${context.businessId}::uuid, ${input.name},
                  ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326))
        `;
      } else {
        const polygon = JSON.stringify(input.location);
        await tx.$executeRaw`
          INSERT INTO "fields" ("id", "business_id", "name", "representative_point")
          VALUES (${fieldId}::uuid, ${context.businessId}::uuid, ${input.name},
                  ST_PointOnSurface(ST_SetSRID(ST_GeomFromGeoJSON(${polygon}), 4326)))
        `;
        await tx.$executeRaw`
          INSERT INTO "field_boundary_versions" ("id", "field_id", "version", "geometry", "verification_status")
          VALUES (${randomUUID()}::uuid, ${fieldId}::uuid, 1,
                  ST_SetSRID(ST_GeomFromGeoJSON(${polygon}), 4326), 'UNVERIFIED')
        `;
      }

      await tx.onboardingCompletion.create({
        data: {
          userId: context.userId,
          defaultBusinessId: context.businessId,
          fieldId,
        },
      });
      await tx.idempotencyRecord.create({
        data: {
          userId: context.userId,
          key: input.idempotencyKey,
          payloadFingerprint: input.payloadFingerprint,
          fieldId,
          expiresAt: new Date(Date.now() + retentionHours * 60 * 60 * 1000),
        },
      });
      return {
        kind: "created",
        field: await this.readFirstFieldSummary(tx, fieldId, context.businessId),
      };
    });
  }

  private async readFirstFieldSummary(
    tx: Prisma.TransactionClient,
    fieldId: string,
    businessId: string,
  ): Promise<FirstFieldSummary> {
    const fields = await tx.$queryRaw<Array<{
      id: string;
      name: string;
      created_at: Date;
      point: string;
    }>>`
      SELECT "id", "name", "created_at", ST_AsGeoJSON("representative_point") AS point
      FROM "fields"
      WHERE "id" = ${fieldId}::uuid AND "business_id" = ${businessId}::uuid
    `;
    const field = fields[0];
    if (!field) throw new DefaultBusinessContextUnauthorizedError();

    const boundaries = await tx.$queryRaw<Array<{
      id: string;
      version: number;
      geometry: string;
      verification_status: string;
    }>>`
      SELECT "id", "version", ST_AsGeoJSON("geometry") AS geometry, "verification_status"
      FROM "field_boundary_versions"
      WHERE "field_id" = ${fieldId}::uuid
      ORDER BY "version" DESC
      LIMIT 1
    `;
    const boundary = boundaries[0];
    return {
      id: field.id,
      name: field.name,
      createdAt: field.created_at,
      representativePoint: JSON.parse(field.point) as FirstFieldSummary["representativePoint"],
      ...(boundary ? {
        boundary: {
          id: boundary.id,
          version: boundary.version,
          geometry: JSON.parse(boundary.geometry) as NonNullable<FirstFieldSummary["boundary"]>["geometry"],
          verificationStatus: boundary.verification_status,
        },
      } : {}),
    };
  }

  async withAuthorizedDefaultContext<T>(
    identity: VerifiedIdentity,
    operation: (
      tx: Prisma.TransactionClient,
      context: AuthorizedDefaultContext,
    ) => Promise<T> | T,
  ): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const context = await this.resolveDefaultContext(tx, identity);
            // Keep the callback in this transaction so first-field completion
            // can compose with context creation and roll both back together.
            // Callbacks must keep external side effects outside this boundary.
            return operation(tx, context);
          },
          { isolationLevel: "ReadCommitted" },
        );
      } catch (error) {
        if (
          attempt >= OnboardingRepository.maxTransactionAttempts ||
          !isRetryableTransactionConflict(error)
        ) {
          throw error;
        }

        // A retry reruns the callback only after PostgreSQL rolled back the
        // previous transaction. Do not retry uniqueness errors: completion and
        // retained-key conflicts must be handled by their caller after rollback.
        await delay(10 * attempt);
      }
    }
  }

  private async resolveDefaultContext(
    tx: Prisma.TransactionClient,
    identity: VerifiedIdentity,
  ): Promise<AuthorizedDefaultContext> {
    // Prisma's UUID default is client-side, so provide an ID for this raw insert.
    // ON CONFLICT handles concurrent creation of the same verified identity;
    // the winner is then serialized by the row lock below.
    await tx.$executeRaw`
      INSERT INTO "application_users" ("id", "auth_provider", "auth_subject")
      VALUES (${randomUUID()}::uuid, ${identity.provider}, ${identity.subject})
      ON CONFLICT ("auth_provider", "auth_subject") DO NOTHING
    `;

    const users = await tx.$queryRaw<
      Array<{ id: string; default_business_id: string | null }>
    >`
      SELECT "id", "default_business_id"
      FROM "application_users"
      WHERE "auth_provider" = ${identity.provider}
        AND "auth_subject" = ${identity.subject}
      FOR UPDATE
    `;
    const user = users[0];
    if (!user) {
      throw new Error("Application user could not be resolved from verified identity");
    }

    if (user.default_business_id !== null) {
      const membership = await tx.membership.findFirst({
        where: {
          userId: user.id,
          businessId: user.default_business_id,
          status: "ACTIVE",
        },
        select: { id: true },
      });
      if (!membership) {
        // A different Membership must never be adopted as a fallback context.
        throw new DefaultBusinessContextUnauthorizedError();
      }

      return {
        userId: user.id,
        businessId: user.default_business_id,
        membershipId: membership.id,
      };
    }

    // Do not inspect or adopt the user's other Memberships. A missing pointer
    // means bootstrap a new, server-owned default context atomically.
    const business = await tx.business.create({ data: {}, select: { id: true } });
    const membership = await tx.membership.create({
      data: {
        userId: user.id,
        businessId: business.id,
        role: "OWNER",
        status: "ACTIVE",
      },
      select: { id: true },
    });
    await tx.applicationUser.update({
      where: { id: user.id },
      data: { defaultBusinessId: business.id },
    });

    return { userId: user.id, businessId: business.id, membershipId: membership.id };
  }
}

function isRetryableTransactionConflict(error: unknown): boolean {
  // The pg adapter may expose SQLSTATE directly or nested as `cause`; Prisma
  // can wrap transaction conflicts as P2034. Keep this narrow: never retry a
  // generic unique violation or an application/authentication failure.
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth += 1) {
    if (typeof current === "object") {
      const candidate = current as { code?: unknown; cause?: unknown; meta?: unknown };
      if (
        candidate.code === "40001" ||
        candidate.code === "40P01" ||
        candidate.code === "P2034"
      ) {
        return true;
      }
      if (typeof candidate.meta === "object" && candidate.meta !== null) {
        const metaCode = (candidate.meta as { code?: unknown }).code;
        if (metaCode === "40001" || metaCode === "40P01") return true;
      }
      current = candidate.cause;
    } else {
      break;
    }
  }
  return false;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
