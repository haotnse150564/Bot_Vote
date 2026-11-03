// Lưu tạm (trong RAM) ảnh PNG Đội Hình do trang web (nút "Xuất PNG" trên
// team.html của NMTeam) gửi lên qua POST /admin/srcimage/stage — thay thế
// hoàn toàn cho cách cũ là bot tự chụp ảnh từ Google Sheet
// (googleSheets/screenshotSheet.js, KHÔNG còn được gọi nữa vì NMTeam không
// còn dùng Google Sheet để xếp đội hình).
//
// CHỦ Ý không lưu qua saveState() (state.js/googleSheets/stateSheet.js):
// đây chỉ là ảnh tạm để đăng ngay, không cần sống sót qua lần bot restart —
// nếu bot restart giữa chừng, NPC chỉ cần bấm lại "Xuất PNG" trên web 1 lần
// nữa là có ảnh mới ngay, không cần cơ chế phức tạp hơn.

const SRC_IMAGE_KEYS = ['scrim1', 'scrim2', 'bc'];
const MAX_IMAGE_BYTES = 18 * 1024 * 1024; // 18MB — giới hạn Discord miễn phí hiện là 20MB (tăng từ mốc 8MB cũ), chừa khoảng dư an toàn

const staged = { scrim1: null, scrim2: null, bc: null }; // key -> { buffer, updatedAt } | null

// Ném lỗi nếu key hoặc dung lượng ảnh không hợp lệ — để route gọi hàm này
// trả về 400 rõ ràng thay vì âm thầm lưu rác.
function setStagedImage(key, buffer) {
  if (!SRC_IMAGE_KEYS.includes(key)) {
    throw new Error(`key không hợp lệ: ${key}`);
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Dữ liệu ảnh trống hoặc không hợp lệ.');
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error('Ảnh quá lớn (giới hạn 8MB).');
  }
  staged[key] = { buffer, updatedAt: new Date() };
}

// Trả về { buffer, updatedAt } hoặc null nếu chưa có ai xuất ảnh cho key này.
function getStagedImage(key) {
  return staged[key] || null;
}

module.exports = { SRC_IMAGE_KEYS, setStagedImage, getStagedImage };