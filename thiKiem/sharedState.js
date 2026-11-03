// ===== Thí Kiếm: trạng thái/tiện ích dùng chung giữa các module =====
// Tách khỏi index.js — để cả luồng nút/modal, luồng dán ảnh trực tiếp và các
// lệnh admin cùng dùng CHUNG 1 Set/mutex (nếu mỗi file tự tạo riêng thì chặn
// trùng lặp và ghi tuần tự sẽ không còn tác dụng).

const { NPC_ROLE_ID, HUB_CHANNEL_ID } = require('../config');
const { createMutex } = require('../utils/coalesce');
const { registerAwaitProvider } = require('../hub/messageGuard');

// Discord ID của những người đang có 1 yêu cầu cập nhật điểm đang xử lý dở
// (từ lúc submit modal tới lúc trả kết quả) — chặn bấm nút/submit trùng lặp
// trong lúc đó. LUÔN xoá trong try/finally để không bị kẹt mãi nếu lỗi giữa
// chừng.
const processingUsers = new Set();

// Nhiều người cập nhật điểm CÙNG LÚC: phần GHI sheet (đọc-rồi-ghi theo số dòng) chạy
// TUẦN TỰ qua mutex này để 2 lượt không đọc chung 1 bản chụp rồi ghi chồng lên nhau
// (hoặc /xoa-diem-thi-kiem làm lệch số dòng giữa chừng). Phần chậm (tải ảnh + Gemini
// Vision) vẫn chạy song song, ngoài mutex. Việc edit bảng xếp hạng thì gộp lượt —
// xem board.js::refreshLeaderboardMessage.
const rankSheetMutex = createMutex();

// ---- Phiên "chờ ảnh cập nhật điểm" ở kênh HUB ----
// Kênh Hub chỉ giữ ảnh của người đang có phiên chờ (hub/messageGuard.js) — mọi
// tin khác bị xoá ngay, không báo gì. Trước đây Thí Kiếm KHÔNG đăng ký phiên
// chờ nên ảnh dán thẳng vào chat Hub (hoặc ảnh "lọt" ra ô chat khi dán vào
// popup) bị gác cổng xoá mà không ai xử lý => "xoá hình chứ không update".
// Giờ: bấm mục "Đua Rank Thí Kiếm" trong menu Hub (hoặc nút "Cập nhật điểm")
// mở phiên chờ RANK_AWAIT_TTL_MS; trong lúc đó ảnh người này gửi vào kênh Hub
// được xử lý như ảnh cập nhật điểm (xem updateHandlers.js::handleBoardChannelMessage).
const RANK_AWAIT_TTL_MS = 5 * 60 * 1000;
const rankAwaitingUsers = new Map(); // userId -> hết hạn lúc (ms)

function markRankAwaiting(userId) {
  if (userId) rankAwaitingUsers.set(userId, Date.now() + RANK_AWAIT_TTL_MS);
}

function clearRankAwaiting(userId) {
  rankAwaitingUsers.delete(userId);
}

function isRankAwaiting(userId) {
  const expiresAt = rankAwaitingUsers.get(userId);
  if (!expiresAt) return false;
  if (expiresAt < Date.now()) {
    rankAwaitingUsers.delete(userId);
    return false;
  }
  return true;
}

// Báo lớp gác cổng Hub "người này đang chờ gửi ảnh cập nhật điểm" để KHÔNG xoá
// ảnh của họ (processingUsers: đang xử lý — ảnh gốc còn cần tải).
registerAwaitProvider('thiKiem', (userId, channelId) => (
  channelId === HUB_CHANNEL_ID && (isRankAwaiting(userId) || processingUsers.has(userId))
));

function isAdmin(member) {
  return Boolean(member && member.roles && member.roles.cache.has(NPC_ROLE_ID));
}

module.exports = { processingUsers, rankSheetMutex, isAdmin, markRankAwaiting, clearRankAwaiting, isRankAwaiting };
