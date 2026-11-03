// ===== Sảnh Vinh Danh Bang Chiến =====
// Kênh VINHDANH_CHANNEL_ID (config.js) — DÙNG CHUNG với kênh bảng xếp hạng
// Đua Rank Thí Kiếm (THIKIEM_BOARD_CHANNEL_ID) — nhận ảnh chụp mục "Danh
// hiệu vinh quang" (sau khi đánh xong Bang Chiến) do NPC gửi vào. Vì dùng
// chung kênh với Thí Kiếm (kênh đó tự xử lý MỌI ảnh gửi thẳng vào chat như
// 1 lần cập nhật điểm), ảnh Vinh Danh KHÔNG được gửi trần vào kênh nữa —
// PHẢI đi kèm lệnh, CHỈ role NPC mới dùng được:
//   - `/vinhdanh` (đính kèm ảnh vào option `anh-1` [+ `anh-2` nếu có]), hoặc
//   - `nm!vinhdanh` + đính kèm 1-2 ảnh trong CÙNG 1 tin nhắn.
// (tin của người khác/không đúng role bị báo lỗi, không xử lý — xem
// thiKiem/index.js, nơi đã tự bỏ qua tin bắt đầu bằng `nm!vinhdanh` để
// tránh đụng hàng với luồng cập nhật điểm Thí Kiếm của kênh đó).
//
// 1 tuần có thể có 1 hoặc 2 trận Bang Chiến (xen kẽ đều đặn) — gửi ảnh theo
// đúng số trận thật của tuần đó:
//   - Tuần 1 trận: gửi ĐÚNG 1 ảnh.
//   - Tuần 2 trận: gửi CẢ 2 ảnh CÙNG LÚC (thứ tự đính kèm = Trận 1 / Trận
//     2). Ảnh có thể là ảnh "Chiến Thắng" đầy đủ hoặc ảnh crop riêng khung
//     "Danh hiệu vinh quang" (xem vinhDanh/geminiVision.js).
//
// Xử lý: Gemini Vision đọc từng ảnh -> ghép lại theo từng danh hiệu (trùng
// tên ở cả 2 trận thì chỉ giữ 1) -> tra Discord ID theo Ingame (tab "Bang")
// -> APPEND 1 lô mới vào sheet lịch sử "Vinh Danh Bang Chiến" -> edit lại
// tin "Sảnh Vinh Danh" cố định trong kênh (giống tinh thần bảng xếp hạng
// Thí Kiếm — 1 tin cố định được edit lại mỗi lần cập nhật) -> đồng bộ lại
// role "Quần Long Chi Chủ" (danh hiệu CAO NHẤT — xem vinhDanh/logic.js).
//
// Module được tách thành:
//   - logic.js         : hàm thuần (isAdmin, gộp trùng, đồng bộ role, ...)
//   - board.js          : đăng/refresh tin cố định + embed cho menu Hub
//   - imagePipeline.js  : xử lý 1-2 ảnh gửi lên -> ghi sheet + refresh board
//   - hubUi.js           : nút + popup cập nhật mở từ menu Hub
//   - index.js (đây)    : lệnh `/vinhdanh`, `nm!vinhdanh`, `/xem-vinh-danh`, wiring
const { Events, SlashCommandBuilder } = require('discord.js');
const client = require('../client');
const { HUB_CHANNEL_ID, VINHDANH_CHANNEL_ID } = require('../config');
const { ensureVinhDanhSheetsExist } = require('../googleSheets/vinhDanhSheet');
const { isBotReady, replyNotReadyToInteraction, NOT_READY_MESSAGE } = require('../utils/readyGate');

const { isAdmin } = require('./logic');
const { ensureVinhDanhMessagesPosted, refreshVinhDanhBoard, buildVinhDanhBoardEmbedForHub } = require('./board');
const { processVinhDanhImages, deleteThenReply } = require('./imagePipeline');
const {
  VINHDANH_HUB_UPDATE_BUTTON_ID,
  VINHDANH_HUB_MODAL_ID,
  buildVinhDanhMenuReply,
  handleVinhDanhHubButton,
  handleVinhDanhHubModalSubmit,
} = require('./hubUi');

// ===== `nm!vinhdanh` + đính kèm 1-2 ảnh =====
// Kênh này DÙNG CHUNG với Đua Rank Thí Kiếm, nơi MỌI ảnh gửi thẳng vào chat
// đều bị hiểu là cập nhật điểm Thí Kiếm — nên Vinh Danh giờ CHỈ nhận ảnh
// khi đi kèm đúng lệnh `nm!vinhdanh` (thiKiem/index.js đã tự bỏ qua tin bắt
// đầu bằng `nm!vinhdanh` để không xử lý trùng). Tin nhắn khác trong kênh
// (không phải `nm!vinhdanh`) hoàn toàn không đụng tới ở đây.
client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot) return;
    if (!VINHDANH_CHANNEL_ID || VINHDANH_CHANNEL_ID === HUB_CHANNEL_ID || message.channelId !== VINHDANH_CHANNEL_ID) return;
    if (!/^nm!vinhdanh(\s|$)/i.test((message.content || '').trim())) return;

    if (!isBotReady()) {
      await deleteThenReply(message, `⏳ ${NOT_READY_MESSAGE}`);
      return;
    }

    if (!isAdmin(message.member)) {
      await deleteThenReply(message, '❌ Chỉ NPC mới được cập nhật Sảnh Vinh Danh Bang Chiến.');
      return;
    }

    const imageAttachments = [...message.attachments.values()].filter((a) =>
      (a.contentType || '').startsWith('image/')
    );

    if (!imageAttachments.length) {
      await deleteThenReply(message, '❌ Cần đính kèm 1-2 ảnh khung "Danh hiệu vinh quang" cùng lệnh `nm!vinhdanh`.');
      return;
    }

    if (imageAttachments.length > 2) {
      await deleteThenReply(
        message,
        '❌ 1 lần cập nhật chỉ nhận tối đa 2 ảnh (1 tuần tối đa 2 trận). Vui lòng gửi lại đúng 1-2 ảnh.'
      );
      return;
    }

    const result = await processVinhDanhImages(imageAttachments);
    await deleteThenReply(message, result.message);
  } catch (error) {
    console.error('Lỗi xử lý lệnh nm!vinhdanh:', error.message);
  }
});

async function handleXemVinhDanh(interaction) {
  await interaction.deferReply({ ephemeral: true });

  // Không còn tin Sảnh Vinh Danh cố định (đã gộp vào menu Hub) -> hiện bản mới
  // nhất riêng tư cho NPC gọi lệnh. Nếu vẫn cấu hình kênh riêng (ENV
  // VINHDANH_CHANNEL_ID) thì đăng lại tin cố định như cũ.
  if (!VINHDANH_CHANNEL_ID || VINHDANH_CHANNEL_ID === HUB_CHANNEL_ID) {
    const embed = await buildVinhDanhBoardEmbedForHub();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  await refreshVinhDanhBoard();
  await interaction.editReply({ content: '✅ Đã đăng lại Sảnh Vinh Danh Bang Chiến mới nhất.' });
}

// `/vinhdanh` — cách 2 (song song `nm!vinhdanh` + đính kèm ảnh) để cập nhật
// Sảnh Vinh Danh Bang Chiến, dùng option attachment thay vì gửi ảnh trần
// vào kênh (kênh này dùng chung với Thí Kiếm — xem ghi chú đầu file).
async function handleVinhDanhSlashCommand(interaction) {
  if (!isAdmin(interaction.member)) {
    await interaction.reply({ content: '❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.', ephemeral: true });
    return;
  }

  const anh1 = interaction.options.getAttachment('anh-1', true);
  const anh2 = interaction.options.getAttachment('anh-2', false);
  const attachments = anh2 ? [anh1, anh2] : [anh1];

  const invalid = attachments.find((a) => !(a.contentType || '').startsWith('image/'));
  if (invalid) {
    await interaction.reply({ content: '❌ File đính kèm phải là ảnh.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const result = await processVinhDanhImages(attachments);
  await interaction.editReply({ content: result.message });
}

const VINHDANH_SLASH_COMMANDS = [
  new SlashCommandBuilder()
    .setName('vinhdanh')
    .setDescription('[NPC] Cập nhật Sảnh Vinh Danh Bang Chiến (1-2 ảnh khung "Danh hiệu vinh quang")')
    .addAttachmentOption((opt) =>
      opt
        .setName('anh-1')
        .setDescription('Ảnh Trận 1 (hoặc ảnh duy nhất nếu tuần chỉ có 1 trận)')
        .setRequired(true)
    )
    .addAttachmentOption((opt) =>
      opt.setName('anh-2').setDescription('Ảnh Trận 2 (chỉ cần nếu tuần đó có 2 trận)').setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('xem-vinh-danh')
    .setDescription('[NPC] Đăng lại Sảnh Vinh Danh Bang Chiến mới nhất (không cần đợi có ảnh cập nhật mới)'),
].map((cmd) => cmd.toJSON());

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // Nút + popup cập nhật mở từ menu Hub (CHỈ NPC — check role trong handler).
    if (
      (interaction.isButton() && interaction.customId === VINHDANH_HUB_UPDATE_BUTTON_ID) ||
      (interaction.isModalSubmit() && interaction.customId === VINHDANH_HUB_MODAL_ID)
    ) {
      if (!isBotReady()) {
        await replyNotReadyToInteraction(interaction);
        return;
      }
      if (interaction.isButton()) await handleVinhDanhHubButton(interaction);
      else await handleVinhDanhHubModalSubmit(interaction);
      return;
    }

    if (!interaction.isChatInputCommand() || !['vinhdanh', 'xem-vinh-danh'].includes(interaction.commandName)) return;

    if (!isBotReady()) {
      await replyNotReadyToInteraction(interaction);
      return;
    }

    if (interaction.commandName === 'vinhdanh') {
      await handleVinhDanhSlashCommand(interaction);
      return;
    }

    if (!isAdmin(interaction.member)) {
      await interaction.reply({ content: '❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.', ephemeral: true });
      return;
    }

    await handleXemVinhDanh(interaction);
  } catch (error) {
    console.error('Lỗi xử lý tương tác Sảnh Vinh Danh Bang Chiến:', error.message);
  }
});

module.exports = {
  ensureVinhDanhSheetsExist,
  ensureVinhDanhMessagesPosted,
  buildVinhDanhMenuReply,
  handleVinhDanhHubButton,
  buildVinhDanhBoardEmbedForHub,
  VINHDANH_SLASH_COMMANDS,
};
