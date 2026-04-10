CREATE TABLE IF NOT EXISTS follow_up_reminder_notifications (
  id BIGSERIAL PRIMARY KEY,
  patient_exam_result_id BIGINT NOT NULL REFERENCES patient_exam_results(id) ON DELETE CASCADE,
  next_appointment_date DATE NOT NULL,
  days_before INTEGER NOT NULL CHECK (days_before >= 0),
  telegram_chat_id TEXT,
  notified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_follow_up_reminders_unique
  ON follow_up_reminder_notifications(patient_exam_result_id, next_appointment_date, days_before);

CREATE INDEX IF NOT EXISTS idx_follow_up_reminders_date
  ON follow_up_reminder_notifications(next_appointment_date, days_before);
