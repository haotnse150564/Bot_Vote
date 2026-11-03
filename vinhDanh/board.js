// ===== Sảnh Vinh Danh Bang Chiến: đăng/refresh tin cố định =====
// Tách khỏi index.js.

const client = require('../client');
const { HUB_CHANNEL_ID, VINHDANH_CHANNEL_ID } = require('../config');
const { getVinhDanhConfig, setVinhDanhConfigValues, getLatestBatchEntries } = require('../googleSheets/vinhDanhSheet');
const { formatVinhDanhBoardEmbed } = require('./format');
const { retryOnQuotaExceeded } = require('../utils/retry');
const { createCoalescedRunner } = require('../utils/coalesce');

// Đăng LẠI TỪ ĐẦU tin cố định "Sảnh Vinh Danh" — gọi 1 lần lúc ClientReady,
// SAU khi resetFixedBoardChannels() (utils/channelReset.js) đã dọn sạch
// kênh, giống ensureThiKiemMessagesPosted(). LUÔN gửi tin mới (không thử
// fetch lại ID cũ nữa) vì kênh vừa được dọn sạch mỗi lần deploy theo yêu
// cầu mới — tin cũ chắc chắn không còn tồn tại để tìm lại.
async function ensureVinhDanhMessagesPosted() {
  if (!VINHDANH_CHANNEL_ID || VINHDANH_CHANNEL_ID === HUB_CHANNEL_ID) return; // kênh Hub chỉ có tin menu

  try {
    const channel = await client.channels.fetch(VINHDANH_CHANNEL_ID);

    // Đọc sheet (dễ dính quota nhất lúc mới deploy — xem utils/retry.js) —
    // TÁCH RIÊNG khỏi bước gửi tin bên dưới để nếu phải thử lại thì chỉ
    // gọi lại đúng phần đọc sheet, KHÔNG gửi trùng thêm 1 tin Discord mới.
    const latest = await retryOnQuotaExceeded(() => getLatestBatchEntries(), {
      label: 'Đọc lịch sử Sảnh Vinh Danh Bang Chiến',
    });
    const embed = formatVinhDanhBoardEmbed(latest?.ngayVinhDanh, latest?.entries || []);
    const boardMessage = await channel.send({ embeds: [embed] });

    // Ghi ID tin vừa gửi vào Config — cũng tách riêng + tự thử lại nếu
    // dính quota, KHÔNG gửi lại tin (đã gửi thành công ở trên rồi).
    await retryOnQuotaExceeded(
      () => setVinhDanhConfigValues({ board_message_id: boardMessage.id, kenh_id: VINHDANH_CHANNEL_ID }),
      { label: 'Lưu ID tin Sảnh Vinh Danh Bang Chiến' }
    );

    console.log('Đã đăng lại tin Sảnh Vinh Danh Bang Chiến mới (dọn kênh mỗi lần deploy).');
  } catch (error) {
    console.error('Không thể đăng lại tin Sảnh Vinh Danh Bang Chiến:', error.message);
  }
}

// Tính lại từ lô mới nhất trong sheet rồi edit lại đúng tin cố định — gọi
// sau mỗi lần append batch mới. Nếu tin cũ đã bị XOÁ TAY (hoặc chưa từng
// đăng) thì TỰ ĐĂNG LẠI tin mới ngay tại đây (thay vì chỉ cảnh báo rồi bỏ
// qua như trước) — để NPC gọi `/xem-vinh-danh` hoặc gửi ảnh cập nhật mới là
// Sảnh Vinh Danh tự hiện lại, không cần restart bot.
async function refreshVinhDanhBoardNow() {
  if (!VINHDANH_CHANNEL_ID || VINHDANH_CHANNEL_ID === HUB_CHANNEL_ID) return; // kênh Hub chỉ có tin menu

  const latest = await getLatestBatchEntries();
  const embed = formatVinhDanhBoardEmbed(latest?.ngayVinhDanh, latest?.entries || []);
  const config = await getVinhDanhConfig();

  try {
    const channel = await client.channels.fetch(VINHDANH_CHANNEL_ID);

    let message = null;
    if (config.board_message_id) {
      try {
        message = await channel.messages.fetch(config.board_message_id);
      } catch (error) {
        message = null; // tin cũ đã bị xoá tay / không còn tồn tại
      }
    }

    if (message) {
      await message.edit({ embeds: [embed] });
    } else {
      message = await channel.send({ embeds: [embed] });
      await setVinhDanhConfigValues({ board_message_id: message.id, kenh_id: VINHDANH_CHANNEL_ID });
      console.log('Tin Sảnh Vinh Danh Bang Chiến cũ không còn tồn tại — đã đăng lại tin mới.');
    }
  } catch (error) {
    console.error('Không edit/đăng lại được tin Sảnh Vinh Danh Bang Chiến:', error.message);
  }
}

// Gộp lượt khi nhiều lời gọi tới cùng lúc (xem utils/coalesce.js): không edit tin
// chồng chéo, luôn hiện bản đọc từ sheet SAU lần append gần nhất.
const refreshVinhDanhBoard = createCoalescedRunner(refreshVinhDanhBoardNow);

// ===== Menu Hub: chọn "Vinh Danh Bang Chiến" (CHỈ role NPC) =====
// Embed Sảnh Vinh Danh mới nhất (đọc từ sheet lịch sử).
async function buildVinhDanhBoardEmbedForHub() {
  const latest = await getLatestBatchEntries();
  return formatVinhDanhBoardEmbed(latest?.ngayVinhDanh, latest?.entries || []);
}

module.exports = {
  ensureVinhDanhMessagesPosted,
  refreshVinhDanhBoard,
  buildVinhDanhBoardEmbedForHub,
};
