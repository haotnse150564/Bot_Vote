// Đọc/ghi tab "Lịch Sử Vote" (SPREADSHEET_ID, cùng spreadsheet với "Kết Quả
// Vote"/"BXH Vote") — lưu 1 dòng SNAPSHOT 5 số tổng hợp mỗi khi 1 tuần vote
// kết thúc (nm!rsvote / /rsvote / nút "Reset Vote" trên web), khác hẳn
// RESULT_SHEET_NAME (bị ghi đè mỗi tuần, không giữ được lịch sử qua các
// tuần). Dùng cho route GET /admin/stats/history (web vẽ biểu đồ xu hướng
// tham gia scrim theo thời gian).
//
// Cấu trúc cột (dòng 1 là header, dòng 2 trở đi là data, MỚI NHẤT ở CUỐI):
//   A = Thời điểm reset (ISO timestamp)
//   B = Tổng Thứ 4
//   C = Tổng Thứ 5
//   D = Tổng Thứ 6
//   E = Tổng Không Đánh
//   F = Chưa Vote (số người không vote ngày nào cả)
//   G = Tổng thành viên tuần đó (= tổng số dòng trong "Kết Quả Vote" tuần đó)

const { google } = require('./googleClient');
const { getGoogleAuthClient } = require('./auth');
const { SPREADSHEET_ID, VOTE_HISTORY_SHEET_NAME, VOTE_HISTORY_DETAIL_SHEET_NAME } = require('../config');

const HEADER_ROW = ['Thời điểm reset', 'Tổng Thứ 4', 'Tổng Thứ 5', 'Tổng Thứ 6', 'Tổng Không Đánh', 'Chưa Vote', 'Tổng thành viên'];
const DATA_RANGE = `'${VOTE_HISTORY_SHEET_NAME}'!A2:G`;

// Cấu trúc cột sheet "Chi Tiết Vote Theo Tuần" (1 dòng / 1 thành viên / 1
// tuần — MỚI NHẤT ở CUỐI, giống "Lịch Sử Vote"):
//   A = Thời điểm reset (ISO timestamp, TRÙNG với dòng tương ứng bên
//       "Lịch Sử Vote" của cùng tuần đó — dùng để nhóm theo tuần khi đọc)
//   B = ID (Discord ID, dùng để nhận diện 1 người qua nhiều tuần dù đổi tên)
//   C = Ingame
//   D = Class
//   E = Thứ 4 (X/'')
//   F = Thứ 5 (X/'')
//   G = Thứ 6 (X/'')
//   H = Không Đánh (X/'' — có vote nhưng chọn "Off")
//   I = Chưa Vote (X/'' — không bấm react ngày nào cả, kể cả Off)
const DETAIL_HEADER_ROW = ['Thời điểm reset', 'ID', 'Ingame', 'Class', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Không Đánh', 'Chưa Vote'];
const DETAIL_DATA_RANGE = `'${VOTE_HISTORY_DETAIL_SHEET_NAME}'!A2:I`;

async function getSheetsClient() {
  const authClient = await getGoogleAuthClient();
  if (!authClient) {
    throw new Error('Chưa cấu hình Google Sheets credentials cho bot.');
  }
  return google.sheets({ version: 'v4', auth: authClient });
}

async function ensureVoteHistorySheetExistsWithClient(sheets) {
  if (!SPREADSHEET_ID) return;

  const response = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existingSheets = response.data.sheets || [];
  const exists = existingSheets.some((sheet) => sheet.properties.title === VOTE_HISTORY_SHEET_NAME);

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { requests: [{ addSheet: { properties: { title: VOTE_HISTORY_SHEET_NAME } } }] },
    });
  }

  const existingValues = await sheets.spreadsheets.values
    .get({ spreadsheetId: SPREADSHEET_ID, range: `'${VOTE_HISTORY_SHEET_NAME}'!A1:G1` })
    .catch(() => ({ data: {} }));

  const rows = (existingValues.data && existingValues.data.values) || [];
  if (rows.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${VOTE_HISTORY_SHEET_NAME}'!A1:G1`,
      valueInputOption: 'RAW',
      resource: { values: [HEADER_ROW] },
    });
  }
}

async function ensureVoteHistoryDetailSheetExistsWithClient(sheets) {
  if (!SPREADSHEET_ID) return;

  const response = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existingSheets = response.data.sheets || [];
  const exists = existingSheets.some((sheet) => sheet.properties.title === VOTE_HISTORY_DETAIL_SHEET_NAME);

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { requests: [{ addSheet: { properties: { title: VOTE_HISTORY_DETAIL_SHEET_NAME } } }] },
    });
  }

  const existingValues = await sheets.spreadsheets.values
    .get({ spreadsheetId: SPREADSHEET_ID, range: `'${VOTE_HISTORY_DETAIL_SHEET_NAME}'!A1:I1` })
    .catch(() => ({ data: {} }));

  const rows = (existingValues.data && existingValues.data.values) || [];
  if (rows.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${VOTE_HISTORY_DETAIL_SHEET_NAME}'!A1:I1`,
      valueInputOption: 'RAW',
      resource: { values: [DETAIL_HEADER_ROW] },
    });
  }
}

// Gọi 1 lần lúc ClientReady (giống pattern ensureXSheetExists khác trong
// index.js) — nhận thẳng authClient. Đảm bảo LUÔN CẢ 2 sheet (tổng hợp +
// chi tiết theo người) cùng lúc để nơi gọi (index.js) không cần biết thêm.
async function ensureVoteHistorySheetExists(authClient) {
  if (!authClient || !SPREADSHEET_ID) return;
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  await ensureVoteHistorySheetExistsWithClient(sheets);
  await ensureVoteHistoryDetailSheetExistsWithClient(sheets);
}

// Thêm 1 dòng snapshot mới vào CUỐI sheet. Gọi từ voteSheet.js ->
// resetVoteSheet(), TRƯỚC khi BotVote bị xóa — summary lấy từ
// resultSheet.js -> getVoteDetail() (đã đọc SẴN của tuần vừa kết thúc).
// totalMembers: tổng số dòng trong bảng "Kết Quả Vote" tuần đó (people.length).
// resetAt: ISO timestamp DÙNG CHUNG với appendVoteHistoryDetail() của cùng
// lần reset này (voteSheet.js tạo 1 lần rồi truyền vào cả 2 hàm) — để 2
// sheet khớp đúng theo tuần khi getVoteAbsentees() nhóm theo resetAt. Nếu
// không truyền, tự tạo mới (tương thích ngược).
async function appendVoteHistorySnapshot(summary, totalMembers, resetAt) {
  if (!SPREADSHEET_ID || !summary) return;

  try {
    const sheets = await getSheetsClient();
    await ensureVoteHistorySheetExistsWithClient(sheets);

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${VOTE_HISTORY_SHEET_NAME}'!A:G`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      resource: {
        values: [[
          resetAt || new Date().toISOString(),
          summary.totalThu4 || 0,
          summary.totalThu5 || 0,
          summary.totalThu6 || 0,
          summary.totalKhongDanh || 0,
          summary.notVotedCount || 0,
          totalMembers || 0,
        ]],
      },
    });

    console.log(`Đã lưu snapshot vào "${VOTE_HISTORY_SHEET_NAME}".`);
  } catch (error) {
    // Best-effort: không chặn luồng reset vote chính nếu ghi lịch sử lỗi.
    console.error('Không thể lưu snapshot vào "Lịch Sử Vote":', error.message);
  }
}

// Thêm 1 dòng / 1 thành viên vào CUỐI sheet "Chi Tiết Vote Theo Tuần" cho
// tuần VỪA reset — gọi CÙNG lúc với appendVoteHistorySnapshot() từ
// voteSheet.js -> resetVoteSheet(), dùng CHUNG 1 giá trị resetAt (ISO
// timestamp) để 2 sheet khớp theo tuần. people: mảng từ resultSheet.js ->
// getVoteDetail() ({ id, ingame, className, thu4, thu5, thu6, khongDanh }).
async function appendVoteHistoryDetail(resetAt, people) {
  if (!SPREADSHEET_ID || !Array.isArray(people) || !people.length) return;

  try {
    const sheets = await getSheetsClient();
    await ensureVoteHistoryDetailSheetExistsWithClient(sheets);

    const values = people.map((p) => {
      const notVoted = !p.thu4 && !p.thu5 && !p.thu6 && !p.khongDanh;
      return [
        resetAt,
        p.id || '',
        p.ingame || '',
        p.className || '',
        p.thu4 ? 'X' : '',
        p.thu5 ? 'X' : '',
        p.thu6 ? 'X' : '',
        p.khongDanh ? 'X' : '',
        notVoted ? 'X' : '',
      ];
    });

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${VOTE_HISTORY_DETAIL_SHEET_NAME}'!A:I`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      resource: { values },
    });

    console.log(`Đã lưu chi tiết ${values.length} thành viên vào "${VOTE_HISTORY_DETAIL_SHEET_NAME}".`);
  } catch (error) {
    // Best-effort: không chặn luồng reset vote chính nếu ghi lịch sử lỗi.
    console.error('Không thể lưu chi tiết vào "Chi Tiết Vote Theo Tuần":', error.message);
  }
}

// Đọc toàn bộ lịch sử (mặc định tối đa 52 tuần gần nhất — ~1 năm), CŨ NHẤT
// trước, MỚI NHẤT sau (đúng thứ tự để web vẽ biểu đồ theo thời gian).
//
// KHÔNG gọi ensureVoteHistorySheetExistsWithClient() ở đây nữa — sheet này
// đã được đảm bảo tồn tại đúng 1 lần lúc Bot khởi động (ensureVoteHistorySheetExists
// gọi từ index.js#ClientReady). Gọi lại mỗi lần đọc chỉ tốn thêm 2 request
// Sheets API vô ích (spreadsheets.get + values.get kiểm tra header) — trang
// bot-admin.html tải ~10 mục Sheets cùng lúc mỗi lần mở trang, cộng dồn rất
// dễ vượt hạn mức (quota) của Google, gây lỗi 429 bị hiểu nhầm thành "chưa
// cấu hình Sheets" (xem catch bên dưới, gộp chung mọi lỗi Sheets API).
async function getVoteHistory(limit = 52) {
  if (!SPREADSHEET_ID) return null;

  try {
    const sheets = await getSheetsClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: DATA_RANGE,
    });
    const rows = response.data.values || [];

    const entries = rows
      .filter((row) => row[0])
      .map((row) => ({
        resetAt: row[0],
        totalThu4: parseInt(row[1], 10) || 0,
        totalThu5: parseInt(row[2], 10) || 0,
        totalThu6: parseInt(row[3], 10) || 0,
        totalKhongDanh: parseInt(row[4], 10) || 0,
        notVotedCount: parseInt(row[5], 10) || 0,
        totalMembers: parseInt(row[6], 10) || 0,
      }));

    return entries.slice(-Math.abs(limit));
  } catch (error) {
    console.error('Không thể đọc "Lịch Sử Vote":', error.message);
    return null;
  }
}

// Đọc toàn bộ chi tiết theo người (mặc định tối đa 52 tuần gần nhất), CŨ
// NHẤT trước, MỚI NHẤT sau — dùng làm nền cho getVoteAbsentees() bên dưới.
async function getVoteHistoryDetail(limit = 52) {
  if (!SPREADSHEET_ID) return null;

  try {
    const sheets = await getSheetsClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: DETAIL_DATA_RANGE,
    });
    const rows = response.data.values || [];

    const entries = rows
      .filter((row) => row[0] && row[1])
      .map((row) => ({
        resetAt: row[0],
        id: String(row[1]).trim(),
        ingame: row[2] || '',
        className: row[3] || '',
        thu4: row[4] === 'X',
        thu5: row[5] === 'X',
        thu6: row[6] === 'X',
        khongDanh: row[7] === 'X',
        notVoted: row[8] === 'X',
      }));

    // Nhóm theo resetAt để cắt đúng N TUẦN gần nhất (không phải N dòng).
    const weekKeys = [...new Set(entries.map((e) => e.resetAt))];
    const keptWeeks = new Set(weekKeys.slice(-Math.abs(limit)));

    return entries.filter((e) => keptWeeks.has(e.resetAt));
  } catch (error) {
    console.error('Không thể đọc "Chi Tiết Vote Theo Tuần":', error.message);
    return null;
  }
}

// Tính, cho MỖI thành viên, chuỗi số tuần LIÊN TỤC gần đây nhất mà họ
// "Không Đánh" (đã vote nhưng chọn Off) hoặc hoàn toàn "Chưa Vote" (không
// react ngày nào) — đếm lùi từ tuần MỚI NHẤT, dừng lại ngay khi gặp 1 tuần
// họ có vote ít nhất 1 ngày Thứ 4/5/6. Dùng cho route GET
// /admin/stats/absentees (web hiển thị "ai đang vắng mặt liên tục").
// weeksWindow: số tuần gần nhất dùng làm dữ liệu nền (mặc định 52).
async function getVoteAbsentees(weeksWindow = 52) {
  const entries = await getVoteHistoryDetail(weeksWindow);
  if (!entries) return null;

  const totalWeeksTracked = new Set(entries.map((e) => e.resetAt)).size;

  const byMember = new Map();
  for (const e of entries) {
    if (!byMember.has(e.id)) byMember.set(e.id, []);
    byMember.get(e.id).push(e);
  }

  const members = [];
  for (const [id, weeks] of byMember.entries()) {
    // MỚI NHẤT trước để đếm streak lùi từ hiện tại.
    weeks.sort((a, b) => (a.resetAt < b.resetAt ? 1 : -1));

    let offStreak = 0; // liên tục "Không Đánh" (có vote, chọn Off)
    let noVoteStreak = 0; // liên tục "Chưa Vote" (không react ngày nào)
    let stillCounting = true;

    for (const w of weeks) {
      const absent = w.khongDanh || w.notVoted;
      if (!stillCounting || !absent) {
        stillCounting = false;
        continue;
      }
      if (w.notVoted) noVoteStreak += 1;
      else offStreak += 1;
    }

    const latest = weeks[0];
    members.push({
      id,
      ingame: latest.ingame,
      className: latest.className,
      offStreak,
      noVoteStreak,
      absentStreak: offStreak + noVoteStreak,
      weeksTracked: weeks.length,
      lastVotedAt: (weeks.find((w) => !w.khongDanh && !w.notVoted) || {}).resetAt || null,
    });
  }

  members.sort((a, b) => b.absentStreak - a.absentStreak);

  return { totalWeeksTracked, members };
}

module.exports = {
  ensureVoteHistorySheetExists,
  appendVoteHistorySnapshot,
  appendVoteHistoryDetail,
  getVoteHistory,
  getVoteHistoryDetail,
  getVoteAbsentees,
};