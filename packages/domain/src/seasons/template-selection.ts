import { validateLocalDate, validatePlannedTaskDate, type LocalDate } from "./local-date.js";
import type { CropReference, PlanSource } from "./types.js";

/** Runtime publication data, never a live CMS document. */
export type TemplateTaskDefinition = Readonly<{
  key: string;
  title: string;
  description?: string | null;
  offsetDays: number;
}>;

export type PublishedTemplateVersion = Readonly<{
  id: string;
  templateKey: string;
  version: string;
  cropDefinitionVersionId: string;
  regionSelector: string | null;
  published: boolean;
  available: boolean;
  taskDefinitions: readonly TemplateTaskDefinition[];
}>;

/** Contains content identifiers only; no farmer, business or field data. */
export type TemplateQualityDiagnostic =
  | Readonly<{ code: "EMPTY_VALIDATED_TEMPLATE"; templateVersionId: string; templateKey: string }>
  | Readonly<{ code: "AMBIGUOUS_VALIDATED_TEMPLATE"; templateVersionIds: readonly string[] }>;

export type TemplateSelection =
  | Readonly<{ availability: "AVAILABLE"; template: PublishedTemplateVersion }>
  | Readonly<{
      availability: "NOT_APPLICABLE" | "EMPTY_TASK_DEFINITIONS" | "AMBIGUOUS_TEMPLATE_VERSIONS";
      template: null;
    }>;

export type InitialPlanTask = Readonly<{
  title: string;
  description: string | null;
  plannedLocalDate: LocalDate;
  sourceTemplateTaskKey: string;
}>;

export type InitialPlan = PlanSource & Readonly<{ tasks: readonly InitialPlanTask[] }>;

export class TemplateSelectionError extends Error {
  constructor(
    public readonly code:
      | "MANUAL_PLAN_CHOICE_REQUIRED"
      | "VALIDATED_TEMPLATE_REQUIRED"
      | "AMBIGUOUS_VALIDATED_TEMPLATE"
      | "INVALID_TEMPLATE_TASK_DEFINITION",
    message: string,
  ) {
    super(message);
    this.name = "TemplateSelectionError";
  }
}

/** Regional context narrows current published versions; names never establish applicability. */
export function selectValidatedTemplate(
  crop: CropReference,
  regionSelector: string | null,
  templates: readonly PublishedTemplateVersion[],
  onDiagnostic?: (diagnostic: TemplateQualityDiagnostic) => void,
): TemplateSelection {
  if (crop.kind === "CUSTOM") return { availability: "NOT_APPLICABLE", template: null };
  const eligible = templates.filter((template) =>
    template.published && template.available && template.cropDefinitionVersionId === crop.cropDefinitionVersionId,
  );
  const regional = regionSelector === null ? [] : eligible.filter((template) => template.regionSelector === regionSelector);
  const applicable = regional.length > 0 ? regional : eligible.filter((template) => template.regionSelector === null);
  if (applicable.length === 0) return { availability: "NOT_APPLICABLE", template: null };
  // Publication ordering is not defined by SPEC-002. Do not invent precedence
  // from opaque version strings or silently select from an ambiguous set.
  if (applicable.length > 1) {
    onDiagnostic?.({ code: "AMBIGUOUS_VALIDATED_TEMPLATE", templateVersionIds: applicable.map((template) => template.id) });
    return { availability: "AMBIGUOUS_TEMPLATE_VERSIONS", template: null };
  }
  const template = applicable[0];
  if (template.taskDefinitions.length === 0) {
    onDiagnostic?.({ code: "EMPTY_VALIDATED_TEMPLATE", templateVersionId: template.id, templateKey: template.templateKey });
    return { availability: "EMPTY_TASK_DEFINITIONS", template: null };
  }
  // Detach the selected publication so later changes to adapter-owned objects
  // cannot rewrite either the selected provenance or subsequent task copies.
  return {
    availability: "AVAILABLE",
    template: Object.freeze({
      ...template,
      taskDefinitions: Object.freeze(template.taskDefinitions.map((task) => Object.freeze({ ...task }))),
    }),
  };
}

/** The caller passes the farmer's explicit MANUAL choice; absence never implies fallback. */
export function prepareInitialPlan(
  selection: TemplateSelection,
  explicitManual: boolean,
  actualPlantingDate: unknown,
): InitialPlan {
  const actual = validateLocalDate(actualPlantingDate);
  if (selection.availability === "AMBIGUOUS_TEMPLATE_VERSIONS") {
    throw new TemplateSelectionError("AMBIGUOUS_VALIDATED_TEMPLATE", "The published template selection is ambiguous.");
  }
  if (selection.availability !== "AVAILABLE") {
    if (!explicitManual) {
      throw new TemplateSelectionError("MANUAL_PLAN_CHOICE_REQUIRED", "Choose a manual plan to continue without a validated template.");
    }
    return Object.freeze({ source: "MANUAL", templateProvenance: null, tasks: Object.freeze([]) });
  }
  if (explicitManual) {
    throw new TemplateSelectionError("VALIDATED_TEMPLATE_REQUIRED", "An applicable validated template must be used.");
  }
  const template = selection.template;
  if (template.taskDefinitions.length === 0) {
    throw new TemplateSelectionError("MANUAL_PLAN_CHOICE_REQUIRED", "The validated plan is unavailable; choose a manual plan explicitly.");
  }
  const tasks = template.taskDefinitions.map((task) => {
    if (typeof task.key !== "string" || !task.key.trim() || typeof task.title !== "string" ||
        !task.title.trim() || task.title.length > 200 ||
        (task.description !== undefined && task.description !== null &&
          (typeof task.description !== "string" || task.description.length > 2000)) ||
        !Number.isSafeInteger(task.offsetDays) || task.offsetDays < 0) {
      throw new TemplateSelectionError("INVALID_TEMPLATE_TASK_DEFINITION", "A published task definition is invalid for an actual-date season.");
    }
    return Object.freeze({
      title: task.title,
      description: task.description ?? null,
      plannedLocalDate: offsetLocalDate(actual, task.offsetDays),
      sourceTemplateTaskKey: task.key,
    });
  });
  return Object.freeze({
    source: "VALIDATED_TEMPLATE",
    templateProvenance: Object.freeze({
      templateKey: template.templateKey,
      templateVersionId: template.id,
      version: template.version,
      cropDefinitionVersionId: template.cropDefinitionVersionId,
      regionSelector: template.regionSelector,
    }),
    tasks: Object.freeze(tasks),
  });
}

function offsetLocalDate(actual: LocalDate, offsetDays: number): LocalDate {
  // Use UTC calendar operations as date arithmetic only. setUTCFullYear avoids
  // JavaScript's special interpretation of years 00–99 in Date.UTC().
  const calendar = new Date(0);
  calendar.setUTCFullYear(Number(actual.slice(0, 4)), Number(actual.slice(5, 7)) - 1, Number(actual.slice(8, 10)));
  calendar.setUTCDate(calendar.getUTCDate() + offsetDays);
  if (!Number.isFinite(calendar.getTime()) || calendar.getUTCFullYear() > 9999) {
    throw new TemplateSelectionError("INVALID_TEMPLATE_TASK_DEFINITION", "A published task falls outside the supported calendar.");
  }
  return validatePlannedTaskDate(calendar.toISOString().slice(0, 10), actual);
}
