// Trạng thái "đã nạp xong TOÀN BỘ dữ liệu cần thiết lúc khởi động" (Google
// Sheets, state, v.v. — xem index.js -> Events.ClientReady). Mặc định false
// ngay khi process start, chỉ được set true ở CUỐI CÙNG của ClientReady, sau
// khi mọi bước load/ensure/đăng ký đã chạy xong hoàn toàn.
//
// Trong lúc ready === false, mọi entry point mà người dùng có thể "gọi" bot
// (lệnh nm!..., slash command, bấm nút, submit modal, tag bot, từ khóa auto
// chat, gửi ảnh vào kênh Thí Kiếm...) PHẢI tự kiểm tra isBotReady() và, nếu
// đang gọi bot thật sự, trả lời NOT_READY_MESSAGE thay vì xử lý bình thường
// — tránh lỗi do thiếu dữ liệu (state rỗng, sheet chưa nạp...).
let ready = false;

const NOT_READY_MESSAGE = 'Bot đang nạp thông tin, vui lòng thử lại sau.';

function isBotReady() {
  return ready;
}

function setBotReady(value) {
  ready = Boolean(value);
}

// Trả lời NOT_READY_MESSAGE cho 1 tin nhắn (prefix command / gửi ảnh...) —
// best-effort, lỗi gì cũng chỉ log lại, không throw ra ngoài làm crash
// handler đang gọi hàm này.
async function replyNotReadyToMessage(message) {
  try {
    await message.reply(NOT_READY_MESSAGE);
  } catch (error) {
    console.error('Không gửi được thông báo "đang nạp thông tin" (message):', error.message);
  }
}

// Trả lời NOT_READY_MESSAGE cho 1 interaction (slash command / button /
// modal submit) — tự chọn reply() hay followUp() tuỳ interaction đã
// reply/defer hay chưa (tránh lỗi "InteractionAlreadyReplied"), ephemeral để
// đỡ rác kênh chat chung. Best-effort, lỗi gì cũng chỉ log lại.
async function replyNotReadyToInteraction(interaction) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: NOT_READY_MESSAGE, ephemeral: true });
    } else {
      await interaction.reply({ content: NOT_READY_MESSAGE, ephemeral: true });
    }
  } catch (error) {
    console.error('Không gửi được thông báo "đang nạp thông tin" (interaction):', error.message);
  }
}

module.exports = {
  NOT_READY_MESSAGE,
  isBotReady,
  setBotReady,
  replyNotReadyToMessage,
  replyNotReadyToInteraction,
};
