// ===== Lệnh nm! (message commands): điều phối chung =====
// Chỉ giữ các nhóm lệnh của bot Bang + Role:
//   - messageScrim.js     : nm!scrim / rsvote / us1 / us2 / reset / code / bc
//   - messageReminders.js : nm!testbc / testgcmn / testscrim1-2
//   - messageVote.js      : nm!checkvote / topvote
//   - messageSrcImage.js  : nm!upload* / usi / ubci / post* / rpost* / where*
// + nm!help / nm!ping.

const { Events } = require('discord.js');
const client = require('../client');
const { getHelpTextChunksForGuild } = require('./help');
const { isBotReady, replyNotReadyToMessage } = require('../utils/readyGate');
const { handleScrimMessageCommands } = require('./messageScrim');
const { handleReminderMessageCommands } = require('./messageReminders');
const { handleVoteMessageCommands } = require('./messageVote');
const { handleSrcImageMessageCommands } = require('./messageSrcImage');

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const content = message.content.trim();

  // Bot chưa nạp xong dữ liệu khởi động (xem utils/readyGate.js) — chỉ chặn tin bắt đầu bằng "nm!".
  if (content.toLowerCase().startsWith('nm!') && !isBotReady()) {
    await replyNotReadyToMessage(message);
    return;
  }

  try {
    if (await handleScrimMessageCommands(message, content)) return;
    if (await handleReminderMessageCommands(message, content)) return;
    if (await handleVoteMessageCommands(message, content)) return;
    if (await handleSrcImageMessageCommands(message, content)) return;

    if (content.toLowerCase() === 'nm!help') {
      // Help dài hơn 2000 ký tự/tin -> chia nhỏ và gửi nhiều tin nối tiếp.
      const chunks = getHelpTextChunksForGuild(message.guild?.id);
      await message.reply(chunks[0]);
      for (let i = 1; i < chunks.length; i++) {
        await message.channel.send(chunks[i]);
      }
      return;
    }

    if (content.toLowerCase() === 'nm!ping') {
      await message.reply('Pong!');
    }
  } catch (error) {
    console.error('Lỗi xử lý lệnh nm!:', error.message);
  }
});
