import { ForbiddenException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import { validateManualActiveTask } from "@ekim-hasat/domain/seasons/plan-task-mutations";
import type { PrismaClient } from "../generated/prisma/client.js";
import { MembershipScopeService } from "../authorization/membership-scope.service.js";
import { ManualTaskCommandError } from "./manual-active-task.error.js";

export type ManualActiveTaskInput = Readonly<{ taskId: string; mutationId: string; title: string; description?: string | null; plannedLocalDate: string }>;
const uuid = (value: unknown): value is string => typeof value === "string" && /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value);
const fail = (status: number, code: ConstructorParameters<typeof ManualTaskCommandError>[1]): never => { throw new ManualTaskCommandError(status, code); };

export class ManualActiveTaskRepository {
  private readonly scopes: MembershipScopeService;
  constructor(private readonly prisma: PrismaClient) { this.scopes = new MembershipScopeService(prisma); }

  async create(identity: VerifiedSubject, seasonId: string, input: ManualActiveTaskInput) {
    let scope;
    try { scope = await this.scopes.resolveDefaultBusinessScope(identity); }
    catch (error) { if (error instanceof ForbiddenException) return fail(403, "ACCESS_DENIED"); throw error; }
    if (!scope || scope.role !== "OWNER") return fail(403, "ACCESS_DENIED");
    if (!uuid(seasonId) || !uuid(input?.taskId) || !uuid(input?.mutationId)) return fail(400, "INVALID_COMMAND");
    const authorized = scope;
    return this.prisma.$transaction(async tx => {
      const users = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM application_users WHERE id=${authorized.userId}::uuid AND auth_provider=${identity.provider} AND auth_subject=${identity.subject} AND default_business_id=${authorized.businessId}::uuid FOR UPDATE`;
      if (users.length !== 1) return fail(403, "ACCESS_DENIED");
      const members = await tx.$queryRaw<Array<{ role: string }>>`SELECT role FROM memberships WHERE id=${authorized.membershipId}::uuid AND user_id=${authorized.userId}::uuid AND business_id=${authorized.businessId}::uuid AND status='ACTIVE' FOR UPDATE`;
      if (members.length !== 1 || members[0]?.role !== "OWNER") return fail(403, "ACCESS_DENIED");
      const seasons = await tx.$queryRaw<Array<{ field_id: string; plan_id: string; status: string; plan_status: string; planting: string }>>`SELECT s.field_id::text, p.id::text AS plan_id, s.status, p.status AS plan_status, to_char(s.actual_planting_date,'YYYY-MM-DD') AS planting FROM seasons s JOIN fields f ON f.id=s.field_id AND f.business_id=s.business_id JOIN season_plans p ON p.season_id=s.id WHERE s.id=${seasonId}::uuid AND s.business_id=${authorized.businessId}::uuid FOR UPDATE OF s,f,p`;
      const season = seasons[0];
      if (!season) return fail(404, "RESOURCE_UNAVAILABLE");
      for (const key of [`task:${input.taskId.toLowerCase()}`, `mutation:${authorized.businessId}:${input.mutationId.toLowerCase()}`].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      const existing = await tx.manualTaskCreationReceipt.findFirst({ where: { OR: [{ taskId: input.taskId }, { businessId: authorized.businessId, mutationId: input.mutationId }] } });
      let value;
      try { value = validateManualActiveTask(input, season.planting); }
      catch { return fail(existing ? 409 : 422, existing ? "IDENTITY_CONFLICT" : "INVALID_TASK"); }
      const fingerprint = createHash("sha256").update(JSON.stringify([value.title,value.description,value.plannedLocalDate])).digest("hex");
      if (existing) {
        if (existing.taskId !== input.taskId.toLowerCase() || existing.mutationId !== input.mutationId.toLowerCase() || existing.businessId !== authorized.businessId || existing.seasonId !== seasonId.toLowerCase() || existing.fieldId !== season.field_id || existing.actorUserId !== authorized.userId || existing.actorMembershipId !== authorized.membershipId || existing.payloadFingerprint !== fingerprint) return fail(409, "IDENTITY_CONFLICT");
        return { replay: true, receipt: existing.acceptedResult };
      }
      if (season.status !== "ACTIVE" || season.plan_status !== "APPROVED") return fail(409, "SEASON_INELIGIBLE");
      const acceptedAt = new Date();
      const receipt = { taskId: input.taskId, mutationId: input.mutationId, seasonId, fieldId: season.field_id, title: value.title, description: value.description, plannedLocalDate: value.plannedLocalDate, sourceKind: "MANUAL" as const, templateVersionId: null, acceptedAt: acceptedAt.toISOString() };
      await tx.plannedTask.create({ data: { id: input.taskId, seasonPlanId: season.plan_id, title: value.title, description: value.description, plannedLocalDate: new Date(`${value.plannedLocalDate}T00:00:00.000Z`), origin: "POST_ACTIVATION_MANUAL" } });
      await tx.manualTaskCreationReceipt.create({ data: { taskId: input.taskId, mutationId: input.mutationId, businessId: authorized.businessId, fieldId: season.field_id, seasonId, seasonPlanId: season.plan_id, actorUserId: authorized.userId, actorMembershipId: authorized.membershipId, payloadFingerprint: fingerprint, acceptedResult: receipt, acceptedAt } });
      return { replay: false, receipt };
    }, { isolationLevel: "ReadCommitted" });
  }
}
