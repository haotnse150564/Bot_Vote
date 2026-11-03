// ===== Thí Kiếm: Tra Rank (nút "🔍 Xem Rank" / nm!rank / `/rank`) =====
// Tách khỏi index.js.

const client = require('../client');
const { HUB_CHANNEL_ID, THIKIEM_BOARD_CHANNEL_ID } = require('../config');
const { chatChannels } = require('../state');
const {
  getSeasonConfig,
  getBangRankEntries,
  getRankEntryByDiscordId,
} = require('../googleSheets/thiKiemSheet');
const { isBotReady, replyNotReadyToMessage } = require('../utils/readyGate');
const { formatRankCardEmbed } = require('./format');

// ===== Tra Rank (nút "🔍 Xem Rank" / nm!rank / `/rank`) =====
// Hiển thị CÔNG KHAI (bình thường trong kênh) nếu kênh đang gõ lệnh nằm
// trong danh sách "kênh chat được phép" của server (state.chatChannels —
// cùng danh sách dùng cho tính năng AI tự trả lời, cấu hình qua
// nm!setchatchannel//removechatchannel), ngược lại trả RIÊNG TƯ (ephemeral
// cho slash/nút, gửi tạm ngay tại kênh rồi tự xoá sau 10 giây — kèm xoá
// luôn tin lệnh gốc — cho nm!rank, KHÔNG DM) để tránh làm rác các kênh
// khác (đặc biệt kênh Đua Rank chỉ nên có đúng 2 tin cố định).
function isAllowedChatChannel(guildId, channelId) {
  if (!guildId || !channelId) return false;
  const allowed = chatChannels[guildId] || [];
  return allowed.includes(channelId);
}

// Chấp nhận Discord ID dạng số HOẶC @mention (<@ID>/<@!ID>) cho tham số
// người cần tra ở nm!rank/`/rank` — trả về ID số (string) hoặc null nếu
// input không rỗng nhưng cũng không hợp lệ.
function resolveMentionOrIdToken(token) {
  if (!token) return null;
  const trimmed = token.trim();
  const mentionMatch = trimmed.match(/^<@!?(\d{15,25})>$/);
  if (mentionMatch) return mentionMatch[1];
  return /^\d{15,25}$/.test(trimmed) ? trimmed : null;
}

// Build embed rank card cho 1 Discord ID — trả về null nếu người này CHƯA
// TỪNG cập nhật điểm (không có dòng nào trong sheet), để nơi gọi tự báo lỗi
// theo đúng văn phong của từng entry point (message/slash/button).
// targetUser: cố gắng fetch User qua client (lấy avatar/username hiển thị
// đẹp hơn) nhưng KHÔNG bắt buộc — fetch lỗi (rời server, ID sai định dạng
// nhưng tình cờ có sheet...) vẫn cứ build embed bình thường, chỉ thiếu avatar.
async function buildRankCardEmbedForId(discordId) {
  const entry = await getRankEntryByDiscordId(discordId);
  if (!entry || entry.diem === null || entry.diem === undefined) return null;

  // "Hạng Tổng" (entry.hang) đã có sẵn trong sheet (ghi lại mỗi lần
  // recomputeRanksAndGetLeaderboard chạy), nhưng "Hạng Hệ Phái" (thứ hạng
  // CHỈ TRONG PHẠM VI Class của người này) thì KHÔNG có cột riêng trong
  // sheet — phải tự tính động mỗi lần xem rank bằng cách lọc toàn bộ danh
  // sách theo đúng Class rồi sort lại theo điểm giảm dần (giống hệt cách
  // formatLeaderboardEmbed làm khi bấm tab 1 Class trên Bảng Xếp Hạng).
  let hangHePhai = null;
  if (entry.className) {
    const allEntries = await getBangRankEntries();
    const sameClass = allEntries
      .filter((e) => (e.className || '').trim() === entry.className)
      .sort((a, b) => (b.diem ?? -Infinity) - (a.diem ?? -Infinity));
    const idx = sameClass.findIndex((e) => e.discordId === String(discordId));
    if (idx >= 0) hangHePhai = idx + 1;
  }

  let targetUser = null;
  try {
    targetUser = await client.users.fetch(discordId);
  } catch (error) {
    targetUser = null;
  }

  const seasonConfig = await getSeasonConfig();
  return formatRankCardEmbed(targetUser, { ...entry, hangHePhai }, seasonConfig);
}

// Trả kết quả (embed) cho 1 lệnh dạng tin nhắn thường (nm!rank) gõ ở kênh
// KHÔNG nằm trong danh sách "kênh chat được phép" — KHÔNG DM nữa (theo yêu
// cầu), gửi thẳng NGAY TẠI kênh người dùng vừa gõ lệnh, hiện trong 10 giây
// rồi tự xoá cả tin trả lời của bot LẪN tin lệnh "nm!rank" gốc, để không
// làm rác các kênh không phải kênh chat chính thức.
async function sendPrivateEmbedResult(originalMessage, discordId, embed) {
  try {
    const notice = await originalMessage.channel.send({
      content: `<@${discordId}>`,
      embeds: [embed],
      allowedMentions: { users: [discordId] },
    });
    setTimeout(() => {
      notice.delete().catch(() => {});
      originalMessage.delete().catch(() => {});
    }, 10_000);
  } catch (error) {
    console.error('Không gửi được rank card (nm!rank):', error.message);
  }
}

// Bấm nút "🔍 Xem Rank" -> LUÔN trả rank card của CHÍNH NGƯỜI BẤM (không có
// input để chọn người khác qua nút — muốn xem người khác thì dùng
// nm!rank/`/rank`). Public/riêng tư tuỳ kênh đang bấm (isAllowedChatChannel)
// — nút này nằm trong kênh Đua Rank nên gần như luôn ra ephemeral (giữ đúng
// quy tắc kênh chỉ có 2 tin cố định), TRỪ KHI NPC lỡ thêm chính kênh đó vào
// danh sách kênh chat được phép.
async function handleThiKiemViewRankButton(interaction) {
  // Kênh Hub luôn trả riêng tư (ephemeral), kể cả khi lỡ nằm trong danh sách kênh chat.
  const forcePrivate = interaction.channelId === HUB_CHANNEL_ID;
  await interaction.deferReply({ ephemeral: forcePrivate || !isAllowedChatChannel(interaction.guildId, interaction.channelId) });

  const embed = await buildRankCardEmbedForId(interaction.user.id);
  if (!embed) {
    await interaction.editReply({
      content: '❌ Bạn chưa có dữ liệu Đua Rank Thí Kiếm nào — hãy gửi ảnh cập nhật điểm trước.',
    });
    return;
  }
  await interaction.editReply({ embeds: [embed] });
}

// ===== nm!rank [@mention|discordId] — dùng được ở MỌI kênh, TRỪ kênh Đua
// Rank (THIKIEM_BOARD_CHANNEL_ID) =====
// Kênh Đua Rank CHỈ nhận đúng 2 cách gửi điểm (bấm nút hoặc gửi ảnh thẳng),
// tra rank ở kênh đó phải bấm nút "🔍 Xem Rank" — gõ nm!rank trong kênh này
// bị updateHandlers.js::handleBoardChannelMessage (listener MessageCreate cho
// THIKIEM_BOARD_CHANNEL_ID) tự xoá như tin nhắn không hợp lệ, nên ở ĐÂY
// cũng return sớm luôn (khỏi tốn 1 lượt gọi sheet + reply rồi lại bị dọn).
// Không truyền gì -> xem rank của chính mình. Truyền @mention hoặc Discord
// ID -> xem rank người đó (ai cũng tra được người khác, không cần role gì).
// Public/riêng tư tuỳ kênh gõ lệnh có nằm trong danh sách "kênh chat được
// phép" hay không (isAllowedChatChannel) — xem giải thích đầy đủ ở hàm đó.
async function handleRankMessageCommand(message) {
  try {
    if (message.author.bot) return;
    if (THIKIEM_BOARD_CHANNEL_ID && message.channelId === THIKIEM_BOARD_CHANNEL_ID) return;
    const content = (message.content || '').trim();
    if (!/^nm!rank(\s|$)/i.test(content)) return;

    if (!isBotReady()) {
      await replyNotReadyToMessage(message);
      return;
    }

    const rawArg = content.replace(/^nm!rank/i, '').trim();
    let targetId = message.author.id;
    if (rawArg) {
      const resolved = resolveMentionOrIdToken(rawArg.split(/\s+/)[0]);
      if (!resolved) {
        await message.reply('❌ ID Discord không hợp lệ. Dùng `nm!rank` để xem rank của bạn, hoặc `nm!rank @mention`/`nm!rank <discord-id>` để xem người khác.');
        return;
      }
      targetId = resolved;
    }

    const embed = await buildRankCardEmbedForId(targetId);
    if (!embed) {
      await message.reply(
        targetId === message.author.id
          ? '❌ Bạn chưa có dữ liệu Đua Rank Thí Kiếm nào — hãy gửi ảnh cập nhật điểm trước.'
          : `❌ <@${targetId}> chưa có dữ liệu Đua Rank Thí Kiếm nào.`
      );
      return;
    }

    if (isAllowedChatChannel(message.guildId, message.channelId)) {
      await message.channel.send({ embeds: [embed] });
    } else {
      await sendPrivateEmbedResult(message, message.author.id, embed);
    }
  } catch (error) {
    console.error('Lỗi xử lý lệnh nm!rank:', error.message);
  }
}

// `/rank [user]` — không chọn user thì xem rank của chính mình, chọn user
// thì xem rank người đó (ai cũng dùng được lên bất kỳ ai). Public/riêng tư
// tuỳ kênh gọi lệnh — xem isAllowedChatChannel(). Riêng kênh Đua Rank
// (THIKIEM_BOARD_CHANNEL_ID) không cho dùng `/rank` ở đây nữa — kênh đó chỉ
// nhận bấm nút hoặc gửi ảnh, tra rank trong kênh này phải bấm nút "🔍 Xem
// Rank" (cạnh nút cập nhật điểm), dùng `/rank` thì gõ ở kênh khác.
async function handleRankSlashCommand(interaction) {
  if (THIKIEM_BOARD_CHANNEL_ID && interaction.channelId === THIKIEM_BOARD_CHANNEL_ID) {
    await interaction.reply({
      content: '❌ Kênh này chỉ để xem bảng xếp hạng. Dùng `/rank` ở kênh khác, hoặc vào menu ở kênh Hub để tra rank.',
      ephemeral: true,
    });
    return;
  }

  const targetUser = interaction.options.getUser('user') || interaction.user;
  const isPublic = isAllowedChatChannel(interaction.guildId, interaction.channelId);

  await interaction.deferReply({ ephemeral: !isPublic });

  const embed = await buildRankCardEmbedForId(targetUser.id);
  if (!embed) {
    await interaction.editReply({
      content:
        targetUser.id === interaction.user.id
          ? '❌ Bạn chưa có dữ liệu Đua Rank Thí Kiếm nào — hãy gửi ảnh cập nhật điểm trước.'
          : `❌ ${targetUser.username} chưa có dữ liệu Đua Rank Thí Kiếm nào.`,
    });
    return;
  }
  await interaction.editReply({ embeds: [embed] });
}

module.exports = {
  isAllowedChatChannel,
  buildRankCardEmbedForId,
  handleThiKiemViewRankButton,
  handleRankMessageCommand,
  handleRankSlashCommand,
};
