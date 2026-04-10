const pool = require('../config/db');

const DEFAULT_TIME_ZONE = process.env.FOLLOW_UP_REMINDER_TIMEZONE || 'Asia/Ho_Chi_Minh';
const TELEGRAM_API_BASE = 'https://api.telegram.org';

function getDateKeyInTimeZone(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  const yyyy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(next.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: DEFAULT_TIME_ZONE,
  }).format(date);
}

function buildTelegramMessage(record, daysBefore) {
  const diagnosis = String(record.clinical_diagnosis || record.quick_medical_assessment || '').trim() || 'Không có ghi chú.';
  return [
    'AnVy Clinic',
    '',
    `Nhắc tái khám sau ${daysBefore} ngày`,
    `Bệnh nhân: ${record.full_name}`,
    `SĐT: ${record.phone}`,
    `Ngày khám gần nhất: ${formatDate(record.exam_date)}`,
    `Ngày tái khám: ${formatDate(record.next_appointment_date)}`,
    `Địa chỉ: ${record.address || '—'}`,
    `Ghi chú: ${diagnosis}`,
    `Mã kết quả: #${record.result_id}`,
  ].join('\n');
}

async function sendTelegramMessage(text) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    throw new Error('Thiếu TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID.');
  }

  const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(10000),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.description || `Telegram API lỗi với status ${response.status}.`);
  }

  return {
    chatId,
    payload,
  };
}

async function listUpcomingFollowUpRecords(daysBefore) {
  const today = getDateKeyInTimeZone();
  const targetDate = addDays(today, daysBefore);
  const { rows } = await pool.query(
    `SELECT
        r.id AS result_id,
        r.patient_profile_id,
        p.full_name,
        p.phone,
        p.address,
        r.exam_date,
        r.next_appointment_date,
        r.quick_medical_assessment,
        r.clinical_diagnosis
      FROM patient_exam_results r
      INNER JOIN patient_profiles p ON p.id = r.patient_profile_id
      LEFT JOIN follow_up_reminder_notifications n
        ON n.patient_exam_result_id = r.id
       AND n.next_appointment_date = r.next_appointment_date
       AND n.days_before = $2
      WHERE r.next_appointment_date = $1::date
        AND n.id IS NULL
      ORDER BY p.full_name ASC, r.exam_date DESC`,
    [targetDate, daysBefore]
  );

  return {
    today,
    targetDate,
    records: rows,
  };
}

async function markReminderSent({ resultId, nextAppointmentDate, daysBefore, chatId, payload }) {
  await pool.query(
    `INSERT INTO follow_up_reminder_notifications (
      patient_exam_result_id,
      next_appointment_date,
      days_before,
      telegram_chat_id,
      payload
    ) VALUES ($1, $2::date, $3, $4, $5)
    ON CONFLICT (patient_exam_result_id, next_appointment_date, days_before) DO NOTHING`,
    [resultId, nextAppointmentDate, daysBefore, chatId || null, payload ? JSON.stringify(payload) : null]
  );
}

async function runFollowUpReminderJob({ daysBefore, dryRun = false }) {
  const normalizedDaysBefore = Number.parseInt(String(daysBefore), 10);
  if (!Number.isInteger(normalizedDaysBefore) || normalizedDaysBefore < 0 || normalizedDaysBefore > 365) {
    throw new Error('days_before phải là số nguyên từ 0 đến 365.');
  }

  const { today, targetDate, records } = await listUpcomingFollowUpRecords(normalizedDaysBefore);
  const summary = {
    days_before: normalizedDaysBefore,
    today,
    target_date: targetDate,
    total_due: records.length,
    sent: 0,
    failed: 0,
    dry_run: Boolean(dryRun),
    results: [],
  };

  for (const record of records) {
    if (dryRun) {
      summary.results.push({
        result_id: record.result_id,
        full_name: record.full_name,
        phone: record.phone,
        next_appointment_date: String(record.next_appointment_date).slice(0, 10),
        status: 'dry_run',
      });
      continue;
    }

    try {
      const telegram = await sendTelegramMessage(buildTelegramMessage(record, normalizedDaysBefore));
      await markReminderSent({
        resultId: record.result_id,
        nextAppointmentDate: record.next_appointment_date,
        daysBefore: normalizedDaysBefore,
        chatId: telegram.chatId,
        payload: telegram.payload,
      });
      summary.sent += 1;
      summary.results.push({
        result_id: record.result_id,
        full_name: record.full_name,
        phone: record.phone,
        next_appointment_date: String(record.next_appointment_date).slice(0, 10),
        status: 'sent',
      });
    } catch (error) {
      summary.failed += 1;
      summary.results.push({
        result_id: record.result_id,
        full_name: record.full_name,
        phone: record.phone,
        next_appointment_date: String(record.next_appointment_date).slice(0, 10),
        status: 'failed',
        error: error.message,
      });
    }
  }

  return summary;
}

module.exports = {
  runFollowUpReminderJob,
};
