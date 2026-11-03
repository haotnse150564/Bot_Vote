// ===== BotVote sheet: điều phối chung =====
// Module này giờ chỉ giữ resyncVoteSheetFromReactions() (đồng bộ lại toàn
// bộ sheet từ reaction thật trên tin vote) + re-export các hàm đã tách ra:
//   - voteSheetSetup.js : tạo tab/header + reset đầu tuần
//   - voteRecords.js    : ghi/xoá 1 lượt vote thủ công
//   - autoVoteSheet.js  : sheet log/backup role auto-vote + các thao tác kèm theo

const { google } = require('./googleClient');
const client = require('../client');
const { getGoogleAuthClient } = require('./auth');
const { refreshResultSheet } = require('./resultSheet');
const { scrimData } = require('../state');
const { SPREADSHEET_ID, SHEET_NAME, DAY_REACTIONS, AUTOVOTE_REACTION_TAG } = require('../config');
const { ensureVoteSheetExists, ensureSheetHeaders, resetVoteSheet } = require('./voteSheetSetup');
const { saveVoteToSheet, removeVoteFromSheet } = require('./voteRecords');
const { runExclusive } = require('./voteLock');
const {
  ensureAutoVoteSheetExists,
  getAutoVoteRoleMemberIds,
  getAutoVoteRoleMembers,
  resolveUsername,
  syncAutoVoteSheetWithRole,
  removeAutoVoteRowsForUser,
  syncAutoVoteRowsForUser,
  saveAutoVoteRows,
} = require('./autoVoteSheet');

// Lấy TẤT CẢ người đã react 1 emoji (Discord trả tối đa 100/lần, trước đây chỉ
// lấy 1 lần nên emoji có >100 người sẽ bị thiếu vote khi đồng bộ).
async function fetchAllReactionUsers(reaction) {
  const all = new Map();
  let after;

  for (let page = 0; page < 50; page += 1) {
    const batch = await reaction.users.fetch({ limit: 100, after });

    if (!batch.size) break;

    let maxId = after || '0';

    for (const [id, user] of batch) {
      all.set(id, user);
      if (BigInt(id) > BigInt(maxId)) maxId = id;
    }

    if (batch.size < 100) break;
    after = maxId;
  }

  return all;
}

// Chạy trong runExclusive() để không đè/bị đè bởi các thao tác react đang ghi
// vào BotVote (xem voteLock.js).
function resyncVoteSheetFromReactions() {
  return runExclusive(resyncVoteSheetFromReactionsUnlocked);
}

async function resyncVoteSheetFromReactionsUnlocked() {
  if (!scrimData.messageId || !scrimData.channelId) {
    return { ok: false, reason: 'no-message' };
  }

  if (!SPREADSHEET_ID) {
    return { ok: false, reason: 'no-sheet' };
  }

  try {
    const channel = await client.channels.fetch(scrimData.channelId);
    const voteMessage = await channel.messages.fetch(scrimData.messageId);

    const rows = [];
    const manualVotedUserIds = new Set();

    for (const emoji of Object.keys(DAY_REACTIONS)) {
      const day = DAY_REACTIONS[emoji];
      const reaction = voteMessage.reactions.cache.get(emoji);

      if (!reaction) continue;

      const reactedUsers = await fetchAllReactionUsers(reaction);

      for (const [, reactedUser] of reactedUsers) {
        if (reactedUser.bot) continue;

        manualVotedUserIds.add(String(reactedUser.id).trim());

        rows.push([
          new Date().toISOString(),
          voteMessage.guildId || 'dm',
          voteMessage.channelId,
          voteMessage.id,
          reactedUser.id,
          reactedUser.username || reactedUser.tag || reactedUser.id,
          day,
          emoji,
        ]);
      }
    }

    // Auto-vote users who did NOT manually react to any day get Thứ 4/5/6 auto-filled.
    // Role membership is the source of truth; also refresh the log/backup sheet.
    // force:true — bấm "Đồng bộ vote" (web/bot) LUÔN đọc lại role từ Discord,
    // không dùng kết quả cache ngắn hạn.
    const autoVote = await getAutoVoteRoleMembers(voteMessage.guild, { force: true });
    const autoVoteUserIds = autoVote.ids;

    if (autoVote.source === 'discord') {
      await syncAutoVoteSheetWithRole(voteMessage.guild);
    }

    for (const userId of autoVoteUserIds) {
      if (manualVotedUserIds.has(String(userId).trim())) continue;

      const username = await resolveUsername(voteMessage.guild, userId);

      for (const day of [4, 5, 6]) {
        rows.push([
          new Date().toISOString(),
          voteMessage.guildId || 'dm',
          voteMessage.channelId,
          voteMessage.id,
          userId,
          username,
          day,
          AUTOVOTE_REACTION_TAG,
        ]);
      }
    }

    const authClient = await getGoogleAuthClient();

    if (!authClient) {
      return { ok: false, reason: 'no-auth' };
    }

    const sheets = google.sheets({ version: 'v4', auth: authClient });

    await ensureVoteSheetExists(authClient);

    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2:Z`,
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1:H1`,
      valueInputOption: 'RAW',
      resource: {
        values: [['timestamp', 'guildId', 'channelId', 'messageId', 'userId', 'username', 'day', 'reaction']],
      },
    });

    if (rows.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A:H`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: {
          values: rows,
        },
      });
    }

    await refreshResultSheet();

    console.log(`Resynced vote sheet from live reactions: ${rows.length} rows.`);

    // Báo rõ kết quả kiểm tra role auto-vote để web hiển thị (trước đây lỗi
    // đọc role bị nuốt âm thầm, web vẫn báo "Đã đồng bộ" dù không có auto-vote).
    const result = {
      ok: true,
      count: rows.length,
      autoVote: {
        count: autoVoteUserIds.length,
        source: autoVote.source,
        error: autoVote.error,
      },
    };

    if (autoVote.source !== 'discord') {
      const sourceLabel = {
        memory: 'dùng danh sách role đọc được lần gần nhất',
        sheet: 'dùng danh sách trong sheet RoleAutoVote',
        none: 'KHÔNG có danh sách auto-vote nào (0 người)',
      }[autoVote.source];
      result.warning = `Không đọc được role auto-vote từ Discord (${autoVote.error}) — ${sourceLabel}.`;
    }

    return result;
  } catch (error) {
    console.error('Failed to resync vote sheet from reactions:', error.message);
    return { ok: false, reason: 'error' };
  }
}

module.exports = {
  ensureVoteSheetExists,
  ensureSheetHeaders,
  resetVoteSheet,
  saveVoteToSheet,
  removeVoteFromSheet,
  ensureAutoVoteSheetExists,
  getAutoVoteRoleMemberIds,
  getAutoVoteRoleMembers,
  syncAutoVoteSheetWithRole,
  removeAutoVoteRowsForUser,
  syncAutoVoteRowsForUser,
  saveAutoVoteRows,
  resyncVoteSheetFromReactions,
};
