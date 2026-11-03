// Đồng bộ danh sách "Đã Đăng Ký" vào 2 tab DKScrimBang1 (Buổi 1) và
// DKScrimBang2 (Buổi 2), nằm trong Google Sheet NGUỒN (SRC_IMAGE_SPREADSHEET_ID
// — khác với SPREADSHEET_ID, nơi chứa tab "Kết Quả Vote").
//
// Nguồn dữ liệu: resultRows do resultSheet.js -> computeVoteData() build ra,
// dạng [header, ...rows] với header = ['ID','Ingame','Class','Thứ 4','Thứ 5',
// 'Thứ 6','Không Đánh'] — TÁI DÙNG lại (không đọc lại "Kết Quả Vote" từ
// Sheets API lần nữa) để tránh tốn thêm 1 lượt gọi API + tránh đọc ngay sau
// khi vừa ghi (có thể chưa kịp cập nhật).
//
// Quy tắc chọn ngày cho mỗi buổi: LUÔN lấy đúng ngày đang active trong
// scrimData (session1Day cho Buổi 1, session2Day cho Buổi 2) — KHÔNG hardcode
// "Thứ 5"/"Thứ 4"/"Thứ 6" — vì NPC có thể đổi ngày qua nm!us1/us2 bất kỳ lúc
// nào (xem scrim/format.js -> applyScrimUpdateArgs). Mặc định session1Day là
// "Thứ 5", session2Day là "Đang tìm" cho tới khi NPC set (xem state.js).
//
// Nếu ngày đang active KHÔNG khớp cột nào trong Kết Quả Vote (VD:
// session2Day = "Đang tìm"/"Nghỉ" — chưa chốt ngày cụ thể) thì BỎ QUA, không
// ghi đè tab đó, để không xoá nhầm danh sách/phân công đang có sẵn khi chưa
// có ngày thật để lọc.
//
// Chỉ ghi đè cột A:C (ID/Ingame/Class) — KHÔNG đụng tới cột D trở đi, phòng
// trường hợp DKScrimBang1/2 có thêm cột Vị Trí/Phân Công/Ghi Chú tự điền tay
// tương tự tab "List BC/Scrim".

const { google } = require('./googleClient');
const { getGoogleAuthClient } = require('./auth');
const { scrimData } = require('../state');
const {
  SRC_IMAGE_SPREADSHEET_ID,
  DK_SCRIM_BANG1_SHEET_NAME,
  DK_SCRIM_BANG2_SHEET_NAME,
} = require('../config');

// Số hàng tối đa sẽ bị xoá trước khi ghi lại (đủ rộng cho danh sách hiện tại
// + dư phòng tương lai). Chỉ xoá cột A:C, không đụng cột D+.
const CLEAR_ROW_LIMIT = 1000;

async function ensureDkScrimSheetExists(authClient, sheetName) {
  if (!SRC_IMAGE_SPREADSHEET_ID) {
    return;
  }

  const sheets = google.sheets({ version: 'v4', auth: authClient });
  const response = await sheets.spreadsheets.get({ spreadsheetId: SRC_IMAGE_SPREADSHEET_ID });
  const existingSheets = response.data.sheets || [];
  const exists = existingSheets.some((sheet) => sheet.properties.title === sheetName);

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SRC_IMAGE_SPREADSHEET_ID,
      resource: {
        requests: [
          {
            addSheet: {
              properties: {
                title: sheetName,
              },
            },
          },
        ],
      },
    });
  }
}

// Lọc resultRows (header + rows từ computeVoteData()) theo đúng cột ngày
// (VD: "Thứ 5") -> trả về mảng rows [ID, Ingame, Class] của những ai có 'X'
// ở cột đó. Trả về null nếu dayLabel không khớp cột nào (chưa chốt ngày).
function filterRegisteredByDay(resultRows, dayLabel) {
  if (!resultRows || resultRows.length === 0) return null;

  const header = resultRows[0];
  const dayIndex = header.indexOf(dayLabel);

  if (dayIndex === -1) {
    return null;
  }

  const members = [];

  for (let i = 1; i < resultRows.length; i += 1) {
    const row = resultRows[i];
    if (row[dayIndex] === 'X') {
      members.push([row[0] || '', row[1] || '', row[2] || '']);
    }
  }

  return members;
}

async function writeDkScrimSheet(sheets, sheetName, members) {
  const outputRows = [['ID', 'Ingame', 'Class'], ...members];

  await sheets.spreadsheets.values.clear({
    spreadsheetId: SRC_IMAGE_SPREADSHEET_ID,
    range: `'${sheetName}'!A1:C${CLEAR_ROW_LIMIT}`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SRC_IMAGE_SPREADSHEET_ID,
    range: `'${sheetName}'!A1:C${outputRows.length}`,
    valueInputOption: 'RAW',
    resource: {
      values: outputRows,
    },
  });
}

// resultRows: [header, ...rows] lấy trực tiếp từ computeVoteData() trong
// resultSheet.js (xem refreshResultSheet() — gọi hàm này ngay sau khi ghi
// xong "Kết Quả Vote"). Tự bắt lỗi nội bộ, không throw ra ngoài — lỗi ở đây
// không được phép làm hỏng luồng refreshResultSheet() chính.
async function syncDkScrimSheets(resultRows) {
  if (!SRC_IMAGE_SPREADSHEET_ID) {
    return;
  }

  if (!resultRows || resultRows.length === 0) {
    return;
  }

  const authClient = await getGoogleAuthClient();

  if (!authClient) {
    return;
  }

  const sheets = google.sheets({ version: 'v4', auth: authClient });

  const sessions = [
    { label: 'Buổi 1', day: scrimData.session1Day, sheetName: DK_SCRIM_BANG1_SHEET_NAME },
    { label: 'Buổi 2', day: scrimData.session2Day, sheetName: DK_SCRIM_BANG2_SHEET_NAME },
  ];

  for (const session of sessions) {
    try {
      const members = filterRegisteredByDay(resultRows, session.day);

      if (members === null) {
        console.log(
          `Bỏ qua đồng bộ ${session.sheetName} (${session.label}): ngày đang active "${session.day}" không khớp cột nào trong Kết Quả Vote.`,
        );
        continue;
      }

      await ensureDkScrimSheetExists(authClient, session.sheetName);
      await writeDkScrimSheet(sheets, session.sheetName, members);

      console.log(`Synced ${session.sheetName} (${session.label} - ${session.day}): ${members.length} người đã đăng ký.`);
    } catch (error) {
      console.error(`Failed to sync ${session.sheetName}:`, error.message);
    }
  }
}

module.exports = { syncDkScrimSheets };
