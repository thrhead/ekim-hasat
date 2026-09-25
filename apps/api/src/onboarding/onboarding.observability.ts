import {
  RequestLogger,
  type ErrorCategory,
} from "../observability/request-logger.js";

/** Feature events use the shared request context and the logger's safe field allow-list. */
export class OnboardingObservability {
  constructor(private readonly logger = new RequestLogger()) {}

  started(): void {
    this.logger.diagnosticEvent("onboarding.started", { outcome: "started" });
  }

  defaultBusinessContextResolved(durationMs: number, outcome: "succeeded" | "failed" = "succeeded"): void {
    this.logger.diagnosticEvent("onboarding.default_business_context", {
      outcome,
      durationMs,
    });
  }

  fieldSaved(durationMs: number): void {
    this.logger.diagnosticEvent("onboarding.field_save", {
      outcome: "succeeded",
      durationMs,
    });
  }

  recoverableFailure(errorCategory: ErrorCategory, durationMs: number): void {
    this.logger.diagnosticEvent("onboarding.recoverable_failure", {
      outcome: "retryable_failure",
      errorCategory,
      durationMs,
    });
  }
}

export const onboardingObservability = new OnboardingObservability();
