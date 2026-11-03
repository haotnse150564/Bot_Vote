// ===== Slash: scrim / vote / BC / where =====
// /scrim, /us1, /us2, /reset, /code, /bc, /rsvote, /checkvote, /topvote, /testbc, /testgcmn,
// /testscrim1-2, /wherebc, /wherescrim1-2 và nút Where (handleWhereButton).

const client = require('../client');
const { scrimData, bcData } = require('../state');
const {
  NPC_ROLE_ID,
  SCRIM_PING_ROLE_ID,
  OFFLINE_EMOJI_REACT,
  AUTOVOTE_EMOJI,
  BC_REMINDER_CHANNEL_ID,
  SCRIM_REMINDER_CHANNEL_ID,
  GUILD_REMINDER_CHANNEL_ID,
  WHERE_LOCATION_LABELS,
} = require('../config');
const { getFormattedDateTime } = require('../utils/time');
const {
  formatScrimMessage,
  formatCodeMessage,
  resetScrimData,
  normalizeScrimDay,
} = require('../scrim/format');
const { getActiveDayEmojis, syncScrimReactions } = require('../scrim/reactions');
const { postScrimCode } = require('../scrim/codePost');
const { formatBcMessage } = require('../bc/format');
const {
  resetVoteSheet,
  saveAutoVoteRows,
  resyncVoteSheetFromReactions,
} = require('../googleSheets/voteSheet');
const { getTopVoters } = require('../googleSheets/topVoteSheet');
const { formatTopVoteMessage } = require('../voteStatus/topVoteFormat');
const { resetOffVoteSheet } = require('../googleSheets/bcSheet');
const { saveState } = require('../googleSheets/stateSheet');
const { getUserLocationInfo } = require('../googleSheets/listSheet');
const { sendReminderMessage } = require('../reminders/scheduler');
const {
  formatBcReminderMessage,
  formatGcmnReminderMessage,
  formatScrimReminderMessage,
} = require('../reminders/format');
const { formatWhereMessage } = require('../where/format');
const {
  WHERE_BUTTON_PREFIX,
  buildWhereActionRow,
  buildWhereEmbed,
  getWhereDayLabel,
} = require('../where/ui');

// Xử lý khi ai đó bấm nút "Xem Vị Trí Của Bạn" — luôn trả lời ephemeral
// (chỉ người bấm thấy), lấy Discord ID của chính người bấm để so khớp cột A
// trong tab "Nhật Ký Đội Hình", không liên quan gì tới người tạo lệnh gốc.
async function handleWhereButton(interaction) {
  const key = interaction.customId.slice(WHERE_BUTTON_PREFIX.length); // 'bc' | 'scrim1' | 'scrim2'

  await interaction.deferReply({ ephemeral: true });

  try {
    const info = await getUserLocationInfo(key, interaction.user.id);

    if (!info) {
      await interaction.editReply('❌ Không tìm thấy thông tin của bạn trong danh sách. Liên hệ NPC để được thêm vào.');
      return;
    }

    await interaction.editReply(formatWhereMessage(key, info));
  } catch (error) {
    console.error(`Failed to fetch where-location info (${key}):`, error.message);
    await interaction.editReply('❌ Lỗi khi lấy thông tin từ Google Sheet.');
  }
}
// Trả về true nếu interaction đã được xử lý ở nhóm lệnh này (tương ứng `return;` trong listener gốc).
async function handleScrimSlashCommands(interaction, commandName) {
    if (commandName === 'scrim') {
      if (!interaction.member.roles.cache.has(NPC_ROLE_ID)) {
        await interaction.reply({ content: '❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.', ephemeral: true });
        return true;
      }

      // Option b1_*/b2_* — TẤT CẢ optional, cho phép điền luôn thông tin
      // Buổi 1/Buổi 2 ngay lúc tạo /scrim thay vì phải gọi thêm /us1 /us2
      // ngay sau đó. Không nhập gì thì scrimData giữ nguyên như cũ (tin
      // trống, điền sau bằng /us1 /us2 như trước giờ).
      for (const session of [1, 2]) {
        const prefix = `b${session}_`;
        const day = interaction.options.getString(`${prefix}ngay`);
        const time = interaction.options.getString(`${prefix}gio`);
        const date = interaction.options.getString(`${prefix}ngaythang`);
        const opponent = interaction.options.getString(`${prefix}doithu`);
        const matches = interaction.options.getString(`${prefix}sotran`);

        if (day) scrimData[`session${session}Day`] = normalizeScrimDay(day);
        if (time) scrimData[`session${session}Time`] = time;
        if (date) scrimData[`session${session}Date`] = date;
        if (opponent) scrimData[`session${session}Opponent`] = opponent;
        if (matches) scrimData[`session${session}Matches`] = matches;
      }
      scrimData.updatedAt = getFormattedDateTime();

      await interaction.reply({
        content: formatScrimMessage(),
        allowedMentions: { roles: SCRIM_PING_ROLE_ID ? [SCRIM_PING_ROLE_ID] : [] },
      });

      const sentMessage = await interaction.fetchReply();
      scrimData.messageId = sentMessage.id;
      scrimData.channelId = sentMessage.channelId;

      for (const emoji of getActiveDayEmojis()) {
        await sentMessage.react(emoji);
      }
      await sentMessage.react(AUTOVOTE_EMOJI);

      await saveAutoVoteRows(sentMessage);
      await saveState();
      return true;
    }

    if (commandName === 'wherebc' || commandName === 'wherescrim1' || commandName === 'wherescrim2') {
      if (!interaction.member.roles.cache.has(NPC_ROLE_ID)) {
        await interaction.reply({ content: '❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.', ephemeral: true });
        return true;
      }

      const key = commandName.replace('where', ''); // 'bc' | 'scrim1' | 'scrim2'
      const label = WHERE_LOCATION_LABELS[key] || key;
      const dayLabel = getWhereDayLabel(key, scrimData);

      await interaction.reply({
        embeds: [buildWhereEmbed(label, dayLabel)],
        components: [buildWhereActionRow(key)],
      });
      return true;
    }

    if (commandName === 'rsvote') {
      if (!interaction.member.roles.cache.has(NPC_ROLE_ID)) {
        await interaction.reply({ content: '❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.', ephemeral: true });
        return true;
      }

      await interaction.deferReply({ ephemeral: true });

      try {
        await resetVoteSheet();
        await interaction.editReply('✅ Đã reset dữ liệu vote scrim trên Google Sheet.');
      } catch (error) {
        console.error('Failed to reset vote sheet via slash command:', error.message);
        await interaction.editReply('❌ Lỗi khi reset dữ liệu vote.');
      }
      return true;
    }

    if (commandName === 'us1' || commandName === 'us2') {
      if (!interaction.member.roles.cache.has(NPC_ROLE_ID)) {
        await interaction.reply({ content: '❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.', ephemeral: true });
        return true;
      }

      const day = interaction.options.getString('ngay');
      const time = interaction.options.getString('gio');
      const date = interaction.options.getString('ngaythang');
      const opponent = interaction.options.getString('doithu');
      const matches = interaction.options.getString('sotran');

      if (!day && !time && !date && !opponent && !matches) {
        await interaction.reply({ content: 'Bạn cần nhập ít nhất một trong các trường: ngày, giờ, ngày/tháng, đối thủ, số trận.', ephemeral: true });
        return true;
      }

      const session = commandName === 'us1' ? 1 : 2;

      if (day) scrimData[`session${session}Day`] = normalizeScrimDay(day);
      if (time) scrimData[`session${session}Time`] = time;
      if (date) scrimData[`session${session}Date`] = date;
      if (opponent) scrimData[`session${session}Opponent`] = opponent;
      if (matches) scrimData[`session${session}Matches`] = matches;

      scrimData.updatedAt = getFormattedDateTime();

      await interaction.deferReply({ ephemeral: true });

      try {
        if (scrimData.messageId && scrimData.channelId) {
          const channel = await client.channels.fetch(scrimData.channelId);
          const scrimMessage = await channel.messages.fetch(scrimData.messageId);
          await scrimMessage.edit({
            content: formatScrimMessage(),
            allowedMentions: { roles: [] },
          });
          await syncScrimReactions(scrimMessage);
        } else {
          const scrimMessage = await interaction.channel.send({
            content: formatScrimMessage(),
            allowedMentions: { roles: [] },
          });
          scrimData.messageId = scrimMessage.id;
          scrimData.channelId = scrimMessage.channelId;

          for (const emoji of getActiveDayEmojis()) {
            await scrimMessage.react(emoji);
          }
          await scrimMessage.react(AUTOVOTE_EMOJI);

          await saveAutoVoteRows(scrimMessage);
        }

        await saveState();
        await interaction.editReply('✅ Đã cập nhật lịch scrim.');
      } catch (error) {
        console.error('Failed to update scrim message via slash command:', error.message);
        await interaction.editReply('❌ Lỗi khi cập nhật tin nhắn scrim.');
      }
      return true;
    }

    if (commandName === 'reset') {
      if (!interaction.member.roles.cache.has(NPC_ROLE_ID)) {
        await interaction.reply({ content: '❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.', ephemeral: true });
        return true;
      }

      resetScrimData();
      scrimData.updatedAt = getFormattedDateTime();

      await interaction.deferReply({ ephemeral: true });

      try {
        if (scrimData.messageId && scrimData.channelId) {
          const channel = await client.channels.fetch(scrimData.channelId);
          const scrimMessage = await channel.messages.fetch(scrimData.messageId);
          await scrimMessage.edit({
            content: formatScrimMessage(),
            allowedMentions: { roles: [] },
          });
          await syncScrimReactions(scrimMessage);
        }

        await saveState();
        await interaction.editReply('✅ Đã reset thông tin lịch scrim.');
      } catch (error) {
        console.error('Failed to reset scrim data via slash command:', error.message);
        await interaction.editReply('❌ Lỗi khi reset thông tin scrim.');
      }
      return true;
    }

    if (commandName === 'code') {
      if (!interaction.member.roles.cache.has(NPC_ROLE_ID)) {
        await interaction.reply({ content: '❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.', ephemeral: true });
        return true;
      }

      const code = interaction.options.getString('code');

      // Tin Gift Code luôn được đăng vào kênh code (CODE_CHANNEL_ID) dù lệnh
      // được gõ ở kênh nào; người gõ lệnh chỉ nhận xác nhận ẩn.
      await interaction.deferReply({ ephemeral: true });

      try {
        const sent = await postScrimCode(code);
        await interaction.editReply(`✅ Đã đăng Gift Code vào <#${sent.channelId}>.`);
      } catch (error) {
        console.error('Failed to post gift code via /code:', error.message);
        await interaction.editReply(`❌ Không đăng được Gift Code: ${error.message}`);
      }
      return true;
    }

    if (commandName === 'bc') {
      if (!interaction.member.roles.cache.has(NPC_ROLE_ID)) {
        await interaction.reply({ content: '❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.', ephemeral: true });
        return true;
      }

      // defer ẩn (chỉ mình người dùng lệnh thấy "Đang xử lý...") — tin thật
      // được gửi bằng channel.send() bên dưới (KHÔNG dùng followUp()).
      // LÝ DO đổi từ followUp() sang channel.send():
      // Discord API/discord.js KHÔNG cho followUp() "lật ngược" trạng thái
      // ephemeral của deferReply() ban đầu — deferReply({ephemeral:true}) rồi
      // followUp({ephemeral:false}) vẫn bị Discord coi là ephemeral (chỉ
      // người dùng lệnh thấy được), bất kể truyền ephemeral:false rõ ràng.
      // Message trả về LÀ 1 tin ẩn trá hình: reactions.js gọi
      // sentMessage.react() ngay sau đó luôn văng DiscordAPIError[10008]:
      // Unknown Message vì bot không thể react vào tin ẩn (xem discord.js
      // issue #6465/#6467). channel.send() gửi 1 tin thường vào kênh, hoàn
      // toàn tách khỏi trạng thái ephemeral của interaction nên react() và
      // ping role đều hoạt động đúng như /scrim.
      await interaction.deferReply({ ephemeral: true });

      await resetOffVoteSheet();

      const bcContent = formatBcMessage([]);
      // DEBUG TẠM: xác nhận bản code đang chạy có ghép đúng role tag không,
      // và giá trị SCRIM_PING_ROLE_ID thực tế lúc runtime là gì. Xoá dòng
      // này sau khi xác định xong nguyên nhân lỗi "/bc không tag role".
      console.log('[DEBUG /bc] SCRIM_PING_ROLE_ID =', SCRIM_PING_ROLE_ID, '| dòng đầu content =', JSON.stringify(bcContent.split('\n')[0]));

      const sentMessage = await interaction.channel.send({
        content: bcContent,
        allowedMentions: { roles: SCRIM_PING_ROLE_ID ? [SCRIM_PING_ROLE_ID] : [] },
      });

      bcData.messageId = sentMessage.id;
      bcData.channelId = sentMessage.channelId;

      await sentMessage.react(OFFLINE_EMOJI_REACT);
      await saveState();

      // Xoá tin "Đang xử lý..." (defer) ban đầu vì tin thật đã gửi xong qua channel.send()
      await interaction.deleteReply();
      return true;
    }

    if (commandName === 'checkvote') {
      if (!interaction.member.roles.cache.has(NPC_ROLE_ID)) {
        await interaction.reply({ content: '❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.', ephemeral: true });
        return true;
      }

      if (!scrimData.messageId || !scrimData.channelId) {
        await interaction.reply({ content: '❌ Chưa có tin nhắn vote scrim nào đang hoạt động. Hãy chạy `/scrim` trước.', ephemeral: true });
        return true;
      }

      await interaction.deferReply({ ephemeral: true });

      const result = await resyncVoteSheetFromReactions();

      if (result.ok) {
        await interaction.editReply(`✅ Đã đồng bộ lại thành công (${result.count} lượt vote) dựa trên react thực tế trên Discord.`);
      } else {
        await interaction.editReply('❌ Lỗi khi đồng bộ lại vote. Kiểm tra log của bot để biết chi tiết.');
      }
      return true;
    }

    if (commandName === 'topvote') {
      // Ai cũng xem được (không cần role NPC) — chỉ là xem bảng xếp hạng.
      await interaction.deferReply();

      const topVoters = await getTopVoters(10);

      if (topVoters === null) {
        await interaction.editReply('❌ Lỗi khi đọc Bảng Xếp Hạng Chuyên Cần Vote. Kiểm tra log của bot để biết chi tiết.');
        return true;
      }

      await interaction.editReply(formatTopVoteMessage(topVoters));
      return true;
    }

    if (commandName === 'testbc') {
      if (!interaction.member.roles.cache.has(NPC_ROLE_ID)) {
        await interaction.reply({ content: '❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.', ephemeral: true });
        return true;
      }

      await sendReminderMessage(formatBcReminderMessage(), BC_REMINDER_CHANNEL_ID);
      await interaction.reply({ content: '✅ Đã gửi thử tin nhắc Bang Chiến.', ephemeral: true });
      return true;
    }

    if (commandName === 'testgcmn') {
      if (!interaction.member.roles.cache.has(NPC_ROLE_ID)) {
        await interaction.reply({ content: '❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.', ephemeral: true });
        return true;
      }

      await sendReminderMessage(formatGcmnReminderMessage(), GUILD_REMINDER_CHANNEL_ID);
      await interaction.reply({ content: '✅ Đã gửi thử tin nhắc Giải Cứu Mỹ Nhân.', ephemeral: true });
      return true;
    }

    if (commandName === 'testscrim1' || commandName === 'testscrim2') {
      if (!interaction.member.roles.cache.has(NPC_ROLE_ID)) {
        await interaction.reply({ content: '❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.', ephemeral: true });
        return true;
      }

      if (commandName === 'testscrim1') {
        await sendReminderMessage(formatScrimReminderMessage('Buổi 1', scrimData.session1Opponent, scrimData.session1Matches), SCRIM_REMINDER_CHANNEL_ID);
      } else {
        await sendReminderMessage(formatScrimReminderMessage('Buổi 2', scrimData.session2Opponent, scrimData.session2Matches), SCRIM_REMINDER_CHANNEL_ID);
      }

      await interaction.reply({ content: '✅ Đã gửi thử tin nhắc Scrim.', ephemeral: true });
      return true;
    }

  return false;
}

module.exports = {
  handleWhereButton,
  handleScrimSlashCommands,
};
