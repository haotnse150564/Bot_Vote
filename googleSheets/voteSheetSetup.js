// ===== BotVote sheet: tạo tab/header + reset đầu tuần =====
// Tách khỏi voteSheet.js.

const { google } = require('./googleClient');
const { getGoogleAuthClient } = require('./auth');
const { refreshResultSheet, getVoteDetail } = require('./resultSheet');
const { accumulateWeeklyVotes } = require('./topVoteSheet');
const { appendVoteHistorySnapshot, appendVoteHistoryDetail } = require('./voteHistorySheet');
const { SPREADSHEET_ID, SHEET_NAME } = require('../config');
const { runExclusive } = require('./voteLock');

async function ensureVoteSheetExists(authClient) {
  if (!SPREADSHEET_ID) {
    return;
  }

  const sheets = google.sheets({ version: 'v4', auth: authClient });
  const response = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existingSheets = response.data.sheets || [];
  const exists = existingSheets.some((sheet) => sheet.properties.title === SHEET_NAME);

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: {
        requests: [
          {
            addSheet: {
              properties: {
                title: SHEET_NAME,
              },
            },
          },
        ],
      },
    });
  }
}

async function ensureSheetHeaders(authClient) {
  if (!SPREADSHEET_ID) {
    return;
  }

  const sheets = google.sheets({ version: 'v4', auth: authClient });

  await ensureVoteSheetExists(authClient);

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1:H1`,
    });

    if (response.data.values && response.data.values.length > 0) {
      return;
    }
  } catch (error) {
    // Ignore "range not found" errors and create the header row.
  }

  const headers = [['timestamp', 'guildId', 'channelId', 'messageId', 'userId', 'username', 'day', 'reaction']];

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1:H1`,
    valueInputOption: 'RAW',
    resource: {
      values: headers,
    },
  });
}

async function resetVoteSheet() {
  if (!SPREADSHEET_ID) {
    return;
  }

  const authClient = await getGoogleAuthClient();

  if (!authClient) {
    return;
  }

  const sheets = google.sheets({ version: 'v4', auth: authClient });

  try {
    await ensureVoteSheetExists(authClient);

    // Đọc bảng "Kết Quả Vote" của TUẦN VỪA KẾT THÚC TRƯỚC khi xóa dữ liệu
    // BotVote bên dưới — nếu đọc sau thì BXH Vote sẽ không cộng dồn được gì
    // (dữ liệu tuần này đã mất). Lỗi đọc (vd chưa cấu hình sheet) chỉ log,
    // không chặn phần reset chính bên dưới.
    let voteDetailThisWeek = null;
    try {
      voteDetailThisWeek = await getVoteDetail();
    } catch (error) {
      console.error('Failed to read this week\'s vote detail before reset:', error.message);
    }

    // Xoá + ghi lại header trong runExclusive() để không xen ngang các thao tác
    // vote đang ghi vào BotVote (xem voteLock.js).
    await runExclusive(async () => {
      await sheets.spreadsheets.values.clear({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A2:Z`,
      });

      const headers = [['timestamp', 'guildId', 'channelId', 'messageId', 'userId', 'username', 'day', 'reaction']];

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A1:H1`,
        valueInputOption: 'RAW',
        resource: {
          values: headers,
        },
      });
    });

    await refreshResultSheet();

    // Cộng dồn "Số Tuần Đã Vote" vào BXH Vote (googleSheets/topVoteSheet.js)
    // cho tuần VỪA reset, dựa trên dữ liệu đã đọc được ở trên.
    if (voteDetailThisWeek && Array.isArray(voteDetailThisWeek.people)) {
      await accumulateWeeklyVotes(voteDetailThisWeek.people);
    }

    // Lưu snapshot 5 số tổng hợp CỘNG chi tiết theo từng người của tuần VỪA
    // reset vào "Lịch Sử Vote" / "Chi Tiết Vote Theo Tuần"
    // (googleSheets/voteHistorySheet.js) — dùng CHUNG 1 mốc thời gian
    // resetAt để 2 sheet khớp theo tuần. Dùng cho GET /admin/stats/history
    // và GET /admin/stats/absentees.
    if (voteDetailThisWeek && voteDetailThisWeek.summary) {
      const resetAt = new Date().toISOString();
      await appendVoteHistorySnapshot(
        voteDetailThisWeek.summary,
        Array.isArray(voteDetailThisWeek.people) ? voteDetailThisWeek.people.length : 0,
        resetAt
      );
      if (Array.isArray(voteDetailThisWeek.people)) {
        await appendVoteHistoryDetail(resetAt, voteDetailThisWeek.people);
      }
    }

    console.log(`Reset vote sheet ${SHEET_NAME} in spreadsheet ${SPREADSHEET_ID}.`);
  } catch (error) {
    console.error('Failed to reset vote sheet:', error.message);
  }
}

module.exports = { ensureVoteSheetExists, ensureSheetHeaders, resetVoteSheet };
