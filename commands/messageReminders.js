// ===== Lệnh nm!: test tin nhắc lịch (Bang Chiến / GCMN / Scrim) =====
// nm!testbc, nm!testgcmn, nm!testscrim1, nm!testscrim2 — chỉ NPC.

const { NPC_ROLE_ID, BC_REMINDER_CHANNEL_ID, SCRIM_REMINDER_CHANNEL_ID, GUILD_REMINDER_CHANNEL_ID } = require('../config');
const { sendReminderMessage } = require('../reminders/scheduler');
const { formatBcReminderMessage, formatGcmnReminderMessage, formatScrimReminderMessage } = require('../reminders/format');
const { scrimData } = require('../state');

// Trả về true nếu tin nhắn đã được xử lý.
async function handleReminderMessageCommands(message, content) {
  if (content.toLowerCase() === 'nm!testbc') {
    if (!message.member || !message.member.roles.cache.has(NPC_ROLE_ID)) {
      message.reply('❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.');
      return true;
    }

    await sendReminderMessage(formatBcReminderMessage(), BC_REMINDER_CHANNEL_ID);
    return true;
  }

  if (content.toLowerCase() === 'nm!testgcmn') {
    if (!message.member || !message.member.roles.cache.has(NPC_ROLE_ID)) {
      message.reply('❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.');
      return true;
    }

    await sendReminderMessage(formatGcmnReminderMessage(), GUILD_REMINDER_CHANNEL_ID);
    return true;
  }

  if (content.toLowerCase() === 'nm!testscrim1') {
    if (!message.member || !message.member.roles.cache.has(NPC_ROLE_ID)) {
      message.reply('❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.');
      return true;
    }

    await sendReminderMessage(formatScrimReminderMessage('Buổi 1', scrimData.session1Opponent, scrimData.session1Matches), SCRIM_REMINDER_CHANNEL_ID);
    return true;
  }

  if (content.toLowerCase() === 'nm!testscrim2') {
    if (!message.member || !message.member.roles.cache.has(NPC_ROLE_ID)) {
      message.reply('❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.');
      return true;
    }

    await sendReminderMessage(formatScrimReminderMessage('Buổi 2', scrimData.session2Opponent, scrimData.session2Matches), SCRIM_REMINDER_CHANNEL_ID);
    return true;
  }

  return false;
}

module.exports = { handleReminderMessageCommands };
