// ===== `/bcstat` — Tổng hợp chỉ số Bang Chiến =====
// Luồng (mục 5 spec): NPC gõ `/bcstat` -> bot hiện 4 nút tab (Chiến Lược/
// Sát Thương/Trị Liệu/Trọng Thương) + Hoàn tất/Huỷ -> bấm 1 tab -> gửi ảnh
// (nhiều ảnh liên tiếp) ngay trong kênh vừa gõ lệnh -> bấm "Xong tab này" ->
// quay lại chọn tab khác (không bắt buộc đủ 4 tab) -> bấm "Hoàn tất & Lưu"
// -> chọn "🆕 Trận mới" (nhập tên đối thủ + ngày dd/mm/yy, luôn là Thứ 7) hoặc
// "✏️ Sửa trận đã lưu" (chọn lại 1 trận có sẵn để ghi đè) -> khi xong: ghi 1
// dòng MỚI/người vào RawLog (không ghi đè các session cũ), cập nhật Cumulative
// theo đúng trận vừa nhập/chọn rồi tính lại Kỷ lục + ghép Class (tab "Bang")
// vào Summary (xem googleSheets/bcStatSheet.js).
// State giữ trong bộ nhớ theo Discord ID (1 phiên/người, ephemeral) — mất
// nếu bot restart giữa chừng (dữ liệu CHƯA bấm "Hoàn tất" sẽ mất, giống các
// tính năng modal/ephemeral khác trong bot này).
//
// Module được tách thành:
//   - sessionState.js     : state in-memory (sessions, pending*), hàng đợi ảnh, helper phiên
//   - menuHandlers.js     : /bcstat, chọn tab, chờ ảnh, xong/quay lại/huỷ
//   - imagePipeline.js    : đọc ảnh Gemini Vision (gửi trong kênh / modal "Chọn ảnh")
//   - matchHandlers.js    : chọn/nhập/sửa trận + lưu vào Google Sheet
//   - unmatchedHandlers.js: xem & gộp tên chưa khớp
//   - index.js (đây)      : đăng ký listener + điều phối interaction, export
const { Events, SlashCommandBuilder } = require('discord.js');
const client = require('../client');
const { isBotReady, replyNotReadyToInteraction } = require('../utils/readyGate');
const { ensureBcStatSheetsExist } = require('../googleSheets/bcStatSheet');
const {
  TAB_BUTTON_PREFIX,
  AUTO_BUTTON_ID,
  FINISH_BUTTON_ID,
  CANCEL_BUTTON_ID,
  DONE_TAB_BUTTON_ID,
  BACK_BUTTON_ID,
  MATCH_NEW_BUTTON_ID,
  MATCH_EDIT_BUTTON_ID,
  MATCH_BACK_BUTTON_ID,
  MATCH_EDIT_SELECT_ID,
  MATCH_MODAL_NEW_ID,
  MATCH_MODAL_EDIT_ID,
  UPLOAD_BUTTON_PREFIX,
  UPLOAD_MODAL_PREFIX,
  UNMATCHED_REVIEW_BUTTON_ID,
  UNMATCHED_SELECT_ID,
  UNMATCHED_BULK_CONFIRM_BUTTON_ID,
  UNMATCHED_CANCEL_BUTTON_ID,
} = require('./format');
const {
  buildBcstatMenuReply,
  handleBcstatSlash,
  handleTabButton,
  handleAutoButton,
  handleUploadButton,
  handleDoneTabButton,
  handleBackButton,
  handleCancelButton,
} = require('./menuHandlers');
const { handleUploadModalSubmit, handleImageMessage } = require('./imagePipeline');
const {
  handleFinishButton,
  handleMatchBackButton,
  handleMatchNewButton,
  handleMatchEditButton,
  handleMatchEditSelect,
  handleMatchModalSubmit,
} = require('./matchHandlers');
const {
  handleUnmatchedReviewButton,
  handleUnmatchedSelect,
  handleBulkMergeConfirmButton,
  handleMergeCancelButton,
} = require('./unmatchedHandlers');

client.on(Events.MessageCreate, handleImageMessage);

const BCSTAT_SLASH_COMMANDS = [
  new SlashCommandBuilder()
    .setName('bcstat')
    .setDescription('[NPC] Mở nút nhập dữ liệu tổng hợp chỉ số Bang Chiến'),
].map((cmd) => cmd.toJSON());

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    const isLocalButton =
      interaction.isButton() &&
      (interaction.customId.startsWith(TAB_BUTTON_PREFIX) ||
        interaction.customId.startsWith(UPLOAD_BUTTON_PREFIX) ||
        [
          AUTO_BUTTON_ID,
          FINISH_BUTTON_ID,
          CANCEL_BUTTON_ID,
          DONE_TAB_BUTTON_ID,
          BACK_BUTTON_ID,
          MATCH_NEW_BUTTON_ID,
          MATCH_EDIT_BUTTON_ID,
          MATCH_BACK_BUTTON_ID,
          UNMATCHED_REVIEW_BUTTON_ID,
          UNMATCHED_BULK_CONFIRM_BUTTON_ID,
          UNMATCHED_CANCEL_BUTTON_ID,
        ].includes(interaction.customId));
    const isLocalSelect =
      interaction.isStringSelectMenu() &&
      (interaction.customId === UNMATCHED_SELECT_ID || interaction.customId === MATCH_EDIT_SELECT_ID);
    const isLocalModal =
      interaction.isModalSubmit() &&
      (interaction.customId.startsWith(UPLOAD_MODAL_PREFIX) ||
        interaction.customId === MATCH_MODAL_NEW_ID ||
        interaction.customId === MATCH_MODAL_EDIT_ID);
    const isLocalCommand = interaction.isChatInputCommand() && interaction.commandName === 'bcstat';

    if (!isLocalButton && !isLocalSelect && !isLocalModal && !isLocalCommand) return;

    if (!isBotReady()) {
      await replyNotReadyToInteraction(interaction);
      return;
    }

    if (isLocalCommand) {
      await handleBcstatSlash(interaction);
      return;
    }

    if (isLocalModal) {
      if (interaction.customId === MATCH_MODAL_NEW_ID) {
        await handleMatchModalSubmit(interaction, 'new');
        return;
      }
      if (interaction.customId === MATCH_MODAL_EDIT_ID) {
        await handleMatchModalSubmit(interaction, 'edit');
        return;
      }
      const tab = interaction.customId.slice(UPLOAD_MODAL_PREFIX.length);
      await handleUploadModalSubmit(interaction, tab);
      return;
    }

    if (isLocalSelect) {
      if (interaction.customId === MATCH_EDIT_SELECT_ID) {
        await handleMatchEditSelect(interaction);
        return;
      }
      await handleUnmatchedSelect(interaction);
      return;
    }

    if (interaction.customId === UNMATCHED_REVIEW_BUTTON_ID) {
      await handleUnmatchedReviewButton(interaction);
      return;
    }
    if (interaction.customId === UNMATCHED_CANCEL_BUTTON_ID) {
      await handleMergeCancelButton(interaction);
      return;
    }
    if (interaction.customId === UNMATCHED_BULK_CONFIRM_BUTTON_ID) {
      await handleBulkMergeConfirmButton(interaction);
      return;
    }

    if (interaction.customId === AUTO_BUTTON_ID) {
      await handleAutoButton(interaction);
      return;
    }
    // QUAN TRỌNG: kiểm tra UPLOAD_BUTTON_PREFIX ('bcstat_upload_') TRƯỚC
    // TAB_BUTTON_PREFIX ('bcstat_tab_') — 2 prefix không đè lên nhau nhưng
    // để rõ ràng thứ tự ưu tiên.
    if (interaction.customId.startsWith(UPLOAD_BUTTON_PREFIX)) {
      const tab = interaction.customId.slice(UPLOAD_BUTTON_PREFIX.length);
      await handleUploadButton(interaction, tab);
      return;
    }
    if (interaction.customId.startsWith(TAB_BUTTON_PREFIX)) {
      const tab = interaction.customId.slice(TAB_BUTTON_PREFIX.length);
      await handleTabButton(interaction, tab);
      return;
    }
    if (interaction.customId === DONE_TAB_BUTTON_ID) {
      await handleDoneTabButton(interaction);
      return;
    }
    if (interaction.customId === BACK_BUTTON_ID) {
      await handleBackButton(interaction);
      return;
    }
    if (interaction.customId === FINISH_BUTTON_ID) {
      await handleFinishButton(interaction);
      return;
    }
    if (interaction.customId === MATCH_NEW_BUTTON_ID) {
      await handleMatchNewButton(interaction);
      return;
    }
    if (interaction.customId === MATCH_EDIT_BUTTON_ID) {
      await handleMatchEditButton(interaction);
      return;
    }
    if (interaction.customId === MATCH_BACK_BUTTON_ID) {
      await handleMatchBackButton(interaction);
      return;
    }
    if (interaction.customId === CANCEL_BUTTON_ID) {
      await handleCancelButton(interaction);
      return;
    }
  } catch (error) {
    console.error('Lỗi xử lý tương tác /bcstat:', error);
    // Đừng để Discord hiện "không phản hồi kịp thời" — báo lỗi rõ cho người
    // dùng nếu tương tác này CHƯA được trả lời/defer.
    try {
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ Có lỗi khi xử lý thao tác này — thử lại hoặc báo dev.', ephemeral: true });
      }
    } catch (replyError) {
      console.error('Không gửi được thông báo lỗi /bcstat:', replyError.message);
    }
  }
});

module.exports = { ensureBcStatSheetsExist, BCSTAT_SLASH_COMMANDS, buildBcstatMenuReply };
