// Bảng xếp hạng "chuyên cần vote" — CỘNG DỒN theo từng tuần, khác hẳn
// resultSheet.js (chỉ phản ánh đúng tuần hiện tại, bị xóa mỗi lần /rsvote).
// Mỗi khi 1 tuần kết thúc (NPC chạy /rsvote hoặc nm!rsvote để reset vote cho
// tuần mới), voteSheet.js -> resetVoteSheet() gọi accumulateWeeklyVotes()
// TRƯỚC khi xóa dữ liệu BotVote, dựa trên bảng "Kết Quả Vote" của đúng tuần
// vừa kết thúc để +1 vào cột "Số Tuần Đã Vote" cho những ai đã vote (bất kỳ
// ngày nào, kể cả "Không Đánh" — vẫn tính là CÓ tham gia vote tuần đó, khác
// với im lặng không vote gì cả).
//
// QUAN TRỌNG: sheet LUÔN LIỆT KÊ ĐẦY ĐỦ TOÀN BỘ thành viên trong DSB (kể cả
// người CHƯA TỪNG vote 1 lần nào) — không chỉ những người đã từng vote —
// để lúc làm web (đọc thẳng sheet này qua Sheets API) có thể lọc ra được cả
// 3 trường hợp:
//   1) CHƯA VOTE BẤT CỨ CÁI NÀO từ trước tới giờ  -> "Số Tuần Đã Vote" = 0
//   2) CHỈ CHƯA VOTE TUẦN GẦN NHẤT (trước đó có vote) -> "Vote Tuần Gần
//      Nhất" = "Không", "Số Tuần Đã Vote" có thể > 0
//   3) BỎ VOTE LIÊN TỤC NHIỀU TUẦN (streak) -> "Số Tuần Liên Tiếp Không
//      Vote" = N (N tuần gần đây nhất KHÔNG vote LIÊN TỤC, KHÔNG bị ngắt
//      quãng) — cột này tự +1 mỗi tuần họ không vote, và RESET VỀ 0 ngay
//      khi họ vote lại (kể cả sau khi đã bỏ lỡ nhiều tuần trước đó).
const { google } = require('./googleClient');
const { getGoogleAuthClient } = require('./auth');
const { SPREADSHEET_ID, TOPVOTE_SHEET_NAME } = require('../config');

const TOPVOTE_HEADER = [
  'ID',
  'Ingame',
  'Class',
  'Số Tuần Đã Vote',
  'Vote Tuần Gần Nhất',
  'Số Tuần Liên Tiếp Không Vote',
];

async function ensureTopVoteSheet(authClient) {
  if (!SPREADSHEET_ID) {
    return;
  }

  const sheets = google.sheets({ version: 'v4', auth: authClient });
  const response = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existingSheets = response.data.sheets || [];
  const exists = existingSheets.some((sheet) => sheet.properties.title === TOPVOTE_SHEET_NAME);

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: {
        requests: [
          {
            addSheet: {
              properties: {
                title: TOPVOTE_SHEET_NAME,
              },
            },
          },
        ],
      },
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${TOPVOTE_SHEET_NAME}!A1:F1`,
      valueInputOption: 'RAW',
      resource: {
        values: [TOPVOTE_HEADER],
      },
    });
  }
}

// people: mảng lấy từ resultSheet.js -> getVoteDetail() -> đã có SẴN TOÀN
// BỘ thành viên trong DSB (kể cả người chưa vote gì), mỗi phần tử dạng
// { id, ingame, className, thu4, thu5, thu6, khongDanh } của TUẦN VỪA KẾT
// THÚC (phải đọc TRƯỚC khi BotVote bị xóa bởi resetVoteSheet()).
// MỌI người trong `people` đều được ghi/giữ lại 1 dòng trong sheet — người
// chưa vote gì tuần này vẫn được thêm dòng mới (total = 0) nếu là lần đầu
// xuất hiện, hoặc GIỮ NGUYÊN total cũ nếu đã có từ trước (chỉ không +1).
async function accumulateWeeklyVotes(people) {
  if (!SPREADSHEET_ID) {
    return;
  }

  if (!Array.isArray(people) || !people.length) {
    return;
  }

  const authClient = await getGoogleAuthClient();

  if (!authClient) {
    return;
  }

  try {
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    await ensureTopVoteSheet(authClient);

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${TOPVOTE_SHEET_NAME}!A:F`,
    });

    const rows = response.data.values || [];
    // rowsById: id -> { ingame, className, total, missStreak } — bỏ header (dòng 0).
    const rowsById = new Map();

    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i];
      const id = row[0] !== undefined && row[0] !== null ? String(row[0]).trim() : '';
      if (!id) continue;

      rowsById.set(id, {
        ingame: row[1] || '',
        className: row[2] || '',
        total: parseInt(row[3], 10) || 0,
        // Cột F (index 5) có thể chưa tồn tại ở những dòng cũ (trước khi
        // thêm tính năng streak) -> mặc định 0 nếu thiếu/không parse được.
        missStreak: parseInt(row[5], 10) || 0,
      });
    }

    // votedThisWeekById: id -> true/false — dùng để ghi cột "Vote Tuần Gần
    // Nhất" cho MỌI người có mặt trong `people` (kể cả người chưa từng vote
    // trước đó), không chỉ những người vừa vote tuần này.
    const votedThisWeekById = new Map();

    for (const person of people) {
      const id = person.id !== undefined && person.id !== null ? String(person.id).trim() : '';
      if (!id) continue;

      const votedThisWeek = Boolean(person.thu4 || person.thu5 || person.thu6 || person.khongDanh);
      votedThisWeekById.set(id, votedThisWeek);

      const existing = rowsById.get(id) || { ingame: '', className: '', total: 0, missStreak: 0 };

      rowsById.set(id, {
        // Luôn cập nhật Ingame/Class theo bản mới nhất (đổi tên/đổi class
        // thì bảng xếp hạng vẫn hiện đúng thông tin hiện tại), không giữ
        // nguyên tên cũ đã lưu từ những tuần trước.
        ingame: person.ingame || existing.ingame,
        className: person.className || existing.className,
        // Chỉ +1 khi ĐÃ vote tuần này — người chưa vote gì vẫn được thêm/
        // giữ dòng (total không đổi, có thể là 0 nếu chưa từng vote lần nào).
        total: existing.total + (votedThisWeek ? 1 : 0),
        // Streak bỏ vote liên tục: vote lại thì RESET VỀ 0 ngay; không vote
        // thì +1 tiếp nối từ streak cũ (người mới/chưa từng vote bắt đầu từ 0).
        missStreak: votedThisWeek ? 0 : existing.missStreak + 1,
      });
    }

    const updatedRows = [
      TOPVOTE_HEADER,
      ...[...rowsById.entries()].map(([id, data]) => [
        id,
        data.ingame,
        data.className,
        data.total,
        votedThisWeekById.get(id) ? 'Có' : 'Không',
        data.missStreak,
      ]),
    ];

    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `${TOPVOTE_SHEET_NAME}!A1:Z`,
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${TOPVOTE_SHEET_NAME}!A1:F${updatedRows.length}`,
      valueInputOption: 'RAW',
      resource: {
        values: updatedRows,
      },
    });

    console.log(`Cộng dồn BXH Vote tuần này: ${rowsById.size} người (đầy đủ toàn bộ DSB) trong bảng xếp hạng.`);
  } catch (error) {
    console.error('Failed to accumulate weekly top-vote data:', error.message);
  }
}

// Trả về mảng [{ id, ingame, className, total, votedLastWeek, missStreak }]
// đã sắp xếp giảm dần theo total, tối đa `limit` người — dùng cho lệnh
// /topvote (nm!topvote). Vì sheet đã liệt kê ĐẦY ĐỦ toàn bộ DSB (kể cả
// người chưa từng vote), muốn lấy TOÀN BỘ danh sách (không cắt top N) thì
// gọi getTopVoters(Infinity) hoặc dùng getAllVoteStats() bên dưới.
async function getTopVoters(limit = 10) {
  const all = await getAllVoteStats();
  if (all === null) return null;
  return all.slice(0, limit);
}

// Trả về TOÀN BỘ danh sách trong sheet "BXH Vote" (không giới hạn số
// lượng), đã sắp xếp giảm dần theo total — dùng cho web/dashboard đọc để tự
// lọc ra người chưa vote bất cứ cái nào (total === 0), người chưa vote tuần
// gần nhất (votedLastWeek === false), hoặc người đang bỏ vote liên tục
// nhiều tuần (missStreak >= N, ví dụ >= 2 cho "1 2 tuần liên tục không vote").
async function getAllVoteStats() {
  if (!SPREADSHEET_ID) {
    return null;
  }

  const authClient = await getGoogleAuthClient();

  if (!authClient) {
    return null;
  }

  try {
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    await ensureTopVoteSheet(authClient);

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${TOPVOTE_SHEET_NAME}!A:F`,
    });

    const rows = response.data.values || [];
    const people = [];

    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i];
      const id = row[0] !== undefined && row[0] !== null ? String(row[0]).trim() : '';
      if (!id) continue;

      people.push({
        id,
        ingame: row[1] || '',
        className: row[2] || '',
        total: parseInt(row[3], 10) || 0,
        votedLastWeek: String(row[4] || '').trim() === 'Có',
        missStreak: parseInt(row[5], 10) || 0,
      });
    }

    people.sort((a, b) => b.total - a.total);

    return people;
  } catch (error) {
    console.error('Failed to read top-vote leaderboard:', error.message);
    return null;
  }
}

module.exports = { ensureTopVoteSheet, accumulateWeeklyVotes, getTopVoters, getAllVoteStats };
