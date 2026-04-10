DROP INDEX IF EXISTS idx_follow_up_reminders_unique;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'follow_up_reminders_result_date_days_unique'
  ) THEN
    ALTER TABLE follow_up_reminders
      ADD CONSTRAINT follow_up_reminders_result_date_days_unique
      UNIQUE (patient_exam_result_id, next_appointment_date, days_before);
  END IF;
END $$;
