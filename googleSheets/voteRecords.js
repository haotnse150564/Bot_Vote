// ===== BotVote sheet: ghi/xoá 1 lượt vote thủ công =====
// Tách khỏi voteSheet.js.
//
// Mọi thao tác chạy qua runExclusive() (voteLock.js) và dùng helper voteRows.js,
// xem giải thích quy tắc "vote tay thắng auto" ở đầu voteRows.js.

const { google } = require('./googleClient');
const { getGoogleAuthClient } = require('./auth');
const { refreshResultSheet } = require('./resultSheet');
const { SPREADSHEET_ID } = require('../config');
const { ensureSheetHeaders } = require('./voteSheetSetup');
const { runExclusive } = require('./voteLock');
const {
  readVoteRows,
  splitUserEntries,
  deleteVoteRows,
  buildAutoRows,
  appendVoteRows,
  missingAutoDays,
} = require('./voteRows');

// Người dùng VỪA tích 1 ngày bằng tay: từ giờ vote của họ = đúng những gì họ
// tự tích, nên xoá hết dòng auto (nếu có) rồi ghi dòng vote tay.
async function saveVoteToSheet({ guildId, channelId, messageId, userId, username, day, reaction }) {
  if (!SPREADSHEET_ID) {
    console.warn('GOOGLE_SHEET_ID is not set. Vote not saved to Google Sheets.');
    return;
  }

  const authClient = await getGoogleAuthClient();

  if (!authClient) {
    return;
  }

  const changed = await runExclusive(async () => {
    try {
      const sheets = google.sheets({ version: 'v4', auth: authClient });

      await ensureSheetHeaders(authClient);

      const data = await readVoteRows(sheets);

      if (!data) {
        return false;
      }

      const { manual, auto } = splitUserEntries(data.entries, userId);

      await deleteVoteRows(sheets, data.sheetId, auto.map((entry) => entry.rowNumber));

      // Chống ghi trùng cùng 1 vote tay (vd event bắn lặp).
      if (!manual.some((entry) => entry.day === String(day))) {
        await appendVoteRows(sheets, [[
          new Date().toISOString(),
          guildId,
          channelId,
          messageId,
          userId,
          username,
          day,
          reaction,
        ]]);
      }

      console.log(`Saved vote for user ${userId} -> day ${day} in Google Sheets.`);
      return true;
    } catch (error) {
      console.error('Failed to save vote to Google Sheets:', error.message);
      return false;
    }
  });

  if (changed) {
    await refreshResultSheet();
  }
}

// Người dùng VỪA gỡ 1 ngày vote tay.
// restoreAuto (tuỳ chọn): { guildId, channelId, messageId, username } — truyền vào
// khi người này ĐANG có role auto-vote. Nếu gỡ xong họ không còn vote tay nào thì
// bot điền lại Thứ 4/5/6 hộ (thay vì để họ trắng vote). Không truyền = không
// điền lại.
async function removeVoteFromSheet(userId, day, { restoreAuto = null } = {}) {
  if (!SPREADSHEET_ID) {
    console.warn('GOOGLE_SHEET_ID is not set. Vote not removed from Google Sheets.');
    return;
  }

  const authClient = await getGoogleAuthClient();

  if (!authClient) {
    return;
  }

  const changed = await runExclusive(async () => {
    try {
      const sheets = google.sheets({ version: 'v4', auth: authClient });
      const data = await readVoteRows(sheets);

      if (!data) {
        console.warn('Sheet BotVote not found in spreadsheet.');
        return false;
      }

      const { manual, auto } = splitUserEntries(data.entries, userId);
      const removed = manual.filter((entry) => entry.day === String(day));
      const remainingManual = manual.length - removed.length;
      let didChange = false;

      // Chỉ xoá vote TAY của đúng ngày đó; dòng auto (nếu có) không bị đụng ở đây.
      if (removed.length) {
        await deleteVoteRows(sheets, data.sheetId, removed.map((entry) => entry.rowNumber));
        console.log(`Removed vote for user ${userId} -> day ${day} from Google Sheets.`);
        didChange = true;
      } else {
        console.log(`No vote found for user ${userId} on day ${day}.`);
      }

      if (restoreAuto && remainingManual === 0) {
        const missing = missingAutoDays(auto);

        if (missing.length) {
          await appendVoteRows(sheets, buildAutoRows({ ...restoreAuto, userId, days: missing }));
          console.log(`User ${userId} không còn vote tay nào -> bot điền lại auto Thứ 4/5/6.`);
          didChange = true;
        }
      }

      return didChange;
    } catch (error) {
      console.error('Failed to remove vote from Google Sheets:', error.message);
      return false;
    }
  });

  if (changed) {
    await refreshResultSheet();
  }
}

module.exports = { saveVoteToSheet, removeVoteFromSheet };
