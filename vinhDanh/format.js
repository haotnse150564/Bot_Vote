const { EmbedBuilder } = require('discord.js');

const BOARD_COLOR = 0xf1c40f;

// Gộp danh sách entries (đã lấy từ getLatestBatchEntries — có thể có 2 dòng
// cho CÙNG 1 danh hiệu nếu tuần đó 2 trận và 2 người khác nhau đạt được)
// thành mảng theo ĐÚNG thứ tự lần đầu xuất hiện (giữ thứ tự hiển thị trong
// game — không sort lại theo alphabet).
function groupByDanhHieu(entries) {
  const order = [];
  const map = new Map();
  entries.forEach((e) => {
    if (!map.has(e.danhHieu)) {
      map.set(e.danhHieu, []);
      order.push(e.danhHieu);
    }
    map.get(e.danhHieu).push(e);
  });
  return order.map((danhHieu) => ({ danhHieu, winners: map.get(danhHieu) }));
}

// 1 người thắng của 1 danh hiệu -> "**Ingame**" — CHỈ hiện tên ingame, KHÔNG
// kèm tag/mention Discord nữa (theo yêu cầu). Không đọc được tên thì hiện
// placeholder, không báo lỗi gì trên embed.
function formatWinner(entry) {
  return entry.ingame ? `**${entry.ingame}**` : '_(không đọc được tên)_';
}

// winners: mảng 1-2 phần tử (2 phần tử khi tuần đó có 2 trận và ra 2 người
// khác nhau cho CÙNG 1 danh hiệu — trùng tên thì đã bị lọc bỏ trước khi gọi
// hàm này, xem vinhDanh/index.js -> dedupeEntries). Xuống dòng riêng (thay
// vì nối bằng dấu •) vì giờ mỗi danh hiệu là 1 FIELD hẹp, không phải 1 dòng
// dài trong description như trước.
function formatWinnersLine(winners) {
  if (winners.length === 1) return formatWinner(winners[0]);
  return winners.map((w) => (w.tran ? `Trận ${w.tran}: ${formatWinner(w)}` : formatWinner(w))).join('\n');
}

// ngayVinhDanh: chuỗi DD/MM/YYYY (Thứ 7 của tuần đang vinh danh).
//
// Bố cục dùng FIELD của Discord Embed (embed.addFields) — theo đúng ví dụ
// bố cục ở Rank Card cá nhân (thiKiem/format.js -> formatRankCardEmbed):
// mỗi danh hiệu là 1 field riêng (inline), xếp 2 field/hàng trên PC, mỗi
// field 1 hàng full-width trên mobile — RESPONSIVE tự nhiên, không cần tự
// canh khoảng trắng như cách vẽ 1 khối text dài trước đây. Cứ 2 field thì
// chèn 1 field "spacer" (\u200b) full-width để ép Discord xuống hàng mới,
// không cho field thứ 3 tự nhảy lên lấp cùng hàng (Discord mặc định xếp
// tối đa 3 field inline/hàng).
function formatVinhDanhBoardEmbed(ngayVinhDanh, entries) {
  const grouped = groupByDanhHieu(entries);

  const embed = new EmbedBuilder()
    .setTitle('🏆 SẢNH VINH DANH BANG CHIẾN')
    .setDescription(
      `Tuần vinh danh: **${ngayVinhDanh || '?'}**\n` +
        '(Danh hiệu giữ nguyên tới khi có ảnh cập nhật của tuần kế tiếp)'
    )
    .setColor(BOARD_COLOR)
    .setTimestamp(new Date());

  if (!grouped.length) {
    embed.addFields({ name: '\u200b', value: 'Chưa có dữ liệu vinh danh nào.' });
    return embed;
  }

  grouped.forEach((g, idx) => {
    embed.addFields({ name: `🏵️ ${g.danhHieu}`, value: formatWinnersLine(g.winners), inline: true });
    if (idx % 2 === 1 && idx < grouped.length - 1) {
      embed.addFields({ name: '\u200b', value: '\u200b', inline: false });
    }
  });

  return embed;
}

module.exports = { formatVinhDanhBoardEmbed, groupByDanhHieu };