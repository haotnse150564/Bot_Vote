// ===== /bcstat: xem & gộp tên chưa khớp (alias) =====
// Tách khỏi index.js.

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { computeAndWriteSummary, mergeUnmatchedAlias } = require('../googleSheets/bcStatSheet');
const {
  BACK_BUTTON_ID,
  buildUnmatchedReviewPayload,
  buildBulkMergeConfirmPayload,
} = require('./format');
const { pendingUnmatchedByUser, pendingBulkSelectionByUser } = require('./sessionState');

// Hàng nút "🔙 Quay lại" dùng chung cho toàn bộ màn hình review/xác nhận
// gộp tên — tái sử dụng ĐÚNG BACK_BUTTON_ID đã có (handleBackButton ->
// handleDoneTabButton -> về thẳng màn hình chính, không mất dữ liệu phiên).
function backButtonRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(BACK_BUTTON_ID).setLabel('🔙 Quay lại').setStyle(ButtonStyle.Secondary)
  );
}

// Bấm "🔗 Xem & xác nhận tên chưa khớp" (ở màn hình chính HOẶC embed kết
// quả sau khi lưu) -> tính lại Summary MỚI NHẤT, lọc ra tên chưa khớp NHƯNG
// có gợi ý gần đúng, cache lại theo user rồi hiện select menu. Có thể mất
// vài giây (đọc Cumulative + tab "Bang") nên deferUpdate trước.
async function handleUnmatchedReviewButton(interaction) {
  await interaction.deferUpdate();
  try {
    const summaryResult = await computeAndWriteSummary();
    const withSuggestion = summaryResult.unmatched.filter((u) => u.suggestion);
    pendingUnmatchedByUser.set(interaction.user.id, withSuggestion);

    const payload = buildUnmatchedReviewPayload(withSuggestion);
    payload.components = [...payload.components, backButtonRow()];
    await interaction.editReply(payload);
  } catch (error) {
    console.error('Lỗi khi tính lại Summary để xem tên chưa khớp /bcstat:', error.message);
    await interaction.editReply({
      content: '❌ Có lỗi khi đọc dữ liệu để kiểm tra tên chưa khớp — thử lại sau.',
      embeds: [],
      components: [backButtonRow()],
    });
  }
}

// Tích chọn (1 hoặc nhiều) dòng trong select menu -> hiện màn hình xác
// nhận Có/Huỷ liệt kê lại TOÀN BỘ các cặp đã chọn (chưa gộp thật ở bước
// này, chỉ để NPC xem lại lần cuối trước khi bấm "✅ Xác nhận gộp").
async function handleUnmatchedSelect(interaction) {
  const indices = (interaction.values || []).map(Number);
  const list = pendingUnmatchedByUser.get(interaction.user.id) || [];
  const chosen = indices.map((idx) => list[idx]).filter(Boolean);
  if (!chosen.length) {
    await interaction.update({
      content: '❌ Danh sách đã thay đổi (có thể do bấm lại nút) — hãy bấm "🔗 Xem & xác nhận tên chưa khớp" lại từ đầu.',
      embeds: [],
      components: [backButtonRow()],
    });
    return;
  }
  pendingBulkSelectionByUser.set(interaction.user.id, chosen);
  const payload = buildBulkMergeConfirmPayload(chosen);
  payload.components = [...payload.components, backButtonRow()];
  await interaction.update(payload);
}

// Bấm "✅ Xác nhận gộp (N)" -> gộp thật HÀNG LOẠT (mergeUnmatchedAlias) +
// lưu alias cho từng cặp đã tích, TUẦN TỰ từng cặp một — CỐ Ý không chạy
// song song vì mergeUnmatchedAlias đọc rồi ghi đè lại toàn bộ tab
// Cumulative mỗi lần gọi; chạy song song dễ khiến 2 lần ghi đè đụng nhau,
// mất số liệu của lần gộp trước. Gộp xong hết (kể cả khi có vài cặp lỗi
// giữa chừng — vẫn tiếp tục các cặp còn lại, không dừng cả loạt), hiện lại
// danh sách còn lại (nếu còn) để tiện xử lý tiếp mà không cần bấm nút từ
// đầu, kèm báo rõ bao nhiêu gộp thành công/lỗi.
async function handleBulkMergeConfirmButton(interaction) {
  const chosen = pendingBulkSelectionByUser.get(interaction.user.id) || [];
  if (!chosen.length) {
    await interaction.update({
      content: '❌ Danh sách đã thay đổi — hãy bấm "🔗 Xem & xác nhận tên chưa khớp" lại từ đầu.',
      embeds: [],
      components: [backButtonRow()],
    });
    return;
  }

  await interaction.update({ content: `⏳ Đang gộp ${chosen.length} tên...`, embeds: [], components: [] });

  let summaryResult = null;
  let okCount = 0;
  const failedNames = [];
  for (const item of chosen) {
    try {
      // eslint-disable-next-line no-await-in-loop -- CỐ Ý gộp tuần tự, xem
      // ghi chú trên hàm.
      summaryResult = await mergeUnmatchedAlias(item.name, item.suggestion);
      okCount += 1;
    } catch (error) {
      console.error(`Lỗi khi gộp "${item.name}" -> "${item.suggestion}":`, error.message);
      failedNames.push(item.name);
    }
  }
  pendingBulkSelectionByUser.delete(interaction.user.id);

  // mergeUnmatchedAlias() đã tự tính lại Summary sau MỖI lần gộp thành
  // công, nên summaryResult ở đây (nếu có) đã là bản MỚI NHẤT sau lần gộp
  // cuối cùng — chỉ cần tính tay lại nếu MỌI cặp đều lỗi (summaryResult
  // vẫn null).
  if (!summaryResult) {
    try {
      summaryResult = await computeAndWriteSummary();
    } catch (error) {
      console.error('Lỗi khi tính lại Summary sau khi gộp hàng loạt /bcstat:', error.message);
      await interaction.editReply({
        content: `❌ Gộp không thành công (lỗi hệ thống, ${failedNames.length}/${chosen.length} tên lỗi): ${failedNames.join(', ')}.`,
        embeds: [],
        components: [backButtonRow()],
      });
      return;
    }
  }

  const withSuggestion = summaryResult.unmatched.filter((u) => u.suggestion);
  pendingUnmatchedByUser.set(interaction.user.id, withSuggestion);

  const payload = buildUnmatchedReviewPayload(withSuggestion);
  let header = `✅ Đã gộp ${okCount}/${chosen.length} tên thành công — từ nay gặp lại các tên gõ y hệt sẽ tự động hiểu đúng.`;
  if (failedNames.length) header += `\n⚠️ Lỗi khi gộp: ${failedNames.join(', ')}.`;
  payload.content = `${header}\n\n${payload.content || ''}`.trim();
  payload.components = [...payload.components, backButtonRow()];
  await interaction.editReply(payload);
}

// Bấm "❌ Huỷ" ở màn xác nhận gộp hàng loạt -> KHÔNG gộp gì, quay lại đúng
// danh sách select menu ban đầu (không tính lại Summary — dùng lại cache
// pendingUnmatchedByUser) để NPC tiện chọn lại nếu chọn nhầm, thay vì phải
// bấm nút "🔗 Xem & xác nhận..." từ đầu.
async function handleMergeCancelButton(interaction) {
  pendingBulkSelectionByUser.delete(interaction.user.id);
  const list = pendingUnmatchedByUser.get(interaction.user.id) || [];
  if (list.length) {
    const payload = buildUnmatchedReviewPayload(list);
    payload.components = [...payload.components, backButtonRow()];
    await interaction.update(payload);
    return;
  }
  await interaction.update({
    content: '❌ Đã huỷ, chưa gộp gì.',
    embeds: [],
    components: [backButtonRow()],
  });
}

module.exports = {
  handleUnmatchedReviewButton,
  handleUnmatchedSelect,
  handleBulkMergeConfirmButton,
  handleMergeCancelButton,
};
