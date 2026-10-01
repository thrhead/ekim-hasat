CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE "businesses" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "application_users" (
    "id" UUID NOT NULL,
    "auth_provider" TEXT NOT NULL,
    "auth_subject" TEXT NOT NULL,
    "default_business_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "application_users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "application_users_default_business_id_fkey" FOREIGN KEY ("default_business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "memberships_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "application_users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "fields" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "representative_point" geometry(Point,4326) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "fields_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fields_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "field_boundary_versions" (
    "id" UUID NOT NULL,
    "field_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "geometry" geometry(Polygon,4326) NOT NULL,
    "verification_status" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "field_boundary_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "field_boundary_versions_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "fields"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "onboarding_completions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "default_business_id" UUID NOT NULL,
    "field_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "onboarding_completions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "onboarding_completions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "application_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "onboarding_completions_default_business_id_fkey" FOREIGN KEY ("default_business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "onboarding_completions_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "fields"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "payload_fingerprint" TEXT NOT NULL,
    "field_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "idempotency_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "application_users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "idempotency_records_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "fields"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
