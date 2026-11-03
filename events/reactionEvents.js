const { Events } = require('discord.js');
const client = require('../client');
const { scrimData, bcData } = require('../state');
const { DAY_REACTIONS, OFFLINE_EMOJI_ID, AUTOVOTE_EMOJI, AUTOVOTE_ROLE_ID } = require('../config');
const { addOffVote, removeOffVote } = require('../googleSheets/bcSheet');
const {
  saveVoteToSheet,
  removeVoteFromSheet,
  syncAutoVoteRowsForUser,
  syncAutoVoteSheetWithRole,
} = require('../googleSheets/voteSheet');

// Quy tắc vote (chi tiết ở googleSheets/voteRows.js):
//   - Bot chỉ HỖ TRỢ: người có role auto-vote mà CHƯA tự tích gì thì bot điền
//     Thứ 4/5/6 hộ.
//   - Khi người đó tự tích tay (4️⃣5️⃣6️⃣0️⃣) thì bot thôi điền hộ, vote của họ
//     đúng bằng những gì họ tự tích.
//   - Nếu họ gỡ hết vote tay mà vẫn còn role thì bot điền lại auto (không để trắng).

// Chỉ tính vote ngày trên ĐÚNG tin vote scrim đang hoạt động. Trước đây react
// 4️⃣5️⃣6️⃣0️⃣ trên BẤT KỲ tin nào (kể cả tin vote các tuần cũ còn nằm trong kênh)
// cũng bị ghi vào sheet của tuần này và xoá auto của người đó.
function isCurrentScrimMessage(message) {
  return Boolean(scrimData.messageId) && message.id === scrimData.messageId;
}

function getGuild(message) {
  return message.guild || (message.guildId ? client.guilds.cache.get(message.guildId) : null);
}

// Người này hiện có role auto-vote không? Lỗi đọc -> false (không tự điền hộ).
async function userHasAutoVoteRole(guild, userId) {
  if (!guild) return false;

  try {
    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId);
    return member.roles.cache.has(AUTOVOTE_ROLE_ID);
  } catch (error) {
    console.error(`[auto-vote] Không đọc được role của user ${userId}:`, error.message);
    return false;
  }
}

function displayName(user) {
  return user.username || user.tag || user.id;
}

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;

  const message = reaction.message;

  // Bang chiến offline check-in
  if (
    reaction.emoji.id === OFFLINE_EMOJI_ID &&
    bcData.messageId &&
    message.id === bcData.messageId
  ) {
    await addOffVote(user.id);
    return;
  }

  // Auto-vote signup: react ✅ on the current scrim vote message once.
  // The role assignment IS the source of truth; the sheet is just synced as a log.
  if (
    reaction.emoji.name === AUTOVOTE_EMOJI &&
    isCurrentScrimMessage(message) &&
    message.guild
  ) {
    try {
      const member = await message.guild.members.fetch(user.id);
      await member.roles.add(AUTOVOTE_ROLE_ID);

      // Điền vote auto cho tuần này NGAY (trừ khi người này đã vote tay).
      await syncAutoVoteRowsForUser({
        guildId: message.guildId,
        channelId: message.channelId,
        messageId: message.id,
        userId: user.id,
        username: displayName(user),
        enabled: true,
      });

      await syncAutoVoteSheetWithRole(message.guild, { force: true });
    } catch (error) {
      console.error(`Failed to add auto-vote role to user ${user.id}:`, error.message);
    }
    return;
  }

  const day = DAY_REACTIONS[reaction.emoji.name];

  if (day === undefined || !isCurrentScrimMessage(message)) {
    return;
  }

  // Vote tay: saveVoteToSheet tự xoá vote auto của người này (nếu có) rồi ghi
  // đúng ngày họ vừa tích — trong cùng 1 lượt khoá nên tích liên tiếp nhiều
  // ngày không còn xoá nhầm dòng của nhau/của người khác.
  await saveVoteToSheet({
    guildId: message.guildId || 'dm',
    channelId: message.channelId,
    messageId: message.id,
    userId: user.id,
    username: displayName(user),
    day,
    reaction: reaction.emoji.name,
  });

});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  if (user.bot) return;

  const message = reaction.message;

  // Bang chiến offline check-in
  if (
    reaction.emoji.id === OFFLINE_EMOJI_ID &&
    bcData.messageId &&
    message.id === bcData.messageId
  ) {
    await removeOffVote(user.id);
    return;
  }

  // Auto-vote opt-out: removed ✅ react from the current scrim vote message.
  // The role removal IS the source of truth; the sheet is just synced as a log.
  if (
    reaction.emoji.name === AUTOVOTE_EMOJI &&
    isCurrentScrimMessage(message) &&
    message.guild
  ) {
    try {
      const member = await message.guild.members.fetch(user.id);
      await member.roles.remove(AUTOVOTE_ROLE_ID);

      // Bỏ vote auto của người này (vote tay nếu có thì giữ nguyên).
      await syncAutoVoteRowsForUser({
        guildId: message.guildId,
        channelId: message.channelId,
        messageId: message.id,
        userId: user.id,
        username: displayName(user),
        enabled: false,
      });

      await syncAutoVoteSheetWithRole(message.guild, { force: true });
    } catch (error) {
      console.error(`Failed to remove auto-vote role from user ${user.id}:`, error.message);
    }
    return;
  }

  const day = DAY_REACTIONS[reaction.emoji.name];

  if (day === undefined || !isCurrentScrimMessage(message)) {
    return;
  }

  // Gỡ 1 ngày vote tay. Nếu người này còn role auto-vote và gỡ xong không còn
  // vote tay nào thì bot điền lại Thứ 4/5/6 (removeVoteFromSheet xử lý).
  const hasRole = await userHasAutoVoteRole(getGuild(message), user.id);

  await removeVoteFromSheet(user.id, day, {
    restoreAuto: hasRole
      ? {
          guildId: message.guildId || 'dm',
          channelId: message.channelId,
          messageId: message.id,
          username: displayName(user),
        }
      : null,
  });
});
