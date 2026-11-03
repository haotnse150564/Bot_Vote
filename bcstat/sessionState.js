// ===== /bcstat: trạng thái phiên (in-memory) + hàng đợi ảnh + helper phiên =====
// Tách khỏi index.js. TOÀN BỘ Map/Set ở đây là trạng thái DÙNG CHUNG giữa các
// module handler — luôn require từ file này (không tự tạo Map riêng), nếu
// không các handler sẽ nhìn thấy dữ liệu phiên khác nhau.

const { NPC_ROLE_ID, BCSTAT_AWAIT_IMAGE_TIMEOUT_MS } = require('../config');
const { registerAwaitProvider } = require('../hub/messageGuard');
const { TAB_NAMES, TAB_CATEGORY_KEYS, CATEGORIES } = require('../googleSheets/bcStatSheet');
const { buildMainMenuPayload } = require('./format');

const LABEL_BY_KEY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));
// { [tabName]: [label,...] } ĐÚNG THỨ TỰ cột cho từng tab — dùng cho chế độ
// "Gửi ảnh tự động" (xem processImage bên dưới + geminiVision.js::analyzeBcStatScreenshotAuto).
const CATEGORY_LABELS_BY_TAB = Object.fromEntries(
  TAB_NAMES.map((tab) => [tab, TAB_CATEGORY_KEYS[tab].map((k) => LABEL_BY_KEY[k])])
);

// userId -> session. Chỉ 1 phiên đang mở/người tại 1 thời điểm.
const sessions = new Map();
// userId -> mảng [{name, suggestion}] (tên chưa khớp NHƯNG có gợi ý) đang
// hiện trong select menu "🔗 Xem & xác nhận tên chưa khớp" — cache tạm để
// tra lại đúng cặp tên khi người dùng tích chọn (1 hoặc nhiều) dòng rồi
// bấm xác nhận (Discord select/button chỉ mang lại index qua
// customId/values, không mang lại nguyên object). Mất khi bot restart —
// không sao, bấm lại nút để tính lại.
const pendingUnmatchedByUser = new Map();
// userId -> mảng [{name, suggestion}] ĐÃ TÍCH CHỌN ở select menu, đang chờ
// bấm "✅ Xác nhận gộp (N)" ở màn xác nhận gộp hàng loạt
// (buildBulkMergeConfirmPayload) — tách riêng khỏi pendingUnmatchedByUser
// vì đây là tập con NPC vừa chọn, còn pendingUnmatchedByUser vẫn giữ
// nguyên toàn bộ danh sách để tra lại index nếu NPC bấm Huỷ rồi chọn lại.
const pendingBulkSelectionByUser = new Map();
// userId -> mảng nhãn trận (string) đang hiện trong select menu "✏️ Sửa
// trận đã lưu" (buildMatchEditSelectPayload) — cache tạm để tra lại đúng
// nhãn trận theo index khi người dùng chọn 1 dòng (xem handleMatchEditSelect).
const pendingMatchEditListByUser = new Map();
// userId -> nhãn trận GỐC (string) vừa chọn ở select menu trên, giữ tới khi
// submit modal buildMatchLabelModal({mode:'edit'}) để biết cần ĐỔI TÊN từ
// nhãn nào sang nhãn mới (xem handleMatchModalSubmit -> updateCumulative's
// renameFromLabel).
const pendingMatchEditByUser = new Map();
// userId đang xử lý ảnh (Gemini Vision) — chặn xử lý chồng chéo nếu gửi
// nhiều ảnh dồn dập trong lúc ảnh trước còn chưa xong.
const processingUsers = new Set();
// Kênh Hub chỉ nhận tin nhắn của người đang có phiên chờ (hub/messageGuard.js): đang
// chờ ảnh ở đúng kênh này, hoặc đang xử lý/xếp hàng ảnh (job còn cần tải ảnh từ tin gốc).
registerAwaitProvider('bcstat', (userId, channelId) => {
  const session = sessions.get(userId);
  if (session && session.awaiting && session.awaiting.channelId === channelId) return true;
  return processingUsers.has(userId);
});
// userId -> danh sách job (Function async) đang XẾP HÀNG chờ, vì lúc gửi
// tới đã có 1 batch ảnh KHÁC của CHÍNH người đó đang xử lý dở (Gemini
// Vision mất vài giây/ảnh, gửi dồn dập nhiều batch liên tiếp là chuyện
// thường — vd vừa gửi 1 loạt ảnh trong kênh, vừa bấm "📤 Chọn ảnh" gửi
// thêm 1 loạt khác trong lúc loạt trước còn đang đọc). Thay vì bỏ qua/báo
// lỗi, giữ lại và tự động xử lý TIẾP THEO ngay khi batch đang chạy (và mọi
// batch xếp hàng TRƯỚC nó) xong — đúng thứ tự đã gửi (FIFO), xem
// runQueued() ngay bên dưới.
const pendingQueues = new Map();

// Chạy `job` ngay nếu `userId` hiện KHÔNG có batch nào đang xử lý; nếu đang
// bận thì xếp `job` vào cuối hàng đợi của `userId` và trả về ngay
// ({queued:true}) — KHÔNG await job ở đây, job sẽ tự được gọi lại (đúng thứ
// tự FIFO) trong vòng lặp bên dưới, ngay sau khi job đang chạy hoàn tất.
// processingUsers chỉ được xoá khi hàng đợi của người đó rỗng hẳn, để
// job xếp hàng kế tiếp coi như vẫn đang "trong lúc xử lý ảnh trước" nếu có
// thêm batch mới gửi tới giữa chừng.
async function runQueued(userId, job) {
  if (processingUsers.has(userId)) {
    if (!pendingQueues.has(userId)) pendingQueues.set(userId, []);
    pendingQueues.get(userId).push(job);
    return { queued: true };
  }

  processingUsers.add(userId);
  try {
    await job();
    while (pendingQueues.has(userId) && pendingQueues.get(userId).length) {
      const queue = pendingQueues.get(userId);
      const nextJob = queue.shift();
      if (!queue.length) pendingQueues.delete(userId);
      // eslint-disable-next-line no-await-in-loop -- CỐ Ý chạy tuần tự
      // từng job theo đúng thứ tự đã xếp hàng, không chạy song song.
      await nextJob();
    }
  } finally {
    processingUsers.delete(userId);
  }
  return { queued: false };
}

function isAdmin(member) {
  return Boolean(member && member.roles && member.roles.cache.has(NPC_ROLE_ID));
}

function getOrCreateSession(userId, guildId) {
  let session = sessions.get(userId);
  if (!session) {
    session = { guildId, tabs: {}, awaiting: null };
    sessions.set(userId, session);
  }
  return session;
}

function clearAwaitingTimeout(session) {
  if (session.awaiting && session.awaiting.timeoutHandle) {
    clearTimeout(session.awaiting.timeoutHandle);
  }
}

// Hết giờ chờ ảnh (không có ảnh mới trong BCSTAT_AWAIT_IMAGE_TIMEOUT_MS) ->
// tự quay về màn hình chọn tab, KHÔNG mất dữ liệu đã thu thập được của tab đó.
function scheduleAwaitTimeout(userId) {
  return setTimeout(async () => {
    const session = sessions.get(userId);
    if (!session || !session.awaiting) return;
    const { controlInteraction } = session.awaiting;
    session.awaiting = null;
    try {
      await controlInteraction.editReply({
        ...buildMainMenuPayload(session),
        content: '⏳ Đã dừng chờ ảnh do quá lâu không có ảnh mới. Dữ liệu đã gửi trước đó vẫn được giữ.',
      });
    } catch (error) {
      console.error('Không cập nhật được màn hình /bcstat sau khi hết giờ chờ ảnh:', error.message);
    }
  }, BCSTAT_AWAIT_IMAGE_TIMEOUT_MS);
}

module.exports = {
  LABEL_BY_KEY,
  CATEGORY_LABELS_BY_TAB,
  sessions,
  pendingUnmatchedByUser,
  pendingBulkSelectionByUser,
  pendingMatchEditListByUser,
  pendingMatchEditByUser,
  processingUsers,
  pendingQueues,
  runQueued,
  isAdmin,
  getOrCreateSession,
  clearAwaitingTimeout,
  scheduleAwaitTimeout,
};
