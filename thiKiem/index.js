// ===== Đua Rank Thí Kiếm Thiên Hạ =====
// Kênh THIKIEM_BOARD_CHANNEL_ID (config.js) chỉ có ĐÚNG 2 tin nhắn cố định
// do bot quản lý — không tin nào khác:
//   1. Bảng xếp hạng (embed) — edit lại mỗi khi có ai cập nhật điểm.
//   2. Nút "📤 Cập nhật điểm" — nội dung tĩnh, chỉ gửi/edit 1 lần lúc khởi động.
// Kênh CHỈ chấp nhận 2 cách gửi điểm: bấm nút (modal) hoặc gửi/dán ảnh thẳng
// vào chat. BẤT KỲ tin nhắn nào khác của người dùng (text, sticker, file
// không phải ảnh...) đều bị bot TỰ ĐỘNG XOÁ NGAY, KHÔNG báo/nhắc gì (xem
// client.on(Events.MessageCreate...) bên dưới) — giữ kênh luôn sạch, đúng
// tinh thần "chỉ có 2 tin cố định + ảnh đang chờ xử lý (xoá ngay sau đó)".
// Có 2 CÁCH gửi ảnh cập nhật điểm (song song, không loại trừ nhau):
//   A. Bấm nút -> mở MODAL thật (showModal, có ô "chọn file" nhờ
//      LabelBuilder + FileUploadBuilder — discord.js >=14.24) -> chọn ảnh &
//      Submit ngay trong popup.
//   B. Dán ảnh (Ctrl+V) hoặc thả file thẳng vào Ô CHAT của kênh này rồi gửi
//      — bù cho hạn chế hiện tại của Discord: dán ảnh vào field upload BÊN
//      TRONG modal bị lỗi (dán lọt ra ô chat phía sau modal), trong khi dán
//      vào ô chat bình thường thì vẫn ổn. KHÔNG cần bấm nút trước — bot lắng
//      nghe mọi ảnh gửi vào đúng kênh này và xử lý ngay (xem
//      client.on(Events.MessageCreate...) bên dưới).
// Cả 2 cách đều: rate limit -> check tên ingame trong tab "Bang" -> Gemini
// Vision -> check tên mùa giải trong ảnh (kèm S1/S2) có khớp mùa giải đang
// cấu hình không -> ghi sheet -> tính lại hạng -> edit bảng xếp hạng -> xoá
// ảnh gốc (nếu gửi qua cách B) -> trả kết quả riêng tư (ephemeral hoặc DM)
// cho người gửi.
//
// Module được tách thành:
//   - sharedState.js    : processingUsers / rankSheetMutex / isAdmin (dùng chung)
//   - board.js          : bảng xếp hạng (tin cố định, menu Hub, chuyển tab, refresh)
//   - rankCard.js       : tra rank (nút "Xem Rank", nm!rank, /rank)
//   - scoreImage.js     : xử lý 1 ảnh cập nhật điểm (rate limit -> Gemini -> ghi sheet)
//   - updateHandlers.js : 2 cách gửi ảnh (nút -> modal / dán ảnh vào kênh)
//   - adminCommands.js  : /set-mua-giai, /xoa-diem-thi-kiem, /xem-bang-xep-hang-thi-kiem
//   - slashCommands.js  : định nghĩa slash command
//   - index.js (đây)    : đăng ký listener + điều phối interaction, export
const { Events } = require('discord.js');
const client = require('../client');
const { ensureThiKiemSheetsExist } = require('../googleSheets/thiKiemSheet');
const { isBotReady, replyNotReadyToInteraction } = require('../utils/readyGate');
const {
  THIKIEM_UPDATE_BUTTON_ID,
  THIKIEM_VIEW_RANK_BUTTON_ID,
  THIKIEM_UPDATE_MODAL_ID,
  THIKIEM_VIEW_BUTTON_PREFIX,
} = require('./format');
const {
  buildRankMenuReply,
  ensureThiKiemMessagesPosted,
  refreshLeaderboardMessage,
  handleThiKiemViewButton,
  clearRecentUpdatesLog,
} = require('./board');
const {
  handleThiKiemViewRankButton,
  handleRankMessageCommand,
  handleRankSlashCommand,
} = require('./rankCard');
const {
  handleThiKiemUpdateButton,
  handleThiKiemUpdateModalSubmit,
  handleBoardChannelMessage,
} = require('./updateHandlers');
const { handleSetMuaGiai, handleXoaDiem, handleXemBangXepHang } = require('./adminCommands');
const { THIKIEM_SLASH_COMMANDS } = require('./slashCommands');
const { markRankAwaiting, clearRankAwaiting } = require('./sharedState');

// Thứ tự đăng ký listener giữ NGUYÊN như file gốc: (1) tin nhắn trong kênh Đua
// Rank, (2) nm!rank ở các kênh khác, (3) interaction.
client.on(Events.MessageCreate, handleBoardChannelMessage);
client.on(Events.MessageCreate, handleRankMessageCommand);

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // Chỉ chặn đúng những tương tác mà file này xử lý (nút/modal/slash
    // command Thí Kiếm) — không đụng tới tương tác của file khác (đã tự gate
    // riêng), tránh trả lời trùng 2 lần cho cùng 1 tương tác.
    const isLocalButton =
      interaction.isButton() &&
      (interaction.customId === THIKIEM_UPDATE_BUTTON_ID ||
        interaction.customId === THIKIEM_VIEW_RANK_BUTTON_ID ||
        interaction.customId.startsWith(THIKIEM_VIEW_BUTTON_PREFIX));
    const isLocalModal = interaction.isModalSubmit() && interaction.customId === THIKIEM_UPDATE_MODAL_ID;
    const isLocalCommand =
      interaction.isChatInputCommand() &&
      ['rank', 'set-mua-giai', 'xoa-diem-thi-kiem', 'xem-bang-xep-hang-thi-kiem'].includes(interaction.commandName);

    if (!isBotReady() && (isLocalButton || isLocalModal || isLocalCommand)) {
      await replyNotReadyToInteraction(interaction);
      return;
    }

    if (interaction.isButton() && interaction.customId === THIKIEM_UPDATE_BUTTON_ID) {
      await handleThiKiemUpdateButton(interaction);
      return;
    }

    if (interaction.isButton() && interaction.customId === THIKIEM_VIEW_RANK_BUTTON_ID) {
      await handleThiKiemViewRankButton(interaction);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(THIKIEM_VIEW_BUTTON_PREFIX)) {
      await handleThiKiemViewButton(interaction);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === THIKIEM_UPDATE_MODAL_ID) {
      await handleThiKiemUpdateModalSubmit(interaction);
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'rank') {
      await handleRankSlashCommand(interaction);
    } else if (interaction.commandName === 'set-mua-giai') {
      await handleSetMuaGiai(interaction);
    } else if (interaction.commandName === 'xoa-diem-thi-kiem') {
      await handleXoaDiem(interaction);
    } else if (interaction.commandName === 'xem-bang-xep-hang-thi-kiem') {
      await handleXemBangXepHang(interaction);
    }
  } catch (error) {
    console.error('Lỗi xử lý tương tác Đua Rank Thí Kiếm:', error.message);
  }
});

module.exports = {
  ensureThiKiemSheetsExist,
  ensureThiKiemMessagesPosted,
  refreshLeaderboardMessage,
  buildRankMenuReply,
  markRankAwaiting,
  clearRankAwaiting,
  clearRecentUpdatesLog,
  THIKIEM_SLASH_COMMANDS,
};
