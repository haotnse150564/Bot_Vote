// ===== BcStat sheet: khởi tạo tab =====
// Tạo các tab (RawLog/Summary/Cumulative/Alias/Record/Cycle) + header nếu chưa có.

const {
  BCSTAT_SPREADSHEET_ID,
  BCSTAT_RAWLOG_SHEET_NAME,
  BCSTAT_SUMMARY_SHEET_NAME,
  BCSTAT_CUMULATIVE_SHEET_NAME,
  BCSTAT_ALIAS_SHEET_NAME,
  BCSTAT_RECORD_SHEET_NAME,
  BCSTAT_CYCLE_SHEET_NAME,
} = require('../config');
const {
  RAWLOG_HEADER,
  CUMULATIVE_HEADER,
  ALIAS_HEADER,
  RECORD_HEADER,
  SUMMARY_HEADER,
  CYCLE_HEADER,
  getSheetsClient,
} = require('./bcStatShared');
const { seedRecordsFromCumulative } = require('./bcStatRecords');

async function sheetExists(sheets, title) {
  const response = await sheets.spreadsheets.get({ spreadsheetId: BCSTAT_SPREADSHEET_ID });
  return (response.data.sheets || []).some((s) => s.properties.title === title);
}

async function addSheetWithHeader(sheets, title, header) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: BCSTAT_SPREADSHEET_ID,
    resource: { requests: [{ addSheet: { properties: { title } } }] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: BCSTAT_SPREADSHEET_ID,
    range: `'${title}'!A1`,
    valueInputOption: 'RAW',
    resource: { values: [header] },
  });
}

// Gọi 1 lần lúc ClientReady — tạo các tab MỚI (RawLog + Summary + Cumulative
// + Alias) nếu chưa có. Không đụng gì nếu đã tồn tại (an toàn để gọi lại mỗi
// lần deploy).
async function ensureBcStatSheetsExist() {
  if (!BCSTAT_SPREADSHEET_ID) return;
  const sheets = await getSheetsClient();

  if (!(await sheetExists(sheets, BCSTAT_RAWLOG_SHEET_NAME))) {
    await addSheetWithHeader(sheets, BCSTAT_RAWLOG_SHEET_NAME, RAWLOG_HEADER);
  }
  if (!(await sheetExists(sheets, BCSTAT_SUMMARY_SHEET_NAME))) {
    await addSheetWithHeader(sheets, BCSTAT_SUMMARY_SHEET_NAME, SUMMARY_HEADER);
  }
  if (!(await sheetExists(sheets, BCSTAT_CUMULATIVE_SHEET_NAME))) {
    await addSheetWithHeader(sheets, BCSTAT_CUMULATIVE_SHEET_NAME, CUMULATIVE_HEADER);
  }
  if (!(await sheetExists(sheets, BCSTAT_ALIAS_SHEET_NAME))) {
    await addSheetWithHeader(sheets, BCSTAT_ALIAS_SHEET_NAME, ALIAS_HEADER);
  }
  if (!(await sheetExists(sheets, BCSTAT_RECORD_SHEET_NAME))) {
    await addSheetWithHeader(sheets, BCSTAT_RECORD_SHEET_NAME, RECORD_HEADER);
    // Lần đầu nâng cấp lên hệ thống Record tách riêng — khởi tạo dữ liệu
    // Kỷ lục từ Cumulative hiện có (nếu có), để không bị "mất" Kỷ lục cũ đã
    // từng hiển thị ở Summary trước khi có tab này.
    try {
      await seedRecordsFromCumulative(sheets);
    } catch (error) {
      console.error('Lỗi khi khởi tạo BC Stat - Kỷ Lục từ Cumulative:', error.message);
    }
  }
  if (!(await sheetExists(sheets, BCSTAT_CYCLE_SHEET_NAME))) {
    // Chỉ 1 dòng dữ liệu: số thứ tự chu kỳ SẮP TỚI (bắt đầu từ 1) — xem
    // getNextCycleNumber()/bumpCycleNumber() bên dưới.
    await addSheetWithHeader(sheets, BCSTAT_CYCLE_SHEET_NAME, CYCLE_HEADER);
    await sheets.spreadsheets.values.update({
      spreadsheetId: BCSTAT_SPREADSHEET_ID,
      range: `'${BCSTAT_CYCLE_SHEET_NAME}'!A2`,
      valueInputOption: 'RAW',
      resource: { values: [[1]] },
    });
  }
}

module.exports = {
  ensureBcStatSheetsExist,
};
