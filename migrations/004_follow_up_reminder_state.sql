CREATE TABLE IF NOT EXISTS follow_up_reminders (
  id BIGSERIAL PRIMARY KEY,
  patient_exam_result_id BIGINT NOT NULL REFERENCES patient_exam_results(id) ON DELETE CASCADE,
  next_appointment_date DATE NOT NULL,
  days_before INTEGER NOT NULL CHECK (days_before >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'acknowledged', 'expired')),
  ack_token TEXT NOT NULL UNIQUE,
  telegram_chat_id TEXT,
  telegram_message_id BIGINT,
  first_notified_at TIMESTAMPTZ,
  last_notified_at TIMESTAMPTZ,
  notification_count INTEGER NOT NULL DEFAULT 0,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_follow_up_reminders_unique
  ON follow_up_reminders(patient_exam_result_id, next_appointment_date, days_before);

CREATE INDEX IF NOT EXISTS idx_follow_up_reminders_status
  ON follow_up_reminders(status, next_appointment_date, days_before);
