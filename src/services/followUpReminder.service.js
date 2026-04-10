const crypto = require('crypto');
const pool = require('../config/db');

const DEFAULT_TIME_ZONE = process.env.FOLLOW_UP_REMINDER_TIMEZONE || 'Asia/Ho_Chi_Minh';
const TELEGRAM_API_BASE = 'https://api.telegram.org';
const RESEND_INTERVAL_HOURS = Math.max(1, Number.parseInt(process.env.FOLLOW_UP_REMINDER_RESEND_HOURS || '1', 10) || 1);

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
    `Nhắc tái khám trong vòng ${daysBefore} ngày`,
    `Bệnh nhân: ${record.full_name}`,
    `SĐT: ${record.phone}`,
    `Ngày khám gần nhất: ${formatDate(record.exam_date)}`,
    `Ngày tái khám: ${formatDate(record.next_appointment_date)}`,
    `Địa chỉ: ${record.address || '—'}`,
    `Ghi chú: ${diagnosis}`,
    `Mã kết quả: #${record.result_id}`,
    '',
    'Bấm "Da xem" để ngung nhac cho ket qua nay.',
  ].join('\n');
}

function buildAckCallbackData(reminder) {
  return `followup_ack:${reminder.id}:${reminder.ack_token}`;
}

function getTelegramConfig() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    throw new Error('Thiếu TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID.');
  }
  return { botToken, chatId };
}

async function callTelegram(method, body) {
  const { botToken } = getTelegramConfig();
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.description || `Telegram API lỗi với status ${response.status}.`);
  }
  return payload.result;
}

async function sendReminderTelegramMessage(record, reminder, daysBefore) {
  const { chatId } = getTelegramConfig();
  const result = await callTelegram('sendMessage', {
    chat_id: chatId,
    text: buildTelegramMessage(record, daysBefore),
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [[{ text: 'Da xem, dung nhac', callback_data: buildAckCallbackData(reminder) }]],
    },
  });
  return {
    chatId,
    messageId: result.message_id,
    payload: result,
  };
}

async function answerCallbackQuery(callbackQueryId, text) {
  if (!callbackQueryId) return;
  await callTelegram('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
    show_alert: false,
  });
}

async function clearInlineKeyboard(chatId, messageId) {
  if (!chatId || !messageId) return;
  await callTelegram('editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: {
      inline_keyboard: [],
    },
  });
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
        r.clinical_diagnosis,
        fr.id AS reminder_id,
        fr.status AS reminder_status,
        fr.ack_token,
        fr.telegram_chat_id AS reminder_chat_id,
        fr.telegram_message_id AS reminder_message_id,
        fr.last_notified_at,
        fr.notification_count
      FROM patient_exam_results r
      INNER JOIN patient_profiles p ON p.id = r.patient_profile_id
      LEFT JOIN follow_up_reminders fr
        ON fr.patient_exam_result_id = r.id
       AND fr.next_appointment_date = r.next_appointment_date
       AND fr.days_before = $3
      WHERE r.next_appointment_date IS NOT NULL
        AND r.next_appointment_date >= $1::date
        AND r.next_appointment_date <= $2::date
      ORDER BY r.next_appointment_date ASC, p.full_name ASC`,
    [today, targetDate, daysBefore]
  );

  return {
    today,
    targetDate,
    records: rows,
  };
}

async function ensureReminderRecord(record, daysBefore) {
  const ackToken = record.ack_token || crypto.randomBytes(18).toString('hex');
  const { rows } = await pool.query(
    `INSERT INTO follow_up_reminders (
      patient_exam_result_id,
      next_appointment_date,
      days_before,
      status,
      ack_token
    ) VALUES ($1, $2::date, $3, 'pending', $4)
    ON CONFLICT ON CONSTRAINT follow_up_reminders_result_date_days_unique
    DO UPDATE SET
      updated_at = NOW()
    RETURNING *`,
    [record.result_id, record.next_appointment_date, daysBefore, ackToken]
  );
  return rows[0];
}

async function markReminderSent(reminderId, telegramResult) {
  await pool.query(
    `UPDATE follow_up_reminders
      SET telegram_chat_id = $2,
          telegram_message_id = $3,
          first_notified_at = COALESCE(first_notified_at, NOW()),
          last_notified_at = NOW(),
          notification_count = notification_count + 1,
          last_error = NULL,
          status = CASE WHEN status = 'expired' THEN 'expired' ELSE 'pending' END,
          updated_at = NOW()
    WHERE id = $1`,
    [reminderId, telegramResult.chatId, telegramResult.messageId]
  );
}

async function markReminderFailed(reminderId, errorMessage) {
  await pool.query(
    `UPDATE follow_up_reminders
      SET last_error = $2,
          updated_at = NOW()
    WHERE id = $1`,
    [reminderId, errorMessage]
  );
}

async function expireOldReminders(today) {
  await pool.query(
    `UPDATE follow_up_reminders
      SET status = 'expired',
          updated_at = NOW()
    WHERE status = 'pending'
      AND next_appointment_date < $1::date`,
    [today]
  );
}

function shouldSendReminder(record) {
  if (!record.reminder_id) return true;
  if (record.reminder_status === 'acknowledged' || record.reminder_status === 'expired') return false;
  if (!record.last_notified_at) return true;
  const lastNotified = new Date(record.last_notified_at);
  const diffMs = Date.now() - lastNotified.getTime();
  return diffMs >= RESEND_INTERVAL_HOURS * 60 * 60 * 1000;
}

async function runFollowUpReminderJob({ daysBefore, dryRun = false }) {
  const normalizedDaysBefore = Number.parseInt(String(daysBefore), 10);
  if (!Number.isInteger(normalizedDaysBefore) || normalizedDaysBefore < 0 || normalizedDaysBefore > 365) {
    throw new Error('days_before phải là số nguyên từ 0 đến 365.');
  }

  const { today, targetDate, records } = await listUpcomingFollowUpRecords(normalizedDaysBefore);
  await expireOldReminders(today);

  const summary = {
    days_before: normalizedDaysBefore,
    today,
    target_date: targetDate,
    resend_interval_hours: RESEND_INTERVAL_HOURS,
    total_due: records.length,
    sent: 0,
    failed: 0,
    acknowledged: 0,
    skipped: 0,
    dry_run: Boolean(dryRun),
    results: [],
  };

  for (const record of records) {
    if (record.reminder_status === 'acknowledged') {
      summary.acknowledged += 1;
      summary.results.push({
        result_id: record.result_id,
        full_name: record.full_name,
        phone: record.phone,
        next_appointment_date: String(record.next_appointment_date).slice(0, 10),
        status: 'acknowledged',
      });
      continue;
    }

    if (!shouldSendReminder(record)) {
      summary.skipped += 1;
      summary.results.push({
        result_id: record.result_id,
        full_name: record.full_name,
        phone: record.phone,
        next_appointment_date: String(record.next_appointment_date).slice(0, 10),
        status: 'skipped_recently_sent',
      });
      continue;
    }

    const reminder = dryRun
      ? { id: record.reminder_id || null, ack_token: record.ack_token || null }
      : await ensureReminderRecord(record, normalizedDaysBefore);

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
      const telegram = await sendReminderTelegramMessage(record, reminder, normalizedDaysBefore);
      await markReminderSent(reminder.id, telegram);
      summary.sent += 1;
      summary.results.push({
        result_id: record.result_id,
        reminder_id: reminder.id,
        full_name: record.full_name,
        phone: record.phone,
        next_appointment_date: String(record.next_appointment_date).slice(0, 10),
        status: 'sent',
      });
    } catch (error) {
      summary.failed += 1;
      if (reminder.id) {
        await markReminderFailed(reminder.id, error.message);
      }
      summary.results.push({
        result_id: record.result_id,
        reminder_id: reminder.id,
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

async function acknowledgeReminder({ reminderId, ackToken, actor }) {
  const { rows } = await pool.query(
    `UPDATE follow_up_reminders
      SET status = 'acknowledged',
          acknowledged_at = NOW(),
          acknowledged_by = $3,
          updated_at = NOW()
    WHERE id = $1
      AND ack_token = $2
    RETURNING *`,
    [reminderId, ackToken, actor]
  );
  return rows[0] || null;
}

async function getReminderById(reminderId) {
  const { rows } = await pool.query(
    `SELECT * FROM follow_up_reminders WHERE id = $1`,
    [reminderId]
  );
  return rows[0] || null;
}

module.exports = {
  runFollowUpReminderJob,
  acknowledgeReminder,
  answerCallbackQuery,
  clearInlineKeyboard,
  getReminderById,
};
