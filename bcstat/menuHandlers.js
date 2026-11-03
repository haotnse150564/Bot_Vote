// ===== /bcstat: màn hình chính (slash, chọn tab, chờ ảnh, xong/quay lại/huỷ) =====
// Tách khỏi index.js.

const { AUTO_BUTTON_ID, buildMainMenuPayload, buildWaitingPayload, buildImageUploadModal } = require('./format');
const {
  sessions,
  isAdmin,
  getOrCreateSession,
  clearAwaitingTimeout,
  scheduleAwaitTimeout,
} = require('./sessionState');

async function handleBcstatSlash(interaction) {
  if (!isAdmin(interaction.member)) {
    await interaction.reply({ content: '❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.', ephemeral: true });
    return;
  }

  const session = getOrCreateSession(interaction.user.id, interaction.guildId);
  session.awaiting = null;
  await interaction.reply({ ...buildMainMenuPayload(session), ephemeral: true });
}

// Hub gọi hàm này khi bấm nút "BC Stat" — tương đương gõ `/bcstat` (CHỈ NPC).
// Trả payload ephemeral (màn hình chính bcstat) hoặc { content } báo từ chối.
function buildBcstatMenuReply(interaction) {
  if (!isAdmin(interaction.member)) {
    return { content: '❌ Chỉ NPC mới được dùng mục **BC Stat**.' };
  }
  const session = getOrCreateSession(interaction.user.id, interaction.guildId);
  session.awaiting = null;
  return buildMainMenuPayload(session);
}

async function handleTabButton(interaction, tab) {
  const session = getOrCreateSession(interaction.user.id, interaction.guildId);
  clearAwaitingTimeout(session);
  session.awaiting = {
    tab,
    channelId: interaction.channelId,
    controlInteraction: interaction,
    timeoutHandle: scheduleAwaitTimeout(interaction.user.id),
  };
  await interaction.update(buildWaitingPayload(session, tab));
}

// Bấm "🚀 Gửi ảnh tự động" — giống handleTabButton nhưng dùng sentinel
// AUTO_BUTTON_ID làm "tab" đang chờ; processImage() sẽ tự nhận diện tab
// thật của TỪNG ảnh gửi vào (xem buildAutoPrompt trong geminiVision.js).
async function handleAutoButton(interaction) {
  const session = getOrCreateSession(interaction.user.id, interaction.guildId);
  clearAwaitingTimeout(session);
  session.awaiting = {
    tab: AUTO_BUTTON_ID,
    channelId: interaction.channelId,
    controlInteraction: interaction,
    timeoutHandle: scheduleAwaitTimeout(interaction.user.id),
  };
  await interaction.update(buildWaitingPayload(session, AUTO_BUTTON_ID));
}

// Bấm "📤 Chọn ảnh" ở màn hình chờ -> mở popup thật luôn (showModal PHẢI là
// phản hồi ĐẦU TIÊN cho tương tác nút, không được defer/reply trước) —
// giống hệt thiKiem/updateHandlers.js::handleThiKiemUpdateButton. tab lấy từ chính
// customId của nút (không lấy từ session) để tránh mở nhầm modal nếu người
// dùng bấm đúng lúc session vừa đổi màn hình.
async function handleUploadButton(interaction, tab) {
  const session = sessions.get(interaction.user.id);
  if (!session || !session.awaiting || session.awaiting.tab !== tab) {
    await interaction.reply({
      content: '❌ Màn hình đã đổi hoặc phiên đã hết hạn — hãy bấm lại nút chọn tab rồi thử lại.',
      ephemeral: true,
    });
    return;
  }
  try {
    await interaction.showModal(buildImageUploadModal(tab));
  } catch (error) {
    // Lỗi phổ biến nhất: server chưa `npm install` lại discord.js >=14.24
    // (cần LabelBuilder/FileUploadBuilder) — xem chú thích tương tự trong
    // thiKiem/updateHandlers.js::handleThiKiemUpdateButton.
    console.error(
      'Không mở được form chọn ảnh /bcstat — kiểm tra lại phiên bản discord.js đã cài (cần >=14.24):',
      error
    );
    if (!interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({
          content: '❌ Không mở được form chọn ảnh (lỗi hệ thống), vui lòng báo NPC kiểm tra lại bot.',
          ephemeral: true,
        });
      } catch (replyError) {
        console.error('Không gửi được thông báo lỗi cho nút chọn ảnh /bcstat:', replyError.message);
      }
    }
  }
}

async function handleDoneTabButton(interaction) {
  const session = getOrCreateSession(interaction.user.id, interaction.guildId);
  clearAwaitingTimeout(session);
  session.awaiting = null;
  await interaction.update(buildMainMenuPayload(session));
}

async function handleBackButton(interaction) {
  return handleDoneTabButton(interaction);
}

async function handleCancelButton(interaction) {
  clearAwaitingTimeout(sessions.get(interaction.user.id) || {});
  sessions.delete(interaction.user.id);
  await interaction.update({
    content: '🗑 Đã huỷ phiên ghi nhận — toàn bộ dữ liệu đã gửi trong phiên này không được lưu.',
    embeds: [],
    components: [],
  });
}

module.exports = {
  buildBcstatMenuReply,
  handleBcstatSlash,
  handleTabButton,
  handleAutoButton,
  handleUploadButton,
  handleDoneTabButton,
  handleBackButton,
  handleCancelButton,
};
