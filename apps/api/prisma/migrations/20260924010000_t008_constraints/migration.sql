-- T008: enforce stable identity, membership, completion, and retry invariants.
-- This migration adds indexes/uniqueness only; T007's foreign keys and
-- PostGIS geometry typmods remain unchanged.

CREATE UNIQUE INDEX "application_users_auth_provider_auth_subject_key"
    ON "application_users"("auth_provider", "auth_subject");
CREATE INDEX "application_users_default_business_id_idx"
    ON "application_users"("default_business_id");

CREATE UNIQUE INDEX "memberships_business_id_user_id_key"
    ON "memberships"("business_id", "user_id");
CREATE INDEX "memberships_user_id_business_id_status_idx"
    ON "memberships"("user_id", "business_id", "status");

CREATE INDEX "fields_business_id_idx"
    ON "fields"("business_id");
CREATE INDEX "field_boundary_versions_field_id_idx"
    ON "field_boundary_versions"("field_id");

CREATE UNIQUE INDEX "onboarding_completions_user_id_default_business_id_key"
    ON "onboarding_completions"("user_id", "default_business_id");
CREATE INDEX "onboarding_completions_field_id_idx"
    ON "onboarding_completions"("field_id");

CREATE UNIQUE INDEX "idempotency_records_user_id_key_key"
    ON "idempotency_records"("user_id", "key");
CREATE INDEX "idempotency_records_expires_at_idx"
    ON "idempotency_records"("expires_at");
CREATE INDEX "idempotency_records_field_id_idx"
    ON "idempotency_records"("field_id");
