const CLINIC_TIME_ZONE = 'Asia/Ho_Chi_Minh';

const weekdayMap = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function normalizeTimeValue(value) {
  if (!value) return null;
  return String(value).slice(0, 5);
}

function normalizeAvailabilityRow(row) {
  return {
    weekday: row.weekday,
    label: row.label,
    enabled: row.enabled,
    start_time: normalizeTimeValue(row.start_time),
    end_time: normalizeTimeValue(row.end_time),
  };
}

function timeToMinutes(value) {
  if (!value) return null;
  const [hours, minutes] = normalizeTimeValue(value).split(':').map(Number);
  return hours * 60 + minutes;
}

function getClinicDateParts(input) {
  const date = new Date(input);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: CLINIC_TIME_ZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') {
      acc[part.type] = part.value;
    }
    return acc;
  }, {});

  return {
    weekday: weekdayMap[parts.weekday],
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function isAppointmentWithinAvailability(appointmentTime, setting) {
  if (!setting || !setting.enabled) return false;

  const clinicParts = getClinicDateParts(appointmentTime);
  const startMinutes = timeToMinutes(setting.start_time);
  const endMinutes = timeToMinutes(setting.end_time);

  if (clinicParts.weekday !== setting.weekday || startMinutes === null || endMinutes === null) {
    return false;
  }

  return clinicParts.minutes >= startMinutes && clinicParts.minutes <= endMinutes;
}

function getAvailabilityOrder(weekday) {
  return weekday === 0 ? 7 : weekday;
}

module.exports = {
  CLINIC_TIME_ZONE,
  getAvailabilityOrder,
  isAppointmentWithinAvailability,
  normalizeAvailabilityRow,
  normalizeTimeValue,
  timeToMinutes,
};
