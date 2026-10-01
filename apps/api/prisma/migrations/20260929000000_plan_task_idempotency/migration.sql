BEGIN;

ALTER TABLE season_command_idempotency_records
  DROP CONSTRAINT season_command_check;

ALTER TABLE season_command_idempotency_records
  ADD CONSTRAINT season_command_check
  CHECK (command IN ('CREATE', 'ACTIVATE', 'ADD_PLAN_TASK'));

COMMIT;
