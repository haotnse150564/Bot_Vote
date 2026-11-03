// Đọc tab "Nhật Ký Đội Hình" trong Google Sheet RIÊNG (TEAM_LOG_SPREADSHEET_ID)
// — do trang web NMTeam ghi trực tiếp mỗi lần NPC bấm "Đăng ảnh"/"Cập nhật
// ảnh" — để phục vụ /wherebc /wherescrim1 /wherescrim2. ĐỔI (theo yêu cầu):
// TRƯỚC ĐÂY đọc tab "List BC/Scrim" nằm chung SRC_IMAGE_SPREADSHEET_ID
// (sheet dùng để chụp ảnh Scrim 1/2/Bang Chiến ở screenshotSheet.js).
//
// Cấu trúc cột — xem chú thích chi tiết ở config.js (TEAM_LOG_SPREADSHEET_ID,
// TEAM_LOG_TAB_NAME, WHERE_LOCATION_COLUMNS): cột A là Discord ID, B là
// Ingame, C là Class, các cột D..L còn lại là Vị Trí/Phân Công/Ghi Chú của
// Bang Chiến/Scrim 1/Scrim 2. Hàng 1 chỉ là tiêu đề (xem
// lib/teamLogSheet.js bên repo NMTeam) nên không đọc theo số hàng cố định —
// chỉ cần cột A khớp đúng Discord ID là lấy được cả hàng.

const { google } = require('./googleClient');
const { getGoogleAuthClient } = require('./auth');
const { TEAM_LOG_SPREADSHEET_ID, TEAM_LOG_TAB_NAME, WHERE_LOCATION_COLUMNS } = require('../config');

// Map chữ cái cột (A, B, C, ...) -> index trong mảng row trả về từ Sheets API.
const COLUMN_INDEX = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, I: 8, J: 9, K: 10, L: 11 };

async function fetchListSheetRows() {
  const auth = await getGoogleAuthClient();
  if (!auth) {
    throw new Error('Chưa cấu hình Google Sheets credentials cho bot.');
  }

  const sheets = google.sheets({ version: 'v4', auth });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: TEAM_LOG_SPREADSHEET_ID,
    // A1:L1000 — đủ rộng cho toàn bộ danh sách hiện tại, không cần biết
    // trước số hàng thật sự có dữ liệu.
    range: `'${TEAM_LOG_TAB_NAME}'!A1:L1000`,
  });

  return response.data.values || [];
}

function readCell(row, columnLetter) {
  const raw = row[COLUMN_INDEX[columnLetter]];
  const value = raw === undefined || raw === null ? '' : String(raw).trim();
  return value || 'Không có';
}

// key: 'bc' | 'scrim1' | 'scrim2', discordId: string (ID người bấm nút).
// Trả về null nếu không tìm thấy Discord ID nào khớp ở cột A.
async function getUserLocationInfo(key, discordId) {
  const columns = WHERE_LOCATION_COLUMNS[key];
  if (!columns) {
    throw new Error(`Không có cấu hình cột cho "${key}".`);
  }

  const rows = await fetchListSheetRows();

  const matchedRow = rows.find((row) => {
    const cellId = row[COLUMN_INDEX.A] === undefined || row[COLUMN_INDEX.A] === null
      ? ''
      : String(row[COLUMN_INDEX.A]).trim();
    return cellId !== '' && cellId === discordId;
  });

  if (!matchedRow) return null;

  return {
    ingame: readCell(matchedRow, 'B'),
    className: readCell(matchedRow, 'C'),
    viTri: readCell(matchedRow, columns.viTri),
    phanCong: readCell(matchedRow, columns.phanCong),
    ghiChu: readCell(matchedRow, columns.ghiChu),
  };
}

// discordId: string (ID người hỏi "scrim/bc tôi đi đâu"). KHÁC
// getUserLocationInfo ở trên (chỉ tra 1 khu vực) — hàm này tra CẢ 3 khu vực
// (Bang Chiến + Scrim 1 + Scrim 2) trong CÙNG 1 lần đọc sheet (chỉ 1 lần gọi
// Sheets API thay vì gọi 3 lần riêng lẻ), dùng cho lệnh trả lời gộp cả 3.
// Trả về null nếu không tìm thấy Discord ID nào khớp ở cột A, ngược lại trả
// về { ingame, className, bc: { viTri, phanCong }, scrim1: { viTri, phanCong },
// scrim2: { viTri, phanCong } }.
async function getUserLocationInfoAll(discordId) {
  const rows = await fetchListSheetRows();

  const matchedRow = rows.find((row) => {
    const cellId = row[COLUMN_INDEX.A] === undefined || row[COLUMN_INDEX.A] === null
      ? ''
      : String(row[COLUMN_INDEX.A]).trim();
    return cellId !== '' && cellId === discordId;
  });

  if (!matchedRow) return null;

  const readArea = (key) => {
    const columns = WHERE_LOCATION_COLUMNS[key];
    return {
      viTri: readCell(matchedRow, columns.viTri),
      phanCong: readCell(matchedRow, columns.phanCong),
    };
  };

  return {
    ingame: readCell(matchedRow, 'B'),
    className: readCell(matchedRow, 'C'),
    bc: readArea('bc'),
    scrim1: readArea('scrim1'),
    scrim2: readArea('scrim2'),
  };
}

module.exports = { getUserLocationInfo, getUserLocationInfoAll };
