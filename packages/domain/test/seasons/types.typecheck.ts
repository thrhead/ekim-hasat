import type { ActivationSnapshot, CommandIdempotencyRecord, CropReference, ImmutableTemplateProvenance, PlanSource, Season } from "../../src/seasons/types.js";

type Assert<T extends true> = T;
type IsAssignable<T, U> = [T] extends [U] ? true : false;
type Not<T extends boolean> = T extends true ? false : true;

// These compiler checks guard discriminator guarantees without runtime fixtures.
export type ManualCannotClaimTemplate = Assert<Not<IsAssignable<
  { source: "MANUAL"; templateProvenance: { templateVersionId: string } },
  PlanSource
>>>;
export type ValidatedRequiresTemplate = Assert<Not<IsAssignable<
  { source: "VALIDATED_TEMPLATE"; templateProvenance: null },
  PlanSource
>>>;
export type ActiveRequiresSnapshot = Assert<IsAssignable<
  Extract<Season, { status: "ACTIVE" }>["activationSnapshot"], ActivationSnapshot
>>;
export type DraftHasNoSnapshot = Assert<IsAssignable<
  Extract<Season, { status: "DRAFT" }>["activationSnapshot"], null
>>;
export type CentralPinsVersion = Assert<IsAssignable<
  Extract<CropReference, { kind: "CENTRAL" }>["cropDefinitionVersionId"], string
>>;
export type CustomHasBusinessScope = Assert<IsAssignable<
  Extract<CropReference, { kind: "CUSTOM" }>["businessId"], string
>>;
export type TemplateVersionPreservesIdentifiers = Assert<IsAssignable<
  "2026-autumn.v2", ImmutableTemplateProvenance["version"]
>>;
export type CommandMatchesPersistence = Assert<IsAssignable<
  "CREATE" | "ACTIVATE", CommandIdempotencyRecord["command"]
>>;
