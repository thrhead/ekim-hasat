CREATE INDEX task_date_adjustments_task_history_order_idx
  ON task_date_adjustments (planned_task_id, adjusted_at DESC, accepted_task_version DESC, id DESC);
