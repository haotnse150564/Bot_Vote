// Dựng embed + hàng nút cho /wherebc /wherescrim1 /wherescrim2 (và bản
// tin nhắn thường nm!wherebc / nm!wherescrim1 / nm!wherescrim2) — dùng
// chung giữa commands/slashCommands.js và commands/messageCommands.js để
// không lặp code, tránh 2 nơi lệch nhau khi sửa giao diện sau này.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

// customId của các nút liên quan tới /wherebc /wherescrim1 /wherescrim2:
// - `where_<key>`   : "Xem Vị Trí Của Bạn" (key: 'bc' | 'scrim1' | 'scrim2')
// - `where_all`     : "Xem phân công của bạn" — nút gộp CẢ 3 khu vực (Bang
//   Chiến/Scrim 1/Scrim 2) trong 1 lần bấm, dùng cho câu hỏi kiểu "scrim/bc
//   tôi đi đâu" (xem AutoReply/index.js). Đặt tên riêng (không dùng prefix
//   WHERE_BUTTON_PREFIX ở trên) vì nó không có "key" 1 khu vực cụ thể như 2
//   loại kia — xử lý bằng handleWhereAllButton riêng trong slashCommands.js.
//
// ĐÃ BỎ nút "Làm Mới" (trước đây gọi Apps Script Web App để đồng bộ lại tab
// "List BC/Scrim") — dữ liệu giờ đọc thẳng từ tab "Nhật Ký Đội Hình", do
// trang web NMTeam ghi trực tiếp mỗi lần NPC bấm "Đăng ảnh"/"Cập nhật ảnh",
// nên luôn LÀ MỚI NHẤT ngay khi bấm "Xem Vị Trí Của Bạn", không cần bước
// làm mới thủ công nào nữa (xem googleSheets/listSheet.js).
const WHERE_BUTTON_PREFIX = 'where_';
const WHERE_ALL_BUTTON_ID = 'where_all';

// Màu viền embed cho tin nhắn /wherebc /wherescrim1 /wherescrim2 (giống màu
// tím/hồng trong ảnh mẫu người dùng gửi).
const WHERE_EMBED_COLOR = 0xEB459E;

function buildWhereActionRow(key) {
  const viewButton = new ButtonBuilder()
    .setCustomId(`${WHERE_BUTTON_PREFIX}${key}`)
    .setLabel('Xem Vị Trí Của Bạn')
    .setStyle(ButtonStyle.Primary);

  return new ActionRowBuilder().addComponents(viewButton);
}

// Hàng nút cho câu hỏi gộp "scrim/bc tôi đi đâu" — chỉ 1 nút duy nhất, bấm
// vào là ra ngay cả 3 khu vực (Bang Chiến/Scrim 1/Scrim 2), không cần chọn
// riêng từng khu vực như buildWhereActionRow ở trên.
function buildWhereAllActionRow() {
  const viewButton = new ButtonBuilder()
    .setCustomId(WHERE_ALL_BUTTON_ID)
    .setLabel('Xem Phân Công Của Bạn')
    .setEmoji('📋')
    .setStyle(ButtonStyle.Primary);

  return new ActionRowBuilder().addComponents(viewButton);
}

function buildWhereEmbed(label, dayLabel) {
  const heading = dayLabel ? `Scrim ${dayLabel}` : label.toUpperCase();

  return new EmbedBuilder()
    .setColor(WHERE_EMBED_COLOR)
    .setDescription(`# Xem phân công của bạn trong: ${heading}`);
}

// key: 'bc' | 'scrim1' | 'scrim2', scrimData: object từ state.js.
// Trả về Thứ mấy của buổi đó (VD "Thứ 5") — LẤY ĐÚNG GIÁ TRỊ ĐANG DÙNG Ở
// /scrim (scrimData.session1Day / session2Day, cập nhật qua /us1 /us2).
// Bang Chiến không có "ngày trong tuần" động (cố định Thứ 7 theo config) nên
// trả về null.
function getWhereDayLabel(key, scrimData) {
  if (key === 'scrim1') return scrimData.session1Day || null;
  if (key === 'scrim2') return scrimData.session2Day || null;
  return null;
}

module.exports = {
  WHERE_BUTTON_PREFIX,
  WHERE_ALL_BUTTON_ID,
  buildWhereActionRow,
  buildWhereAllActionRow,
  buildWhereEmbed,
  getWhereDayLabel,
};
