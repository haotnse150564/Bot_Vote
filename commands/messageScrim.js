// ===== Lệnh nm!: scrim / vote / BC =====
// nm!scrim, nm!rsvote, nm!us1, nm!us2, nm!reset, nm!code, nm!bc.

const client = require('../client');
const { scrimData, bcData } = require('../state');
const { NPC_ROLE_ID, SCRIM_PING_ROLE_ID, OFFLINE_EMOJI_REACT, AUTOVOTE_EMOJI } = require('../config');
const { getFormattedDateTime } = require('../utils/time');
const {
  formatScrimMessage,
  applyScrimUpdateArgs,
  formatCodeMessage,
  resetScrimData,
} = require('../scrim/format');
const { getActiveDayEmojis, syncScrimReactions } = require('../scrim/reactions');
const { postScrimCode } = require('../scrim/codePost');
const { formatBcMessage } = require('../bc/format');
const { resetVoteSheet, saveAutoVoteRows } = require('../googleSheets/voteSheet');
const { resetOffVoteSheet } = require('../googleSheets/bcSheet');
const { saveState } = require('../googleSheets/stateSheet');

// Trả về true nếu tin nhắn đã được xử lý ở nhóm lệnh này (tương ứng `return;` trong listener gốc).
async function handleScrimMessageCommands(message, content) {
  if (content.toLowerCase() === 'nm!scrim') {
    if (!message.member || !message.member.roles.cache.has(NPC_ROLE_ID)) {
      message.reply('❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.');
      return true;
    }

    const voteMessage = await message.channel.send({
      content: formatScrimMessage(),
      allowedMentions: { roles: SCRIM_PING_ROLE_ID ? [SCRIM_PING_ROLE_ID] : [] }, // ping on creation
    });

    // Lưu messageId để có thể edit sau
    scrimData.messageId = voteMessage.id;
    scrimData.channelId = message.channelId;

    for (const emoji of getActiveDayEmojis()) {
      await voteMessage.react(emoji);
    }
    await voteMessage.react(AUTOVOTE_EMOJI);

    await saveAutoVoteRows(voteMessage);
    await saveState();

    return true;
  }

  if (content.toLowerCase() === 'nm!rsvote') {
    if (!message.member || !message.member.roles.cache.has(NPC_ROLE_ID)) {
      message.reply('❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.');
      return true;
    }

    try {
      await resetVoteSheet();
      message.reply('✅ Đã reset dữ liệu vote scrim trên Google Sheet.');
    } catch (error) {
      console.error('Failed to reset vote sheet:', error.message);
      message.reply('❌ Lỗi khi reset dữ liệu vote.');
    }
    return true;
  }

  if (content.toLowerCase().startsWith('nm!us1')) {
    // Kiểm tra role NPC
    if (!message.member || !message.member.roles.cache.has(NPC_ROLE_ID)) {
      message.reply('❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.');
      return true;
    }

    const rawArgs = content.substring('nm!us1'.length).trim();

    if (!rawArgs) {
      message.reply('Format: `nm!us1 [ngày] ; [giờ,ngày/tháng] ; [đối thủ] ; [số trận]`\nVí dụ:\n`nm!us1 Thứ 5 ; 19:00,20/08/26 ; Server X ; 2`\n`nm!us1 ; 19:00`\n`nm!us1 Thứ 5`\n`nm!us1 ; ; Server X`');
      return true;
    }

    applyScrimUpdateArgs(1, rawArgs);

    scrimData.updatedAt = getFormattedDateTime();

    try {
      if (scrimData.messageId && scrimData.channelId) {
        const channel = await client.channels.fetch(scrimData.channelId);
        const scrimMessage = await channel.messages.fetch(scrimData.messageId);
        await scrimMessage.edit({
          content: formatScrimMessage(),
          allowedMentions: { roles: [] }, // don't re-ping on edit
        });
        await syncScrimReactions(scrimMessage);
      } else {
        const scrimMessage = await message.channel.send({
          content: formatScrimMessage(),
          allowedMentions: { roles: [] }, // no ping (only nm!scrim pings)
        });
        scrimData.messageId = scrimMessage.id;
        scrimData.channelId = message.channelId;

        for (const emoji of getActiveDayEmojis()) {
          await scrimMessage.react(emoji);
        }
        await scrimMessage.react(AUTOVOTE_EMOJI);

        await saveAutoVoteRows(scrimMessage);
      }

      await saveState();
      await message.delete().catch(err => console.error('Failed to delete command message:', err.message));
    } catch (error) {
      console.error('Failed to update scrim message:', error.message);
      message.reply('❌ Lỗi khi cập nhật tin nhắn scrim.');
    }
    return true;
  }

  if (content.toLowerCase().startsWith('nm!us2')) {
    // Kiểm tra role NPC
    if (!message.member || !message.member.roles.cache.has(NPC_ROLE_ID)) {
      message.reply('❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.');
      return true;
    }

    const rawArgs = content.substring('nm!us2'.length).trim();

    if (!rawArgs) {
      message.reply('Format: `nm!us2 [ngày] ; [giờ,ngày/tháng] ; [đối thủ] ; [số trận]`\nVí dụ:\n`nm!us2 Thứ 4 ; 21:00,21/08/26 ; Server Y ; 2`\n`nm!us2 ; 21:00`\n`nm!us2 Thứ 6`\n`nm!us2 ; ; Server Y`');
      return true;
    }

    applyScrimUpdateArgs(2, rawArgs);

    scrimData.updatedAt = getFormattedDateTime();

    try {
      if (scrimData.messageId && scrimData.channelId) {
        const channel = await client.channels.fetch(scrimData.channelId);
        const scrimMessage = await channel.messages.fetch(scrimData.messageId);
        await scrimMessage.edit({
          content: formatScrimMessage(),
          allowedMentions: { roles: [] }, // don't re-ping on edit
        });
        await syncScrimReactions(scrimMessage);
      } else {
        const scrimMessage = await message.channel.send({
          content: formatScrimMessage(),
          allowedMentions: { roles: [] }, // no ping (only nm!scrim pings)
        });
        scrimData.messageId = scrimMessage.id;
        scrimData.channelId = message.channelId;

        for (const emoji of getActiveDayEmojis()) {
          await scrimMessage.react(emoji);
        }
        await scrimMessage.react(AUTOVOTE_EMOJI);

        await saveAutoVoteRows(scrimMessage);
      }

      await saveState();
      await message.delete().catch(err => console.error('Failed to delete command message:', err.message));
    } catch (error) {
      console.error('Failed to update scrim message:', error.message);
      message.reply('❌ Lỗi khi cập nhật tin nhắn scrim.');
    }
    return true;
  }

  if (content.toLowerCase() === 'nm!reset') {
    // Kiểm tra role NPC
    if (!message.member || !message.member.roles.cache.has(NPC_ROLE_ID)) {
      message.reply('❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.');
      return true;
    }

    try {
      // Reset all scrim data
      resetScrimData();
      scrimData.updatedAt = getFormattedDateTime();

      // Update the scrim message
      if (scrimData.messageId && scrimData.channelId) {
        const channel = await client.channels.fetch(scrimData.channelId);
        const scrimMessage = await channel.messages.fetch(scrimData.messageId);
        await scrimMessage.edit({
          content: formatScrimMessage(),
          allowedMentions: { roles: [] }, // don't re-ping on edit
        });
        await syncScrimReactions(scrimMessage);
      }

      await saveState();

      // Xóa lệnh của người dùng
      await message.delete().catch(err => console.error('Failed to delete command message:', err.message));
    } catch (error) {
      console.error('Failed to reset scrim data:', error.message);
      message.reply('❌ Lỗi khi reset thông tin scrim.');
    }
    return true;
  }

  if (content.toLowerCase().startsWith('nm!code')) {
    if (!message.member || !message.member.roles.cache.has(NPC_ROLE_ID)) {
      message.reply('❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.');
      return true;
    }

    const code = content.substring('nm!code'.length).trim();

    if (!code) {
      message.reply('Format: `nm!code [mã code]`\nVí dụ: `nm!code ABC123XYZ`');
      return true;
    }

    // Tin Gift Code luôn được đăng vào kênh code (CODE_CHANNEL_ID) dù lệnh
    // được gõ ở kênh nào. Lỗi (sai kênh/thiếu quyền) thì báo lại và KHÔNG xoá
    // tin lệnh để NPC còn copy lại mã.
    try {
      await postScrimCode(code);
    } catch (error) {
      console.error('Failed to post gift code via nm!code:', error.message);
      message.reply(`❌ Không đăng được Gift Code: ${error.message}`);
      return true;
    }

    await message.delete().catch(err => console.error('Failed to delete command message:', err.message));
    return true;
  }

  if (content.toLowerCase() === 'nm!bc') {
    if (!message.member || !message.member.roles.cache.has(NPC_ROLE_ID)) {
      message.reply('❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.');
      return true;
    }

    try {
      await resetOffVoteSheet();

      const bcContent = formatBcMessage([]);
      // DEBUG TẠM: xem lý do phía trên (commands/slashCommands.js, lệnh /bc).
      console.log('[DEBUG nm!bc] SCRIM_PING_ROLE_ID =', SCRIM_PING_ROLE_ID, '| dòng đầu content =', JSON.stringify(bcContent.split('\n')[0]));

      const bcMessage = await message.channel.send({
        content: bcContent,
        allowedMentions: { roles: SCRIM_PING_ROLE_ID ? [SCRIM_PING_ROLE_ID] : [] },
      });

      bcData.messageId = bcMessage.id;
      bcData.channelId = message.channelId;

      await bcMessage.react(OFFLINE_EMOJI_REACT);
      await saveState();
    } catch (error) {
      console.error('Failed to send bang chien message:', error.message);
      message.reply('❌ Lỗi khi gửi tin nhắn điểm danh bang chiến.');
    }
    return true;
  }

  return false;
}

module.exports = {
  handleScrimMessageCommands,
};
