// ===== Dọn sạch kênh Hub (menu tính năng) mỗi lần deploy =====
// LƯU Ý (đã gộp về kênh Hub): kênh HUB_CHANNEL_ID (config.js) là kênh cố định duy nhất
// — mỗi lần khởi động bot XOÁ SẠCH kênh này rồi đăng lại đúng 1 tin menu (hub/index.js).
// Các mô tả bên dưới về 3 tin Vinh Danh/Thí Kiếm là của thiết kế CŨ (nay chỉ áp dụng
// nếu ai đó set ENV kênh riêng cho THIKIEM_BOARD_CHANNEL_ID/VINHDANH_CHANNEL_ID).
//
// ===== Dọn sạch kênh Đua Rank Thí Kiếm / Sảnh Vinh Danh Bang Chiến mỗi lần
// deploy =====
// TRƯỚC ĐÂY: ensureVinhDanhMessagesPosted() / ensureThiKiemMessagesPosted()
// chỉ ĐĂNG LẠI tin cố định nào bị xoá tay (fetch theo ID lưu trong Config
// Sheet, không tìm thấy mới gửi tin mới) — các tin cũ vẫn giữ nguyên nếu
// còn tồn tại, nên nút bấm có thể "trôi" xuống dưới các tin nhắn rác khác
// lỡ lọt vào kênh, hoặc bị kẹt ở trạng thái cũ nếu Discord cache lỗi.
//
// THEO YÊU CẦU MỚI: MỖI LẦN BOT KHỞI ĐỘNG (deploy) phải XOÁ SẠCH toàn bộ
// tin nhắn đang có trong kênh này rồi ĐĂNG LẠI TỪ ĐẦU đúng 3 tin cố định,
// theo thứ tự (xem index.js — client.once(Events.ClientReady...)):
//   1. Sảnh Vinh Danh Bang Chiến (embed) — vinhDanh/index.js
//   2. Bảng Xếp Hạng Đua Rank Thí Kiếm — Điểm Rank Tổng (embed) — thiKiem/index.js
//   3. Nút "📤 Cập nhật điểm" + "🔍 Xem Rank" (tin nút bấm) — thiKiem/index.js
//
// resetFixedBoardChannels() PHẢI được gọi TRƯỚC ensureVinhDanhMessagesPosted()
// / ensureThiKiemMessagesPosted() trong index.js. 2 hàm đó giờ LUÔN gửi tin
// mới (không còn thử fetch lại ID cũ trước) vì kênh vừa được dọn sạch,
// chắc chắn không còn tin nào để tìm lại.
const client = require('../client');
const { HUB_CHANNEL_ID, VINHDANH_CHANNEL_ID, THIKIEM_BOARD_CHANNEL_ID } = require('../config');

// Xoá TOÀN BỘ tin nhắn trong 1 kênh — fetch từng lô tối đa 100 tin (giới
// hạn của Discord API), ưu tiên bulkDelete (nhanh, đỡ tốn rate limit) cho
// tin nhắn < 14 ngày tuổi. bulkDelete(messages, true) tự ĐỘNG BỎ QUA (không
// throw lỗi) tin nào >= 14 ngày tuổi — mảng trả về chỉ gồm tin ĐÃ xoá được,
// nên tin còn sót (quá hạn bulkDelete) phải xoá tay từng tin 1. Lặp tới khi
// fetch về rỗng (kênh đã sạch hẳn).
async function purgeAllMessages(channel) {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const messages = await channel.messages.fetch({ limit: 100 });
    if (!messages.size) break;

    try {
      const deleted = await channel.bulkDelete(messages, true);
      if (deleted.size < messages.size) {
        const remaining = messages.filter((m) => !deleted.has(m.id));
        for (const msg of remaining.values()) {
          await msg.delete().catch(() => {});
        }
      }
    } catch (error) {
      // bulkDelete lỗi bất thường (vd mất quyền giữa chừng) -> fallback xoá
      // tay từng tin 1, không để cả bước dọn kênh chết cứng vì 1 lỗi lẻ.
      for (const msg of messages.values()) {
        await msg.delete().catch(() => {});
      }
    }

    if (messages.size < 100) break; // lô cuối cùng đã fetch hết, kênh sạch
  }
}

// Gọi 1 lần lúc ClientReady, TRƯỚC ensureVinhDanhMessagesPosted() /
// ensureThiKiemMessagesPosted(). VINHDANH_CHANNEL_ID mặc định TRÙNG
// THIKIEM_BOARD_CHANNEL_ID (dùng chung 1 kênh — xem config.js) nên gom lại
// bằng Set, tránh dọn trùng 2 lần cùng 1 kênh nếu 2 biến đang trỏ y hệt
// nhau (trường hợp mặc định); vẫn dọn đủ CẢ HAI kênh nếu ai đó set 2 ENV
// riêng biệt (VINHDANH_CHANNEL_ID khác THIKIEM_BOARD_CHANNEL_ID).
async function resetFixedBoardChannels() {
  // HUB_CHANNEL_ID (kênh menu duy nhất) LUÔN nằm trong danh sách để tin menu được
  // đăng lại sạch sẽ mỗi lần deploy. Các ID trùng nhau được Set gộp lại, không dọn trùng 2 lần.
  const channelIds = [...new Set([HUB_CHANNEL_ID, VINHDANH_CHANNEL_ID, THIKIEM_BOARD_CHANNEL_ID].filter(Boolean))];

  for (const channelId of channelIds) {
    try {
      const channel = await client.channels.fetch(channelId);
      await purgeAllMessages(channel);
      console.log(`Đã dọn sạch tin nhắn cũ trong kênh ${channelId} trước khi đăng lại tin cố định.`);
    } catch (error) {
      console.error(`Không dọn sạch được kênh ${channelId} trước khi đăng lại tin cố định:`, error.message);
    }
  }
}

module.exports = { resetFixedBoardChannels };
