// Đọc/ghi tab "Lich Bang Custom" (BOT_CHAT_HISTORY_SPREADSHEET_ID) — các sự kiện Lịch Bang
// do admin tự tạo trên web (khác các sự kiện cố định Bang Chiến/GCMN/Thứ 5/Box trong config/schedule.js).
//
// Cấu trúc cột (dòng 1 là header, dòng 2 trở đi là data):
//   A = Id, B = Tên sự kiện, C = Thứ (0 = CN, 1 = T2 ... 6 = T7),
//   D = Giờ ("HH:mm", giờ VN), E = Lặp mỗi N tuần (1-4),
//   F = Ngày mốc (YYYY-MM-DD, giờ VN — 1 ngày diễn ra thật, các lần lặp tính từ đây)
//
// Chỉ lưu dữ liệu — cách tính "lần diễn ra kế tiếp" nằm ở voiceStats/schedule.js (nextCustom).
const { google } = require('./googleClient');
const { getGoogleAuthClient } = require('./auth');
const { customScheduleEvents } = require('../state');
const { BOT_CHAT_HISTORY_SPREADSHEET_ID, LICH_BANG_CUSTOM_SHEET_NAME } = require('../config');
const { parseScrimTime, parseVnWeekday, getVnNow, getDateKey } = require('../utils/time');

const HEADER_ROW = ['Id', 'Tên sự kiện', 'Thứ', 'Giờ', 'Lặp mỗi (tuần)', 'Ngày mốc'];
const DATA_RANGE = `'${LICH_BANG_CUSTOM_SHEET_NAME}'!A2:F`;
const MAX_NAME_LENGTH = 100;
const MAX_REPEAT_WEEKS = 4;

async function getSheetsClient() {
  const authClient = await getGoogleAuthClient();
  if (!authClient) throw new Error('Chưa cấu hình Google Sheets credentials cho bot.');
  return google.sheets({ version: 'v4', auth: authClient });
}

async function ensureSheetWithClient(sheets) {
  if (!BOT_CHAT_HISTORY_SPREADSHEET_ID) return;
  const meta = await sheets.spreadsheets.get({ spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID, fields: 'sheets.properties.title' });
  const exists = (meta.data.sheets || []).some((s) => s.properties.title === LICH_BANG_CUSTOM_SHEET_NAME);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID,
      resource: { requests: [{ addSheet: { properties: { title: LICH_BANG_CUSTOM_SHEET_NAME } } }] },
    });
  }
  const head = await sheets.spreadsheets.values
    .get({ spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID, range: `'${LICH_BANG_CUSTOM_SHEET_NAME}'!A1:F1` })
    .catch(() => ({ data: {} }));
  if (!((head.data && head.data.values) || []).length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID,
      range: `'${LICH_BANG_CUSTOM_SHEET_NAME}'!A1:F1`,
      valueInputOption: 'RAW',
      resource: { values: [HEADER_ROW] },
    });
  }
}

async function ensureLichBangSheetExists(authClient) {
  if (!authClient) return;
  await ensureSheetWithClient(google.sheets({ version: 'v4', auth: authClient }));
}

function rowToEvent(row) {
  const id = row[0];
  const name = String(row[1] || '').trim();
  const weekday = parseInt(row[2], 10);
  const time = parseScrimTime(String(row[3] || ''));
  const everyWeeks = parseInt(row[4], 10);
  const anchorDate = String(row[5] || '').trim();
  if (!id || !name || Number.isNaN(weekday) || weekday < 0 || weekday > 6 || !time) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) return null;
  return {
    id: String(id),
    name,
    weekday,
    time: `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`,
    everyWeeks: everyWeeks >= 1 && everyWeeks <= MAX_REPEAT_WEEKS ? everyWeeks : 1,
    anchorDate,
  };
}

// Nạp toàn bộ sự kiện tuỳ chỉnh vào state.customScheduleEvents. Gọi 1 lần lúc ClientReady.
async function loadCustomScheduleEvents() {
  try {
    const sheets = await getSheetsClient();
    await ensureSheetWithClient(sheets);
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID, range: DATA_RANGE });
    customScheduleEvents.length = 0;
    for (const row of response.data.values || []) {
      const ev = rowToEvent(row);
      if (ev) customScheduleEvents.push(ev);
    }
    console.log(`Đã nạp ${customScheduleEvents.length} sự kiện Lịch Bang tuỳ chỉnh từ tab "${LICH_BANG_CUSTOM_SHEET_NAME}".`);
  } catch (error) {
    console.error('Không thể nạp Lịch Bang tuỳ chỉnh từ Google Sheets:', error.message);
  }
  return customScheduleEvents;
}

// Ngày (YYYY-MM-DD, giờ VN) của lần diễn ra đầu tiên có đúng thứ `weekday`, tính từ hôm nay
// (nếu hôm nay đúng thứ nhưng giờ đã qua thì lấy tuần sau).
function firstOccurrenceDateKey(weekday, hour, minute) {
  const vnNow = getVnNow();
  for (let i = 0; i <= 7; i++) {
    const d = new Date(vnNow.getFullYear(), vnNow.getMonth(), vnNow.getDate() + i);
    if (d.getDay() !== weekday) continue;
    const passed = i === 0 && (vnNow.getHours() > hour || (vnNow.getHours() === hour && vnNow.getMinutes() >= minute));
    if (!passed) return getDateKey(d);
  }
  return getDateKey(vnNow);
}

// Thêm 1 sự kiện. Dùng cho POST /admin/lich/add.
// weekday: số 0-6 hoặc nhãn "Thứ 3"/"CN"; time: "HH:mm"; everyWeeks: 1-4;
// startDate (tuỳ chọn, YYYY-MM-DD): ngày diễn ra đầu tiên — phải đúng thứ đã chọn.
async function addCustomScheduleEvent({ name, weekday, time, everyWeeks, startDate }) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) throw new Error('Thiếu tên sự kiện.');
  if (trimmedName.length > MAX_NAME_LENGTH) throw new Error(`Tên sự kiện tối đa ${MAX_NAME_LENGTH} ký tự.`);

  let weekdayNum = typeof weekday === 'number' ? weekday : parseInt(weekday, 10);
  if (Number.isNaN(weekdayNum)) weekdayNum = parseVnWeekday(String(weekday || ''));
  if (weekdayNum === null || Number.isNaN(weekdayNum) || weekdayNum < 0 || weekdayNum > 6) {
    throw new Error('Thứ không hợp lệ — dùng số 0 (CN) đến 6 (Thứ 7).');
  }

  const parsedTime = parseScrimTime(String(time || '').trim());
  if (!parsedTime) throw new Error(`Giờ "${time}" không hợp lệ — dùng định dạng "HH:mm" (vd "20:30").`);
  const normalizedTime = `${String(parsedTime.hour).padStart(2, '0')}:${String(parsedTime.minute).padStart(2, '0')}`;

  const repeat = parseInt(everyWeeks, 10);
  if (Number.isNaN(repeat) || repeat < 1 || repeat > MAX_REPEAT_WEEKS) {
    throw new Error(`Lặp lại phải từ 1 đến ${MAX_REPEAT_WEEKS} tuần.`);
  }

  let anchorDate = String(startDate || '').trim();
  if (anchorDate) {
    const m = anchorDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) throw new Error('Ngày bắt đầu phải có dạng YYYY-MM-DD.');
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (d.getUTCMonth() !== +m[2] - 1) throw new Error('Ngày bắt đầu không tồn tại.');
    if (d.getUTCDay() !== weekdayNum) throw new Error('Ngày bắt đầu không đúng với thứ đã chọn.');
  } else {
    anchorDate = firstOccurrenceDateKey(weekdayNum, parsedTime.hour, parsedTime.minute);
  }

  const sheets = await getSheetsClient();
  await ensureSheetWithClient(sheets);
  const response = await sheets.spreadsheets.values.get({ spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID, range: DATA_RANGE });
  let maxId = 0;
  for (const row of response.data.values || []) {
    const n = parseInt(row[0], 10);
    if (!Number.isNaN(n) && n > maxId) maxId = n;
  }
  const newId = String(maxId + 1);

  await sheets.spreadsheets.values.append({
    spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID,
    range: `'${LICH_BANG_CUSTOM_SHEET_NAME}'!A:F`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    resource: { values: [[newId, trimmedName, weekdayNum, normalizedTime, repeat, anchorDate]] },
  });

  const entry = { id: newId, name: trimmedName, weekday: weekdayNum, time: normalizedTime, everyWeeks: repeat, anchorDate };
  customScheduleEvents.push(entry);
  return entry;
}

// Xoá 1 sự kiện theo Id. Dùng cho POST /admin/lich/remove.
async function removeCustomScheduleEvent(eventId) {
  const targetId = String(eventId || '').trim();
  if (!targetId) throw new Error('Thiếu id sự kiện.');

  const sheets = await getSheetsClient();
  await ensureSheetWithClient(sheets);
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID });
  const sheetMeta = (spreadsheet.data.sheets || []).find((s) => s.properties.title === LICH_BANG_CUSTOM_SHEET_NAME);
  const memIndex = customScheduleEvents.findIndex((e) => e.id === targetId);
  if (!sheetMeta) {
    if (memIndex !== -1) customScheduleEvents.splice(memIndex, 1);
    return false;
  }

  const response = await sheets.spreadsheets.values.get({ spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID, range: DATA_RANGE });
  const rowIndex = (response.data.values || []).findIndex((row) => String(row[0]) === targetId);
  if (rowIndex === -1) {
    if (memIndex !== -1) customScheduleEvents.splice(memIndex, 1);
    return false;
  }

  const sheetRowNumber = rowIndex + 2;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID,
    resource: {
      requests: [{
        deleteDimension: {
          range: { sheetId: sheetMeta.properties.sheetId, dimension: 'ROWS', startIndex: sheetRowNumber - 1, endIndex: sheetRowNumber },
        },
      }],
    },
  });
  const idx = customScheduleEvents.findIndex((e) => e.id === targetId);
  if (idx !== -1) customScheduleEvents.splice(idx, 1);
  return true;
}

module.exports = { ensureLichBangSheetExists, loadCustomScheduleEvents, addCustomScheduleEvent, removeCustomScheduleEvent };
