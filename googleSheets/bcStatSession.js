// ===== BcStat sheet: ghi 1 phiên =====
// appendSessionRows: áp alias, ghi RawLog rồi cập nhật Cumulative + Record.

const { BCSTAT_SPREADSHEET_ID, BCSTAT_RAWLOG_SHEET_NAME } = require('../config');
const { assertValidMatchLabel } = require('./bcStatMatchLabel');
const { CATEGORIES, getSheetsClient } = require('./bcStatShared');
const { resolveAliases } = require('./bcStatAlias');
const { updateCumulative } = require('./bcStatCumulative');
const { updateRecords } = require('./bcStatRecords');

// combined: Map(normalizedName -> { displayName, values: { catKey: number } })
// matchLabel: nhãn "Tên đối thủ - dd/mm/yy" đã validate (validateMatchInput)
// — NGƯỜI DÙNG BẮT BUỘC nhập khi bấm "Hoàn tất & Lưu" (Discord) hoặc lưu
// (web). renameFromLabel: chỉ truyền khi dùng nút "✏️ Sửa trận đã lưu" và
// NPC đã đổi lại nhãn (đối thủ/ngày) trong form — đổi tên trận cũ sang nhãn
// mới cho MỌI người đã có mặt ở trận đó (xem updateCumulative).
// Ghi 1 dòng MỚI cho MỖI người trong combined vào RawLog (log thô, luôn
// APPEND — không ghi đè, kể cả khi lưu lại đúng trận cũ để sửa) — cột hạng
// mục không thu thập được trong phiên này để trống (không phải 0, để
// Summary không tính oan người đó là 0 ở hạng mục chưa thu thập).
async function appendSessionRows(sessionLabel, combinedRaw, matchLabel, renameFromLabel) {
  if (!combinedRaw || !combinedRaw.size) return 0;
  const label = assertValidMatchLabel(matchLabel);
  const sheets = await getSheetsClient();

  // Áp dụng alias đã xác nhận trước đó (mục "tự gộp thông tin bot đã nói"
  // trong yêu cầu người dùng) NGAY TỪ ĐÂY — để cả RawLog lẫn Cumulative đều
  // ghi nhận đúng tên chuẩn, không cần gộp tay lại lần nữa cho đúng tên gõ
  // sai y hệt về sau.
  const combined = await resolveAliases(combinedRaw);

  const rows = [...combined.values()].map((entry) => {
    const valueCells = CATEGORIES.map((cat) => {
      const v = entry.values[cat.key];
      return v === undefined || v === null || Number.isNaN(v) ? '' : v;
    });
    return [`${sessionLabel} — ${label}`, entry.displayName, ...valueCells];
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: BCSTAT_SPREADSHEET_ID,
    range: `'${BCSTAT_RAWLOG_SHEET_NAME}'!A:K`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    resource: { values: rows },
  });

  // Cập nhật NGAY vào Cumulative tại đúng thời điểm ghi phiên — quan trọng
  // để dữ liệu KHÔNG phụ thuộc việc RawLog còn giữ được bao nhiêu dòng về
  // sau (xem ghi chú đầu file). Cố ý không throw nếu bước này lỗi (log lại,
  // dữ liệu RawLog vẫn đã ghi thành công) — tránh làm hỏng cả luồng /bcstat
  // chỉ vì lỗi phụ ở bước này.
  try {
    await updateCumulative(combined, label, renameFromLabel);
  } catch (error) {
    console.error('Lỗi khi cập nhật BC Stat Cumulative (RawLog vẫn đã ghi OK):', error.message);
  }

  // Cập nhật Kỷ lục (tách riêng khỏi Cumulative — xem ghi chú đầu file) NGAY
  // tại đây, độc lập với bước Cumulative ở trên (không throw nếu lỗi, tương
  // tự lý do ở trên).
  try {
    await updateRecords(combined, label, renameFromLabel);
  } catch (error) {
    console.error('Lỗi khi cập nhật BC Stat - Kỷ Lục (RawLog/Cumulative vẫn đã ghi OK):', error.message);
  }

  return rows.length;
}

module.exports = {
  appendSessionRows,
};
