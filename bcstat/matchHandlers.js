// ===== /bcstat: chọn/nhập trận + lưu vào Google Sheet =====
// Tách khỏi index.js.

const {
  TAB_NAMES,
  appendSessionRows,
  computeAndWriteSummary,
  validateMatchInput,
  splitMatchLabel,
  getRecentMatchLabels,
} = require('../googleSheets/bcStatSheet');
const {
  MATCH_OPPONENT_FIELD_ID,
  MATCH_DATE_FIELD_ID,
  buildMainMenuPayload,
  buildMatchPickerPayload,
  buildMatchLabelModal,
  buildMatchEditSelectPayload,
  buildResultEmbed,
  buildUnmatchedReviewButtonRow,
} = require('./format');
const {
  sessions,
  pendingMatchEditListByUser,
  pendingMatchEditByUser,
  getOrCreateSession,
  clearAwaitingTimeout,
} = require('./sessionState');

// Bấm "✅ Hoàn tất & Lưu" ở màn hình chính -> KHÔNG lưu ngay, chuyển sang
// màn hình chọn "Trận nào" (xem format.js::buildMatchPickerPayload) — việc
// ghi vào Google Sheet thật sự chỉ xảy ra sau khi nhập/chọn xong trận ở
// handleMatchModalSubmit bên dưới.
async function handleFinishButton(interaction) {
  const session = sessions.get(interaction.user.id);
  if (!session || !TAB_NAMES.some((tab) => session.tabs[tab] && session.tabs[tab].size)) {
    await interaction.reply({ content: '❌ Chưa có dữ liệu nào để lưu — hãy chọn 1 tab và gửi ảnh trước.', ephemeral: true });
    return;
  }
  clearAwaitingTimeout(session);
  await interaction.update(buildMatchPickerPayload());
}

// Bấm "🔙 Quay lại" ở màn hình chọn/nhập trận -> về lại màn hình chính,
// KHÔNG mất dữ liệu đã thu thập trong phiên.
async function handleMatchBackButton(interaction) {
  const session = getOrCreateSession(interaction.user.id, interaction.guildId);
  await interaction.update(buildMainMenuPayload(session));
}

// Bấm "🆕 Trận mới" ở màn hình chọn trận -> mở popup thật luôn (showModal
// PHẢI là phản hồi ĐẦU TIÊN cho tương tác nút) nhập tên đối thủ + ngày cho 1
// trận MỚI — 2 ô trống.
async function handleMatchNewButton(interaction) {
  const session = sessions.get(interaction.user.id);
  if (!session || !TAB_NAMES.some((tab) => session.tabs[tab] && session.tabs[tab].size)) {
    await interaction.reply({ content: '❌ Phiên đã hết hạn hoặc không còn dữ liệu — hãy chạy lại `/bcstat`.', ephemeral: true });
    return;
  }
  try {
    await interaction.showModal(buildMatchLabelModal({ mode: 'new' }));
  } catch (error) {
    console.error('Không mở được form nhập trận mới /bcstat:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Không mở được form nhập trận (lỗi hệ thống), vui lòng báo NPC kiểm tra lại bot.', ephemeral: true });
    }
  }
}

// Bấm "✏️ Sửa trận đã lưu" -> đọc danh sách trận gần nhất (Sheets, có thể
// mất vài giây) -> deferUpdate rồi hiện select menu.
async function handleMatchEditButton(interaction) {
  const session = sessions.get(interaction.user.id);
  if (!session || !TAB_NAMES.some((tab) => session.tabs[tab] && session.tabs[tab].size)) {
    await interaction.reply({ content: '❌ Phiên đã hết hạn hoặc không còn dữ liệu — hãy chạy lại `/bcstat`.', ephemeral: true });
    return;
  }
  await interaction.deferUpdate();
  try {
    const labels = await getRecentMatchLabels();
    pendingMatchEditListByUser.set(interaction.user.id, labels);
    await interaction.editReply(buildMatchEditSelectPayload(labels));
  } catch (error) {
    console.error('Lỗi khi đọc danh sách trận đã lưu /bcstat:', error.message);
    await interaction.editReply({
      content: '❌ Có lỗi khi đọc danh sách trận đã lưu — thử lại sau.',
      embeds: [],
      components: [],
    });
  }
}

// Chọn 1 trận ở select menu "✏️ Sửa trận đã lưu" -> mở modal ĐIỀN SẴN theo
// đúng trận đó (showModal PHẢI là phản hồi ĐẦU TIÊN cho tương tác select).
async function handleMatchEditSelect(interaction) {
  const idx = Number((interaction.values || [])[0]);
  const list = pendingMatchEditListByUser.get(interaction.user.id) || [];
  const label = list[idx];
  if (!label) {
    await interaction.reply({
      content: '❌ Danh sách đã thay đổi (có thể do bấm lại nút) — hãy bấm "✏️ Sửa trận đã lưu" lại từ đầu.',
      ephemeral: true,
    });
    return;
  }
  pendingMatchEditByUser.set(interaction.user.id, { originalLabel: label });
  const { opponent, dateStr } = splitMatchLabel(label);
  try {
    await interaction.showModal(buildMatchLabelModal({ mode: 'edit', opponent, dateStr }));
  } catch (error) {
    console.error('Không mở được form sửa trận /bcstat:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Không mở được form sửa trận (lỗi hệ thống), vui lòng báo NPC kiểm tra lại bot.', ephemeral: true });
    }
  }
}

// Submit modal nhập/sửa trận (mode 'new' hoặc 'edit') -> validate tên đối
// thủ + ngày (dd/mm/yy, phải là Thứ 7) -> lưu thật sự vào Google Sheet
// (RawLog + Cumulative + Summary, xem googleSheets/bcStatSheet.js). mode
// 'edit': renameFrom = nhãn trận GỐC đã chọn ở select menu — đổi tên trận đó
// sang nhãn vừa nhập (dù giữ nguyên hay đổi khác) cho MỌI người từng có mặt.
async function handleMatchModalSubmit(interaction, mode) {
  const userId = interaction.user.id;
  const session = sessions.get(userId);
  if (!session || !TAB_NAMES.some((tab) => session.tabs[tab] && session.tabs[tab].size)) {
    await interaction.reply({ content: '❌ Phiên đã hết hạn hoặc không còn dữ liệu — hãy chạy lại `/bcstat`.', ephemeral: true });
    return;
  }

  const opponent = interaction.fields.getTextInputValue(MATCH_OPPONENT_FIELD_ID);
  const dateStr = interaction.fields.getTextInputValue(MATCH_DATE_FIELD_ID);
  const validated = validateMatchInput(opponent, dateStr);
  if (!validated.ok) {
    await interaction.reply({ content: `❌ ${validated.error}`, ephemeral: true });
    return;
  }
  const matchLabel = validated.label;

  let renameFromLabel = null;
  if (mode === 'edit') {
    const pending = pendingMatchEditByUser.get(userId);
    renameFromLabel = pending ? pending.originalLabel : null;
  }
  pendingMatchEditByUser.delete(userId);
  pendingMatchEditListByUser.delete(userId);

  clearAwaitingTimeout(session);
  await interaction.reply({ content: '⏳ Đang lưu vào Google Sheet, vui lòng đợi...', ephemeral: true });

  try {
    const combined = new Map();
    TAB_NAMES.forEach((tab) => {
      const map = session.tabs[tab];
      if (!map) return;
      map.forEach((entry, key) => {
        if (!combined.has(key)) combined.set(key, { displayName: entry.displayName, values: {} });
        Object.assign(combined.get(key).values, entry.values);
      });
    });

    const sessionLabel = new Date().toLocaleString('vi-VN', { hour12: false });
    const playerCount = await appendSessionRows(sessionLabel, combined, matchLabel, renameFromLabel);
    const summaryResult = await computeAndWriteSummary();

    sessions.delete(userId);
    await interaction.editReply({
      content: null,
      embeds: [buildResultEmbed({ sessionLabel, matchLabel, playerCount, summaryResult })],
      components: summaryResult.unmatched.some((u) => u.suggestion) ? [buildUnmatchedReviewButtonRow()] : [],
    });
  } catch (error) {
    console.error('Lỗi khi lưu phiên /bcstat:', error.message);
    await interaction.editReply({
      content: '❌ Có lỗi khi ghi vào Google Sheet, dữ liệu phiên này CHƯA mất — hãy thử bấm "Hoàn tất & Lưu" rồi nhập lại trận. Nếu vẫn lỗi, báo dev kiểm tra quyền truy cập sheet.',
    });
    // Trả lại session để không mất dữ liệu, nhưng không còn awaiting nữa.
    sessions.set(userId, session);
  }
}

module.exports = {
  handleFinishButton,
  handleMatchBackButton,
  handleMatchNewButton,
  handleMatchEditButton,
  handleMatchEditSelect,
  handleMatchModalSubmit,
};
