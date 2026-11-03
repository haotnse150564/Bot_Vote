// ===== Lệnh nm!: thống kê vote =====
// nm!checkvote, nm!topvote.

const { scrimData } = require('../state');
const { NPC_ROLE_ID } = require('../config');
const { resyncVoteSheetFromReactions } = require('../googleSheets/voteSheet');
const { getTopVoters } = require('../googleSheets/topVoteSheet');
const { formatTopVoteMessage } = require('../voteStatus/topVoteFormat');

// Trả về true nếu tin nhắn đã được xử lý ở nhóm lệnh này (tương ứng `return;` trong listener gốc).
async function handleVoteMessageCommands(message, content) {
  if (content.toLowerCase() === 'nm!checkvote') {
    if (!message.member || !message.member.roles.cache.has(NPC_ROLE_ID)) {
      message.reply('❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.');
      return true;
    }

    if (!scrimData.messageId || !scrimData.channelId) {
      message.reply('❌ Chưa có tin nhắn vote scrim nào đang hoạt động. Hãy chạy `nm!scrim` trước.');
      return true;
    }

    const statusMessage = await message.reply('🔄 Đang đồng bộ lại toàn bộ react từ tin nhắn vote, vui lòng chờ...');

    const result = await resyncVoteSheetFromReactions();

    if (result.ok) {
      await statusMessage.edit(`✅ Đã đồng bộ lại thành công (${result.count} lượt vote) dựa trên react thực tế trên Discord.`);
    } else {
      await statusMessage.edit('❌ Lỗi khi đồng bộ lại vote. Kiểm tra log của bot để biết chi tiết.');
    }
    return true;
  }

  if (content.toLowerCase() === 'nm!topvote') {
    // Ai cũng xem được (không cần role NPC) — chỉ là xem bảng xếp hạng.
    const topVoters = await getTopVoters(10);

    if (topVoters === null) {
      message.reply('❌ Lỗi khi đọc Bảng Xếp Hạng Chuyên Cần Vote. Kiểm tra log của bot để biết chi tiết.');
      return true;
    }

    message.reply(formatTopVoteMessage(topVoters));
    return true;
  }

  return false;
}

module.exports = {
  handleVoteMessageCommands,
};
