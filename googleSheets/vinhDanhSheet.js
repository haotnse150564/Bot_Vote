// Đọc/ghi 2 tab cho tính năng "Sảnh Vinh Danh Bang Chiến":
//   - VINHDANH_SHEET_NAME ("Vinh Danh Bang Chiến"): LỊCH SỬ đầy đủ, mỗi lần
//     NPC gửi ảnh cập nhật thì APPEND thêm 1 lô dòng mới (KHÔNG xoá dòng cũ
//     — giữ nguyên lịch sử để tra cứu lại các tuần trước nếu cần).
//     Cột: A=Ngày Vinh Danh (DD/MM/YYYY, Thứ 7 của tuần đó) | B=Danh Hiệu |
//          C=Ingame | D=Discord ID | E=Trận (1 hoặc 2) | F=Batch (ISO
//          timestamp — TẤT CẢ dòng ghi CÙNG 1 LẦN xử lý ảnh có CÙNG giá trị
//          Batch, dùng để nhóm lại & tìm "lô mới nhất" mà không cần đụng gì
//          tới cột A, vì tuần có 2 trận thì cả 2 trận vẫn cùng 1 Ngày Vinh
//          Danh nhưng có thể được gửi ảnh ở 2 THỜI ĐIỂM xử lý khác nhau
//          nếu NPC lỡ tách ra gửi riêng, xem vinhDanh/index.js).
//   - VINHDANH_CONFIG_SHEET_NAME ("Vinh Danh Config"): Key | Value — lưu
//     board_message_id (tin cố định "Sảnh Vinh Danh" bot edit lại mỗi lần
//     cập nhật), giống hệt tinh thần Config Mùa Giải của Thí Kiếm.
const { google } = require('./googleClient');
const { getGoogleAuthClient } = require('./auth');
const { VINHDANH_SPREADSHEET_ID, VINHDANH_SHEET_NAME, VINHDANH_CONFIG_SHEET_NAME } = require('../config');

const HISTORY_HEADER = ['Ngày Vinh Danh', 'Danh Hiệu', 'Ingame', 'Discord ID', 'Trận', 'Batch'];

const DEFAULT_CONFIG_ROWS = [
  ['board_message_id', ''],
  ['kenh_id', ''],
  // Danh sách Discord ID (cách nhau bằng dấu phẩy) đang giữ danh hiệu "Quần
  // Long Chi Chủ" (danh hiệu CAO NHẤT) — dùng để đồng bộ role
  // QUAN_LONG_CHI_CHU_ROLE_ID mỗi lần có ảnh cập nhật mới, xem
  // vinhDanh/index.js -> syncQuanLongChiChuRole().
  ['quan_long_chi_chu_holder_ids', ''],
];

async function getSheetsClient() {
  const auth = await getGoogleAuthClient();
  if (!auth) throw new Error('Chưa cấu hình Google Sheets credentials cho bot.');
  return google.sheets({ version: 'v4', auth });
}

async function sheetExists(sheets, title) {
  const response = await sheets.spreadsheets.get({ spreadsheetId: VINHDANH_SPREADSHEET_ID });
  return (response.data.sheets || []).some((s) => s.properties.title === title);
}

async function addSheetWithHeader(sheets, title, header) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: VINHDANH_SPREADSHEET_ID,
    resource: { requests: [{ addSheet: { properties: { title } } }] },
  });
  if (header && header.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: VINHDANH_SPREADSHEET_ID,
      range: `'${title}'!A1`,
      valueInputOption: 'RAW',
      resource: { values: [header] },
    });
  }
}

// Gọi 1 lần lúc ClientReady — tự tạo 2 tab nếu chưa có (bot tự thêm, đúng
// yêu cầu ban đầu), KHÔNG đụng gì nếu đã tồn tại sẵn từ trước.
async function ensureVinhDanhSheetsExist() {
  if (!VINHDANH_SPREADSHEET_ID) return;

  const sheets = await getSheetsClient();

  if (!(await sheetExists(sheets, VINHDANH_SHEET_NAME))) {
    await addSheetWithHeader(sheets, VINHDANH_SHEET_NAME, HISTORY_HEADER);
  }

  if (!(await sheetExists(sheets, VINHDANH_CONFIG_SHEET_NAME))) {
    await addSheetWithHeader(sheets, VINHDANH_CONFIG_SHEET_NAME, null);
    await sheets.spreadsheets.values.update({
      spreadsheetId: VINHDANH_SPREADSHEET_ID,
      range: `'${VINHDANH_CONFIG_SHEET_NAME}'!A1`,
      valueInputOption: 'RAW',
      resource: { values: DEFAULT_CONFIG_ROWS },
    });
  }
}

// --- Vinh Danh Config (Key | Value) ---

async function getVinhDanhConfig() {
  const sheets = await getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: VINHDANH_SPREADSHEET_ID,
    range: `'${VINHDANH_CONFIG_SHEET_NAME}'!A:B`,
  });
  const rows = response.data.values || [];
  const config = {};
  rows.forEach(([key, value]) => {
    if (key) config[String(key).trim()] = value !== undefined ? String(value).trim() : '';
  });
  return config;
}

async function setVinhDanhConfigValues(updates) {
  const sheets = await getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: VINHDANH_SPREADSHEET_ID,
    range: `'${VINHDANH_CONFIG_SHEET_NAME}'!A:B`,
  });
  const rows = response.data.values || [];
  const keyToRowIndex = {};
  rows.forEach((row, idx) => {
    if (row[0]) keyToRowIndex[String(row[0]).trim()] = idx;
  });

  const dataUpdates = [];
  const appendRows = [];

  Object.entries(updates).forEach(([key, value]) => {
    if (Object.prototype.hasOwnProperty.call(keyToRowIndex, key)) {
      const rowNumber = keyToRowIndex[key] + 1;
      dataUpdates.push({ range: `'${VINHDANH_CONFIG_SHEET_NAME}'!B${rowNumber}`, values: [[value]] });
    } else {
      appendRows.push([key, value]);
    }
  });

  if (dataUpdates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: VINHDANH_SPREADSHEET_ID,
      resource: { valueInputOption: 'RAW', data: dataUpdates },
    });
  }
  if (appendRows.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: VINHDANH_SPREADSHEET_ID,
      range: `'${VINHDANH_CONFIG_SHEET_NAME}'!A:B`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      resource: { values: appendRows },
    });
  }
}

// --- Lịch sử Vinh Danh ---

// entries: [{ danhHieu, ingame, discordId, tran }] — ghi TẤT CẢ cùng 1 lô,
// dùng CHUNG 1 giá trị batch (ISO timestamp lúc gọi hàm) cho mọi dòng, để
// getLatestBatchEntries() bên dưới nhóm lại đúng lô mới nhất. Trả về batch
// vừa dùng (để nơi gọi hiển thị lại nếu cần).
async function appendVinhDanhBatch(ngayVinhDanh, entries) {
  if (!entries || !entries.length) return null;
  const sheets = await getSheetsClient();
  const batch = new Date().toISOString();

  const values = entries.map((e) => [
    ngayVinhDanh || '',
    e.danhHieu || '',
    e.ingame || '',
    e.discordId || '',
    e.tran || '',
    batch,
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId: VINHDANH_SPREADSHEET_ID,
    range: `'${VINHDANH_SHEET_NAME}'!A:F`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    resource: { values },
  });

  return batch;
}

// Đọc TOÀN BỘ lịch sử (KHÔNG lọc), dùng cho getLatestBatchEntries() bên
// dưới lẫn cho việc tra cứu thủ công trực tiếp trên sheet.
async function getAllVinhDanhRows() {
  const sheets = await getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: VINHDANH_SPREADSHEET_ID,
    range: `'${VINHDANH_SHEET_NAME}'!A2:F`,
  });
  const rows = response.data.values || [];
  return rows
    .map((r) => ({
      ngayVinhDanh: (r[0] || '').trim(),
      danhHieu: (r[1] || '').trim(),
      ingame: (r[2] || '').trim(),
      discordId: (r[3] || '').trim(),
      tran: (r[4] || '').trim(),
      batch: (r[5] || '').trim(),
    }))
    .filter((r) => r.danhHieu);
}

// Trả về { ngayVinhDanh, entries } của LÔ MỚI NHẤT (batch có timestamp lớn
// nhất) — dùng để build lại embed "Sảnh Vinh Danh" (ensureVinhDanhMessagesPosted
// / refreshVinhDanhBoard trong vinhDanh/index.js). Trả về null nếu sheet
// chưa có dữ liệu nào.
async function getLatestBatchEntries() {
  const rows = await getAllVinhDanhRows();
  if (!rows.length) return null;

  const latestBatch = rows.reduce((max, r) => (r.batch > max ? r.batch : max), rows[0].batch);
  const entries = rows.filter((r) => r.batch === latestBatch);
  const ngayVinhDanh = entries[0]?.ngayVinhDanh || '';
  return { ngayVinhDanh, entries };
}

module.exports = {
  ensureVinhDanhSheetsExist,
  getVinhDanhConfig,
  setVinhDanhConfigValues,
  appendVinhDanhBatch,
  getAllVinhDanhRows,
  getLatestBatchEntries,
};
