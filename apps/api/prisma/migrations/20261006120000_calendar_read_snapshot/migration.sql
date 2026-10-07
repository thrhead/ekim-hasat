CREATE TABLE "calendar_read_snapshots" (
    "read_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "field_scope_kind" TEXT NOT NULL,
    "field_id" UUID,
    "selected_date" DATE NOT NULL,
    "business_timezone" TEXT NOT NULL,
    "business_local_today" DATE NOT NULL,
    "month_start" DATE NOT NULL,
    "month_end" DATE NOT NULL,
    "query_version" TEXT NOT NULL,
    "month_indicators" JSONB NOT NULL,
    "as_of" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'READY',

    CONSTRAINT "calendar_read_snapshots_pkey" PRIMARY KEY ("read_id")
);

CREATE INDEX "calendar_read_snapshots_expires_at_idx"
    ON "calendar_read_snapshots"("expires_at");

CREATE TABLE "calendar_read_snapshot_tasks" (
    "id" UUID NOT NULL,
    "read_id" UUID NOT NULL,
    "result_group" TEXT NOT NULL,
    "task_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "planned_local_date" DATE NOT NULL,
    "task_version" INTEGER,
    "field_id" UUID NOT NULL,
    "field_name" TEXT NOT NULL,
    "season_id" UUID NOT NULL,
    "season_context" JSONB NOT NULL,
    "plan_context" JSONB NOT NULL,
    "overdue" BOOLEAN NOT NULL,

    CONSTRAINT "calendar_read_snapshot_tasks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "calendar_read_snapshot_tasks_read_id_fkey"
        FOREIGN KEY ("read_id") REFERENCES "calendar_read_snapshots"("read_id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "calendar_read_snapshot_tasks_read_id_result_group_task_id_key"
    ON "calendar_read_snapshot_tasks"("read_id", "result_group", "task_id");

CREATE INDEX "calendar_read_snapshot_tasks_read_id_result_group_planned_local_date_task_id_idx"
    ON "calendar_read_snapshot_tasks"("read_id", "result_group", "planned_local_date", "task_id");

CREATE TABLE "calendar_read_cursors" (
    "id" UUID NOT NULL,
    "read_id" UUID NOT NULL,
    "result_group" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "last_planned_local_date" DATE NOT NULL,
    "last_task_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_read_cursors_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "calendar_read_cursors_read_id_fkey"
        FOREIGN KEY ("read_id") REFERENCES "calendar_read_snapshots"("read_id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "calendar_read_cursors_token_key"
    ON "calendar_read_cursors"("token");

CREATE UNIQUE INDEX "calendar_read_cursors_read_id_result_group_last_planned_local_date_last_task_id_key"
    ON "calendar_read_cursors"("read_id", "result_group", "last_planned_local_date", "last_task_id");

CREATE INDEX "calendar_read_cursors_read_id_result_group_idx"
    ON "calendar_read_cursors"("read_id", "result_group");
