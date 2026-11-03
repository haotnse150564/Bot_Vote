// ===== googleSheets/pickRoleSheet.js — 2 tab: "Pick Role Bảng" (danh sách tin/bảng) + "Pick Role" (role trong từng bảng) =====
// Tab "Pick Role Bảng": 1 dòng / 1 bảng (1 tin trong kênh). Cột A = Mã bảng (a-z 0-9 _, vd prhd, boss), B = Tiêu đề,
//   C = Một role (TRUE = mỗi người chỉ giữ 1 role của bảng này), D = Người tạo, E = Thời gian tạo. Thứ tự dòng = thứ tự đăng tin.
// Tab "Pick Role": 1 dòng / 1 role. Cột A-F: A = Mã bảng (cột "Loại" cũ: prhd / prhp / mã tự đặt), B = Role ID, C = Mô tả, D = Icon (emoji unicode
// hoặc <:tên:id> / <a:tên:id>), E = Người thêm (Discord ID), F = Thời gian thêm (ISO). Sửa tay được,
// khởi động lại bot (hoặc thêm/xoá bằng lệnh) thì tin trong kênh tự cập nhật theo.
const { google } = require('./googleClient');
const { getGoogleAuthClient } = require('./auth');
const { BOT_CHAT_HISTORY_SPREADSHEET_ID, PICK_ROLE_SHEET_NAME, PICK_ROLE_BOARD_SHEET_NAME } = require('../config');
const { retryOnQuotaExceeded } = require('../utils/retry');

const HEADER = ['Mã bảng', 'Role ID', 'Mô tả', 'Icon', 'Người thêm', 'Thời gian thêm'];
const RANGE = `'${PICK_ROLE_SHEET_NAME}'!A2:F`;

async function getSheetsClient() {
  const auth = await getGoogleAuthClient();
  if (!auth) throw new Error('Chưa cấu hình Google Sheets credentials cho bot.');
  return google.sheets({ version: 'v4', auth });
}

const BOARD_HEADER = ['Mã bảng', 'Tiêu đề', 'Một role', 'Người tạo', 'Thời gian tạo'];
const BOARD_RANGE = `'${PICK_ROLE_BOARD_SHEET_NAME}'!A2:E`;

// Tạo tab (nếu chưa có) + vá header. Trả về true nếu tab VỪA được tạo mới.
async function ensureTab(sheets, title, header, lastCol) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID });
  const exists = (meta.data.sheets || []).some((s) => s.properties.title === title);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID,
      resource: { requests: [{ addSheet: { properties: { title } } }] },
    });
  }
  const head = await sheets.spreadsheets.values
    .get({ spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID, range: `'${title}'!A1:${lastCol}1` })
    .catch(() => ({ data: {} }));
  const current = (head.data.values && head.data.values[0]) || [];
  if (current.length < header.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID,
      range: `'${title}'!A1:${lastCol}1`,
      valueInputOption: 'RAW',
      resource: { values: [header] },
    });
  }
  return !exists;
}

// Trả về { boardsCreated } — true khi tab "Pick Role Bảng" mới được tạo lần đầu (để bot gieo sẵn 2 bảng prhp/prhd).
async function ensurePickRoleSheetExists() {
  if (!BOT_CHAT_HISTORY_SPREADSHEET_ID) return { boardsCreated: false };
  const sheets = await getSheetsClient();
  await ensureTab(sheets, PICK_ROLE_SHEET_NAME, HEADER, 'F');
  const boardsCreated = await ensureTab(sheets, PICK_ROLE_BOARD_SHEET_NAME, BOARD_HEADER, 'E');
  return { boardsCreated };
}

async function readBoardRows() {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID, range: BOARD_RANGE });
  return (res.data.values || [])
    .map((r) => ({
      code: String(r[0] || '').trim().toLowerCase(),
      title: String(r[1] || '').trim(),
      exclusive: String(r[2] || '').trim().toUpperCase() === 'TRUE',
      userId: String(r[3] || '').trim(),
      createdAt: String(r[4] || '').trim(),
    }))
    .filter((b) => b.code && b.title);
}

async function appendBoardRow(b) {
  const sheets = await getSheetsClient();
  await retryOnQuotaExceeded(
    () => sheets.spreadsheets.values.append({
      spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID,
      range: `'${PICK_ROLE_BOARD_SHEET_NAME}'!A:E`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      resource: { values: [[b.code, b.title, b.exclusive ? 'TRUE' : 'FALSE', b.userId || '', new Date().toISOString()]] },
    }),
    { label: 'Pick Role: thêm bảng' }
  );
}

// Ghi lại toàn bộ danh sách bảng (xoá/đổi tiêu đề) — bảng rất nhỏ nên ghi đè cả tab cho đơn giản.
async function rewriteBoardRows(boards) {
  const sheets = await getSheetsClient();
  await retryOnQuotaExceeded(async () => {
    await sheets.spreadsheets.values.clear({ spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID, range: BOARD_RANGE });
    if (boards.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID,
        range: `'${PICK_ROLE_BOARD_SHEET_NAME}'!A2:E${boards.length + 1}`,
        valueInputOption: 'RAW',
        resource: { values: boards.map((b) => [b.code, b.title, b.exclusive ? 'TRUE' : 'FALSE', b.userId || '', b.createdAt || '']) },
      });
    }
  }, { label: 'Pick Role: ghi lại bảng' });
}

// Xoá mọi role thuộc 1 bảng (khi xoá bảng).
async function deletePickRoleRowsOfBoard(code) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID, range: RANGE });
  const rows = res.data.values || [];
  const kept = rows.filter((r) => String(r[0] || '').trim().toLowerCase() !== code);
  if (kept.length === rows.length) return;
  await retryOnQuotaExceeded(async () => {
    await sheets.spreadsheets.values.clear({ spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID, range: RANGE });
    if (kept.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID,
        range: `'${PICK_ROLE_SHEET_NAME}'!A2:F${kept.length + 1}`,
        valueInputOption: 'RAW',
        resource: { values: kept },
      });
    }
  }, { label: 'Pick Role: xoá role của bảng' });
}

// Trả về [{ kind, roleId, desc, icon, userId, createdAt }] — bỏ qua dòng thiếu dữ liệu/loại lạ.
async function readPickRoleRows() {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID, range: RANGE });
  return (res.data.values || [])
    .map((r) => ({
      kind: String(r[0] || '').trim().toLowerCase(),
      roleId: String(r[1] || '').trim(),
      desc: String(r[2] || '').trim(),
      icon: String(r[3] || '').trim(),
      userId: String(r[4] || '').trim(),
      createdAt: String(r[5] || '').trim(),
    }))
    .filter((e) => e.kind && e.roleId && e.icon);
}

async function appendPickRoleRow(entry) {
  const sheets = await getSheetsClient();
  await retryOnQuotaExceeded(
    () => sheets.spreadsheets.values.append({
      spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID,
      range: `'${PICK_ROLE_SHEET_NAME}'!A:F`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      resource: { values: [[entry.kind, entry.roleId, entry.desc, entry.icon, entry.userId || '', new Date().toISOString()]] },
    }),
    { label: 'Pick Role: thêm dòng' }
  );
}

// Xoá 1 dòng theo (loại, role ID): đọc lại toàn bộ, lọc bỏ rồi ghi lại (bảng rất nhỏ, tối đa 40 dòng).
async function deletePickRoleRow(kind, roleId) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID, range: RANGE });
  const rows = res.data.values || [];
  const kept = rows.filter((r) => !(String(r[0] || '').trim().toLowerCase() === kind && String(r[1] || '').trim() === String(roleId)));
  if (kept.length === rows.length) return false;
  await retryOnQuotaExceeded(async () => {
    await sheets.spreadsheets.values.clear({ spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID, range: RANGE });
    if (kept.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID,
        range: `'${PICK_ROLE_SHEET_NAME}'!A2:F${kept.length + 1}`,
        valueInputOption: 'RAW',
        resource: { values: kept },
      });
    }
  }, { label: 'Pick Role: xoá dòng' });
  return true;
}

module.exports = {
  ensurePickRoleSheetExists, readPickRoleRows, appendPickRoleRow, deletePickRoleRow,
  readBoardRows, appendBoardRow, rewriteBoardRows, deletePickRoleRowsOfBoard,
};
