// ===== BotVote sheet: helper đọc/xoá/thêm dòng vote =====
// CHỈ gọi bên trong runExclusive() (voteLock.js) để không đè lên nhau.
//
// Quy tắc vote (dùng chung cho mọi nơi):
//   - Dòng có cột reaction = 'auto'  -> vote do BOT điền hộ (role auto-vote).
//   - Dòng có reaction khác (4️⃣ 5️⃣ 6️⃣ 0️⃣) -> vote TAY của người dùng.
//   - Người nào đã có ÍT NHẤT 1 vote tay thì bot KHÔNG điền hộ nữa, vote của họ
//     đúng bằng những gì họ tự tích. Chỉ khi họ không còn vote tay nào (và còn
//     role) thì bot mới điền Thứ 4/5/6 hộ.

const { SPREADSHEET_ID, SHEET_NAME, AUTOVOTE_REACTION_TAG } = require('../config');

const AUTO_DAYS = [4, 5, 6];

function cell(row, index) {
  return row[index] !== undefined && row[index] !== null ? String(row[index]).trim() : '';
}

// Đọc toàn bộ BotVote (bỏ dòng header). Trả về null nếu chưa có tab.
async function readVoteRows(sheets) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties',
  });
  const sheet = (meta.data.sheets || []).find((item) => item.properties.title === SHEET_NAME);

  if (!sheet) {
    return null;
  }

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:H`,
  });

  const entries = (response.data.values || [])
    .map((row, index) => ({
      rowNumber: index + 1, // số dòng thật trên sheet (header = dòng 1)
      userId: cell(row, 4),
      day: cell(row, 6),
      reaction: cell(row, 7),
    }))
    .slice(1);

  return { sheetId: sheet.properties.sheetId, entries };
}

function isAutoEntry(entry) {
  return entry.reaction === AUTOVOTE_REACTION_TAG;
}

// Tách các dòng của 1 người thành { manual, auto }.
function splitUserEntries(entries, userId) {
  const uid = String(userId).trim();
  const mine = entries.filter((entry) => entry.userId === uid);

  return {
    manual: mine.filter((entry) => !isAutoEntry(entry)),
    auto: mine.filter(isAutoEntry),
  };
}

// Xoá nhiều dòng trong 1 batch. Xoá từ dưới lên để số dòng không bị lệch.
async function deleteVoteRows(sheets, sheetId, rowNumbers) {
  if (!rowNumbers.length) {
    return;
  }

  const requests = [...rowNumbers]
    .sort((a, b) => b - a)
    .map((rowNumber) => ({
      deleteDimension: {
        range: {
          sheetId,
          dimension: 'ROWS',
          startIndex: rowNumber - 1,
          endIndex: rowNumber,
        },
      },
    }));

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: { requests },
  });
}

function buildAutoRows({ guildId, channelId, messageId, userId, username, days = AUTO_DAYS }) {
  const now = new Date().toISOString();

  return days.map((day) => [
    now,
    guildId || 'dm',
    channelId,
    messageId,
    userId,
    username,
    day,
    AUTOVOTE_REACTION_TAG,
  ]);
}

async function appendVoteRows(sheets, rows) {
  if (!rows.length) {
    return;
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:H`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    resource: { values: rows },
  });
}

// Những ngày Thứ 4/5/6 mà người này CHƯA có dòng auto.
function missingAutoDays(autoEntries) {
  const have = new Set(autoEntries.map((entry) => entry.day));
  return AUTO_DAYS.filter((day) => !have.has(String(day)));
}

module.exports = {
  AUTO_DAYS,
  readVoteRows,
  isAutoEntry,
  splitUserEntries,
  deleteVoteRows,
  buildAutoRows,
  appendVoteRows,
  missingAutoDays,
};
