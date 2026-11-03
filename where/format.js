// Format tin nhắn ephemeral trả lời khi người dùng bấm nút 
// "Xem Vị Trí Của Bạn" từ /wherebc /wherescrim1 /wherescrim2 (xem
// googleSheets/listSheet.js để biết cách lấy dữ liệu, config.js để biết
// cấu trúc cột).
const { WHERE_LOCATION_LABELS } = require('../config');

// Gắn thêm chú thích số team tổng (1-10) sau nhãn vị trí kiểu "Đoàn x - Team y":
//   Đoàn 1 - Team 1..5 -> (Team 1..5)   |   Đoàn 2 - Team 1..5 -> (Team 6..10)
// Giữ NGUYÊN nhãn gốc, chỉ nối thêm chú thích ở cuối. Nhãn không đúng dạng
// (đổi tên Đoàn/Team, Đoàn 3 trở đi, "Dự bị", rỗng...) thì trả lại y nguyên.
const TEAM_LABEL_REGEX = /^\s*[Đđ]oàn\s*(\d+)\s*[-–—]\s*Team\s*(\d+)\s*$/i;
function annotateViTri(viTri) {
  const text = String(viTri == null ? '' : viTri);
  const m = TEAM_LABEL_REGEX.exec(text);
  if (!m) return text;
  const doan = Number(m[1]);
  const team = Number(m[2]);
  if (doan < 1 || doan > 2 || team < 1 || team > 5) return text;
  return `${text.trim()} (Team ${(doan - 1) * 5 + team})`;
}

// key: 'bc' | 'scrim1' | 'scrim2'
// info: { ingame, className, viTri, phanCong, ghiChu } (từ getUserLocationInfo)
function formatWhereMessage(key, info) {
  const label = WHERE_LOCATION_LABELS[key] || key;

  return (
    `# ${label} của ${info.ingame}\n` +
    `**Class:** ${info.className}\n` +
    `**Vị Trí:** ${annotateViTri(info.viTri)}\n` +
    `**Phân Công:** ${info.phanCong}\n` +
    `**Ghi Chú:** ${info.ghiChu}`
  );
}

// Format tin nhắn ephemeral trả lời cho câu hỏi "scrim/bc tôi đi đâu" (xem
// AutoReply/index.js -> WHERE_ALL_TRIGGER và commands/slashCommands.js ->
// handleWhereAllButton) — gộp CẢ 3 khu vực (Bang Chiến/Scrim 1/Scrim 2)
// trong CÙNG 1 tin nhắn thay vì phải hỏi riêng từng khu vực như
// /wherebc /wherescrim1 /wherescrim2.
//
// info: { ingame, className, bc: { viTri, phanCong }, scrim1: { viTri, phanCong },
//         scrim2: { viTri, phanCong } } (từ getUserLocationInfoAll)
// dayLabels: { scrim1: string|null, scrim2: string|null } (từ getWhereDayLabel
// trong where/ui.js — VD "Thứ 5") — Bang Chiến không có ngày động nên không
// cần truyền.
function formatWhereAllMessage(info, dayLabels = {}) {
  const buildSection = (key) => {
    const label = WHERE_LOCATION_LABELS[key] || key;
    const dayLabel = dayLabels[key];
    const heading = dayLabel ? `${label} (${dayLabel})` : label;
    const area = info[key];

    return `**${heading}**\n* Team: ${annotateViTri(area.viTri)}\n* Phân công: ${area.phanCong}`;
  };

  return (
    `# Bạn được phân công trong:\n\n` +
    `${buildSection('bc')}\n\n` +
    `${buildSection('scrim1')}\n\n` +
    `${buildSection('scrim2')}`
  );
}

// Nội dung DM báo "Vị Trí của bạn vừa thay đổi" — gửi khi NPC bấm "Cập nhật
// ảnh" Đội Hình bên trang Team (NMTeam), sau khi trang web đã tự so sánh Vị
// Trí cũ/mới trên tab "List BC/Scrim" (xem NMTeam/server.js ->
// POST /api/push-to-bot, gọi sang admin/api.js -> POST
// /admin/dm-position-change). Bot ở đây chỉ lo phần định dạng + gửi DM,
// KHÔNG tự so sánh gì thêm — dữ liệu nhận vào đã được lọc sẵn chỉ gồm người
// có thay đổi thật sự.
// key: 'bc' | 'scrim1' | 'scrim2'
// change: { ingame, oldViTri, newViTri, oldPhanCong, newPhanCong, type }
// type: 'changed' (đổi vị trí) | 'removed' (bị gỡ khỏi đội hình — hiển thị
//       như đổi sang "Dự bị"). KHÔNG có 'new' — vừa được xếp lần đầu (chưa
//       từng có vị trí cũ) thì KHÔNG DM, xem NMTeam/server.js.
function formatPositionChangeDm(key, change) {
  const label = WHERE_LOCATION_LABELS[key] || key;
  const ingame = change.ingame || 'bạn';

  // 'removed' hiển thị y như đổi vị trí bình thường, chỉ khác là vị trí MỚI
  // luôn là "Dự bị" (không dùng chữ "bị gỡ" — tránh nghe tiêu cực).
  const newViTriDisplay = change.type === 'removed' ? 'Dự bị' : annotateViTri(change.newViTri || 'Chưa có');
  const oldViTriDisplay = annotateViTri(change.oldViTri || 'Dự bị');
  const phanCongDisplay = change.type === 'removed' ? 'Không có' : (change.newPhanCong || 'Không có');

  const viTriLine = `**Vị Trí:** từ **${oldViTriDisplay}** sang **${newViTriDisplay}**`;

  return (
    `# 🔔 ${label} — Vị trí của bạn có thay đổi\n` +
    `Chào **${ingame}**, đội hình **${label}** vừa được cập nhật:\n` +
    `${viTriLine}\n` +
    `**Phân Công:** ${phanCongDisplay}\n` +
    `-# Xem thông báo mới nhất - đã cập nhật hình ảnh để kiểm tra lại chi tiết.`
  );
}

module.exports = { formatWhereMessage, formatWhereAllMessage, formatPositionChangeDm, annotateViTri };