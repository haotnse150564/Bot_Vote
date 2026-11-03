const { GCMN_REFERENCE_DATE_UTC } = require('../config');

function getFormattedDateTime() {
  const now = new Date();
  const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
  const utcPlus7 = new Date(utcTime + (7 * 60 * 60 * 1000));

  const hours = String(utcPlus7.getHours()).padStart(2, '0');
  const minutes = String(utcPlus7.getMinutes()).padStart(2, '0');
  const seconds = String(utcPlus7.getSeconds()).padStart(2, '0');
  const day = String(utcPlus7.getDate()).padStart(2, '0');
  const month = String(utcPlus7.getMonth() + 1).padStart(2, '0');
  const year = utcPlus7.getFullYear();
  return `${hours}:${minutes}:${seconds}, ngày ${day}/${month}/${year}`;
}

function getVnNow() {
  const now = new Date();
  const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utcTime + (7 * 60 * 60 * 1000));
}

function getDateKey(vnDate) {
  const y = vnDate.getFullYear();
  const m = String(vnDate.getMonth() + 1).padStart(2, '0');
  const d = String(vnDate.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isGcmnOpeningWeek(vnDate) {
  const dateOnlyUtc = Date.UTC(vnDate.getFullYear(), vnDate.getMonth(), vnDate.getDate());
  const diffDays = Math.round((dateOnlyUtc - GCMN_REFERENCE_DATE_UTC) / (24 * 60 * 60 * 1000));
  const diffWeeks = diffDays / 7;
  const mod = ((diffWeeks % 2) + 2) % 2;
  return mod === 0;
}

// Trả về mốc giờ:phút cần gửi nhắc, cách "hour:minute" gốc minutesBefore phút.
function getReminderMark(hour, minute, minutesBefore) {
  let markMinute = minute - minutesBefore;
  let markHour = hour;

  while (markMinute < 0) {
    markMinute += 60;
    markHour -= 1;
  }

  if (markHour < 0) {
    markHour += 24;
  }

  return { hour: markHour, minute: markMinute };
}

// Extracts the digit N from a "Thứ N" style label (e.g. "Thứ 4" -> 4). Returns
// null if the label isn't in a "Thứ <digit>" format we can parse.
function extractVnThuNumber(label) {
  if (!label) return null;
  const match = label.trim().toLowerCase().match(/thứ\s*(\d)/);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  return Number.isNaN(num) ? null : num;
}

// For filtering which day-vote emojis (4️⃣/5️⃣/6️⃣) to show — only Thứ 4/5/6 are valid scrim days.
function parseScrimDayNumber(label) {
  const num = extractVnThuNumber(label);
  return [4, 5, 6].includes(num) ? num : null;
}

// For matching JS Date.getDay() (0=Chủ Nhật...6=Thứ 7) — used for reminder scheduling.
function parseVnWeekday(label) {
  if (!label) return null;
  const normalized = label.trim().toLowerCase();
  if (normalized.includes('chủ nhật') || normalized === 'cn') return 0;
  const num = extractVnThuNumber(label);
  if (num !== null && num >= 2 && num <= 7) return num - 1;
  return null;
}

// Parses a time string like "19:00" / "19h00" / "19h" into { hour, minute }.
function parseScrimTime(timeStr) {
  if (!timeStr) return null;
  const match = timeStr.trim().match(/^(\d{1,2})[:h](\d{2})?/i);
  if (!match) return null;
  const hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  if (Number.isNaN(hour) || hour > 23 || minute > 59) return null;
  return { hour, minute };
}

// Parses a "ngày/tháng" style date label like "5/9", "05/09", "5-9", "5.9",
// "ngày 5/9", "5/9/2026" into { day, month }. Returns null if the label is
// empty or doesn't contain a recognizable day/month pattern (e.g. "Đang tìm").
function parseVnDayMonth(label) {
  if (!label) return null;
  const match = label.trim().match(/(\d{1,2})\s*[\/\-.]\s*(\d{1,2})/);
  if (!match) return null;
  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  if (Number.isNaN(day) || Number.isNaN(month) || day < 1 || day > 31 || month < 1 || month > 12) {
    return null;
  }
  return { day, month };
}

module.exports = {
  getFormattedDateTime,
  getVnNow,
  getDateKey,
  isGcmnOpeningWeek,
  getReminderMark,
  extractVnThuNumber,
  parseScrimDayNumber,
  parseVnWeekday,
  parseScrimTime,
  parseVnDayMonth,
};
