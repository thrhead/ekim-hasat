-- CreateTable
CREATE TABLE "harvests" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "field_id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "actor_membership_id" UUID NOT NULL,
    "harvest_date" DATE NOT NULL,
    "quantity" NUMERIC NOT NULL,
    "unit" TEXT NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "harvests_pkey" PRIMARY KEY ("business_id","id")
);

-- CreateIndex
CREATE INDEX "harvests_field_history_idx" ON "harvests"("business_id", "field_id", "harvest_date" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "harvests_field_season_history_idx" ON "harvests"("business_id", "field_id", "season_id", "harvest_date" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "harvests" ADD CONSTRAINT "harvests_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvests" ADD CONSTRAINT "harvests_field_id_business_id_fkey" FOREIGN KEY ("field_id", "business_id") REFERENCES "fields"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvests" ADD CONSTRAINT "harvests_season_id_business_id_field_id_fkey" FOREIGN KEY ("season_id", "business_id", "field_id") REFERENCES "seasons"("id", "business_id", "field_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvests" ADD CONSTRAINT "harvests_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "application_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvests" ADD CONSTRAINT "harvests_actor_membership_id_business_id_actor_user_id_fkey" FOREIGN KEY ("actor_membership_id", "business_id", "actor_user_id") REFERENCES "memberships"("id", "business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PostgreSQL checks preserve exact input scale; a NUMERIC typmod would round first.
ALTER TABLE "harvests" ADD CONSTRAINT "harvests_quantity_positive_check" CHECK ("quantity" > 0);
ALTER TABLE "harvests" ADD CONSTRAINT "harvests_quantity_range_check" CHECK ("quantity" < 100000000000);
ALTER TABLE "harvests" ADD CONSTRAINT "harvests_quantity_scale_check" CHECK (scale("quantity") <= 3);
ALTER TABLE "harvests" ADD CONSTRAINT "harvests_unit_check" CHECK ("unit" IN ('KG', 'METRIC_TONNE'));
