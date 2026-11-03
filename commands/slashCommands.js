// ===== Slash commands + nút (interaction): điều phối chung =====
// Chỉ giữ các nhóm lệnh của bot Bang + Role:
//   - slashScrim.js    : /scrim /us1 /us2 /reset /code /bc /rsvote /checkvote /topvote + nút Where
//   - slashSrcImage.js : /upload /usi /post /rpost (đã GỘP, xem commands/slashMerged.js)
// + /ping /help. Lệnh của thiKiem/vinhDanh/bcstat/voiceStats/pickRole do module đó tự xử lý.

const { Events } = require('discord.js');
const { resolveMergedCommandName } = require('./slashMerged');
const client = require('../client');
const { getHelpTextChunksForGuild } = require('./help');
const { isBotReady, replyNotReadyToInteraction } = require('../utils/readyGate');
const { WHERE_BUTTON_PREFIX } = require('../where/ui');
const { handleWhereButton, handleScrimSlashCommands } = require('./slashScrim');
const { handleSrcImageSlashCommands } = require('./slashSrcImage');

// Lệnh KHÔNG do file này xử lý (module khác tự nghe InteractionCreate và tự gate "chưa sẵn sàng").
const NON_LOCAL_COMMAND_NAMES = new Set([
  'set-mua-giai', 'xoa-diem-thi-kiem', 'xem-bang-xep-hang-thi-kiem', 'rank', // thiKiem
  'vinhdanh', 'xem-vinh-danh', // vinhDanh
  'bcstat', // bcstat
  'voice', 'voicestats', 'lich', // voiceStats
  'pickrole', // pickRole
]);

client.on(Events.InteractionCreate, async (interaction) => {
  const isLocalButton = interaction.isButton() && interaction.customId.startsWith(WHERE_BUTTON_PREFIX);
  const isLocalCommand = interaction.isChatInputCommand() && !NON_LOCAL_COMMAND_NAMES.has(interaction.commandName);

  if (!isBotReady() && (isLocalButton || isLocalCommand)) {
    await replyNotReadyToInteraction(interaction);
    return;
  }

  if (interaction.isButton()) {
    if (isLocalButton) {
      await handleWhereButton(interaction).catch((error) => {
        console.error('Error handling button interaction:', error.message);
      });
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  // Lệnh gộp (/upload /usi /post /rpost /where + option loai) được dịch về tên lệnh cũ.
  const commandName = resolveMergedCommandName(interaction);

  try {
    if (commandName === 'ping') {
      await interaction.reply('Pong!');
      return;
    }

    if (commandName === 'help') {
      const chunks = getHelpTextChunksForGuild(interaction.guildId);
      await interaction.reply({ content: chunks[0], ephemeral: true });
      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp({ content: chunks[i], ephemeral: true });
      }
      return;
    }

    if (await handleScrimSlashCommands(interaction, commandName)) return;
    if (await handleSrcImageSlashCommands(interaction, commandName)) return;
  } catch (error) {
    console.error(`Error handling slash command /${commandName}:`, error.message);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply('❌ Đã xảy ra lỗi khi xử lý lệnh.').catch(() => {});
    } else {
      await interaction.reply({ content: '❌ Đã xảy ra lỗi khi xử lý lệnh.', ephemeral: true }).catch(() => {});
    }
  }
});
