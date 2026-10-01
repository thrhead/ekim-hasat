import type { LocalDate } from "./local-date.js";

/** Central identity stays stable when its immutable definition version changes. */
export type CropReference =
  | Readonly<{
      kind: "CENTRAL";
      cropKey: string;
      cropDefinitionVersionId: string;
      displayName: string;
    }>
  | Readonly<{
      kind: "CUSTOM";
      businessId: string;
      customCropId: string;
      displayName: string;
    }>;

export type ImmutableTemplateProvenance = Readonly<{
  templateKey: string;
  templateVersionId: string;
  version: string;
  cropDefinitionVersionId: string;
  regionSelector: string | null;
}>;

/** A manual plan cannot claim a centrally validated template reference. */
export type PlanSource =
  | Readonly<{ source: "MANUAL"; templateProvenance: null }>
  | Readonly<{
      source: "VALIDATED_TEMPLATE";
      templateProvenance: ImmutableTemplateProvenance;
    }>;

export type PlannedTask = Readonly<{
  id: string;
  seasonPlanId: string;
  title: string;
  description: string | null;
  plannedLocalDate: LocalDate;
  sourceTemplateTaskKey: string | null;
  version: number;
}>;

export type SeasonPlan = PlanSource & Readonly<{
  id: string;
  seasonId: string;
  status: "DRAFT" | "APPROVED";
  tasks: readonly PlannedTask[];
}>;

/** Immutable activation context; point-only fields have no boundary version. */
export type ActivationSnapshot = PlanSource & Readonly<{
  seasonId: string;
  fieldBoundaryVersionId: string | null;
  regionContext: string | null;
  crop: CropReference;
  actualPlantingDate: LocalDate;
  businessTimezone: string;
  activatedAt: string;
  approvedTasks: readonly PlannedTask[];
}>;

type SeasonContext = Readonly<{
  id: string;
  businessId: string;
  fieldId: string;
  crop: CropReference;
  actualPlantingDate: LocalDate;
  version: number;
  createdAt: string;
}>;

export type Season = SeasonContext & (
  | Readonly<{ status: "DRAFT"; activatedAt: null; activationSnapshot: null }>
  | Readonly<{
      status: "ACTIVE";
      activatedAt: string;
      activationSnapshot: ActivationSnapshot;
    }>
);

/** The outcome is written in the same transaction as its season command. */
export type CommandIdempotencyRecord<TResult = Season> = Readonly<{
  applicationUserId: string;
  businessId: string;
  command: "CREATE" | "ACTIVATE";
  idempotencyKey: string;
  payloadFingerprint: string;
  seasonId: string;
  result: TResult;
  createdAt: string;
  expiresAt: string;
}>;
