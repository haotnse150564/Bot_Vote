// State dùng chung, được các module khác import và MUTATE trực tiếp
// (giữ đúng hành vi gốc: các object này là "nguồn sự thật" trong bộ nhớ).

// Scrim schedule data
// A/G = ngày trong tuần của buổi (VD: Thứ 4/5/6). B,C và H,I = giờ + ngày/tháng.
// D/K = đối thủ. F/L = số trận.
const scrimData = {
  session1Day: 'Thứ 5',
  session1Time: '',
  session1Date: '',
  session1Opponent: 'Đang tìm...',
  session1Matches: '2',
  session2Day: 'Đang tìm',
  session2Time: '',
  session2Date: '',
  session2Opponent: 'Đang tìm...',
  session2Matches: '2',
  messageId: null,
  channelId: null,
  updatedAt: null,
};

// Bang chiến offline check-in message data
const bcData = {
  messageId: null,
  channelId: null,
};

// Lưu message đã gửi ảnh chụp sheet nguồn (Scrim 1 / Scrim 2 / Bang Chiến).
// Lần chạy lệnh nm!uploadsrcim1/2, nm!uploadBC tiếp theo sẽ EDIT lại đúng
// message này (thay ảnh + nội dung mới) thay vì gửi tin mới mỗi lần, vì ảnh
// chụp có thể thay đổi theo thời gian chứ không cố định.
const srcImageData = {
  scrim1: { messageId: null, channelId: null, mentionRoleId: null },
  scrim2: { messageId: null, channelId: null, mentionRoleId: null },
  bc: { messageId: null, channelId: null, mentionRoleId: null },
};

// Kênh chat CỐ ĐỊNH do admin từng server (KHÁC server gốc) tự set bằng lệnh
// nm!setchatchannel — map guildId -> MẢNG channelId (1 server có thể cho
// phép nhiều kênh chat cùng lúc, dùng nm!setchatchannel nhiều lần để thêm
// kênh, nm!removechatchannel để bỏ bớt). Server gốc KHÔNG dùng map này
// (server gốc dùng CHAT_DISABLED_CHANNEL_ID trong config.js, xem
// AutoReply/index.js). Với các server khác, tính năng trò chuyện (từ khóa,
// mention, "bot ơi, ...", tag bot) CHỈ hoạt động trong các kênh đã set ở
// đây — chưa set thì bot im lặng, không trò chuyện ở server đó.
// Lưu ý: dữ liệu cũ (từ trước khi hỗ trợ nhiều kênh) có thể là string đơn
// (channelId) thay vì mảng — code đọc map này cần tự xử lý cả 2 dạng để
// tương thích ngược (xem chatChannelsFor() trong AutoReply/index.js).
const chatChannels = {};

// Tracks the date (yyyy-mm-dd, VN time) each reminder was last sent, to avoid duplicate sends
const reminderState = {
  lastBcReminderDate: null,
  lastBcCheckinDate: null, // điểm danh Bang Chiến tự động Thứ 4 10:00
  lastGcmnReminderDate: null,
  lastScrimSession1ReminderDate: null,
  lastScrimSession2ReminderDate: null,
  lastThu5ReminderDate: null,
  lastBoxSaleReminderDate: null,
  // Auto chat theo giờ cố định (AutoReply/index.js): chào buổi sáng (AI) +
  // 2 mốc nhắc PvP mở cửa/cao điểm, cùng cơ chế guard-theo-ngày như trên.
  lastMorningGreetingDate: null,
  lastPvpOpenReminderDate: null,
  lastPvpPeakReminderDate: null,
};

// Danh sách Discord ID được cấp quyền dùng các tính năng LIÊN QUAN TỚI CHAT
// (/tlmn, set thay profile người khác qua /setpf) ngang với role NPC —
// KHÔNG cấp thêm quyền NPC nào khác. Nạp từ sheet "AccessID" lúc
// ClientReady (xem googleSheets/accessIdSheet.js), thêm mới qua lệnh
// /setidsnpc (chỉ ADMIN_USER_ID dùng được, xem commands/slashCommands.js).
const accessIds = new Set();

// Danh sách tin của "Bảng Tin Nhất Mộng" (googleSheets/noticeBoardSheet.js),
// nạp từ sheet cùng tên lúc ClientReady, dùng cho tính năng tự động đăng tin
// luân phiên vào kênh IDLE_CHAT_CHANNEL_ID (thay thế idle chat cũ, xem
// AutoReply/index.js -> checkNoticeBoard). Mỗi phần tử:
//   { id: string, content: string, lastPostedAt: number|null }
// lastPostedAt = null nghĩa là tin CHƯA TỪNG được đăng lần nào.
const noticeBoardNotices = [];

// Danh sách MẪU nội dung Auto DM (googleSheets/autoDmSheet.js), nạp từ tab
// "Auto DM" lúc ClientReady. Mỗi phần tử: { id: string, content: string }.
const autoDmContents = [];

// Lịch Auto DM (ai nhận, nội dung nào, giờ nào) — nạp từ tab "Auto DM
// Schedule" lúc ClientReady. Mỗi phần tử:
//   { id: string, userId: string, dmId: string, time: string, lastSentDateKey: string|null }
// lastSentDateKey CHỈ tồn tại trong bộ nhớ (không lưu lên sheet — giống hệt
// reminderState phía trên) — dùng để không gửi trùng 2 lần trong CÙNG 1
// ngày; nếu bot restart đúng lúc vừa gửi xong trong ngày, rủi ro gửi trùng 1
// lần là chấp nhận được (đúng tinh thần reminderState đã dùng trước giờ).
const autoDmSchedules = [];

// Lịch Broadcast (gửi tin vào 1 KÊNH cố định mỗi ngày vào 1 giờ cố định) —
// nạp từ tab "Broadcast Schedule" lúc ClientReady (xem
// googleSheets/broadcastScheduleSheet.js). Mỗi phần tử:
//   { id: string, channelId: string, content: string, mentionRoleId: string|null,
//     time: string, lastSentDateKey: string|null }
// lastSentDateKey CHỈ tồn tại trong bộ nhớ (không lưu lên sheet) — cùng cơ
// chế chống gửi trùng trong ngày như autoDmSchedules ở trên.
const broadcastSchedules = [];

// Lịch sử broadcast "Gửi ngay" (KHÁC broadcastSchedules ở trên — mảng này
// chỉ lưu LẠI các tin đã gửi ngay lập tức, không phải tin đang chờ lịch) —
// nạp từ tab "Broadcast History" lúc ClientReady (xem
// googleSheets/broadcastHistorySheet.js). Mỗi phần tử:
//   { id: string, channelId: string, content: string, mentionRoleId: string|null, sentAt: string }
// Mục đích: cho phép admin xem lại/"Dùng lại" (sửa rồi gửi tiếp) một tin
// tuỳ ý đã gửi trước đó thay vì phải gõ lại từ đầu.
const broadcastHistory = [];

// Sự kiện Lịch Bang do admin tạo trên web (googleSheets/lichBangSheet.js), nạp lúc ClientReady.
// Mỗi phần tử: { id, name, weekday (0=CN..6=T7), time "HH:mm", everyWeeks (1-4), anchorDate "YYYY-MM-DD" }
const customScheduleEvents = [];

// Danh sách góp ý của "Hòm Thư Góp Ý" (googleSheets/feedbackSheet.js), nạp
// từ sheet cùng tên lúc ClientReady. Mỗi phần tử:
//   { id: string, content: string, anonymous: boolean, userId: string, createdAt: number }
// userId LUÔN được lưu (kể cả gửi ẩn danh) — chỉ dùng để chống spam server-
// side, KHÔNG hiển thị trên trang quản lý khi anonymous = true (xem
// admin/api.js -> GET /admin/feedback/list).
const feedbackSubmissions = [];

// Check Gear — tin cố định trong CHECK_GEAR_CHANNEL_ID (config.js) nhắc
// check gear phiên bản hiện tại. currentVersion PHẢI được nhớ lại qua mỗi
// lần deploy (bộ nhớ process bị xoá sạch mỗi lần restart) — lưu/khôi phục
// cùng cơ chế scrimData/bcData ở trên, xem googleSheets/stateSheet.js.
// messageId/channelId của tin cố định cũng lưu ở đây để lần deploy sau biết
// đường xoá tin CŨ trước khi đăng tin MỚI (đúng yêu cầu "mỗi lần deploy lại
// bot, xoá tin cũ tạo tin mới trong kênh đó nhưng vẫn phải nhớ lại là đang
// check gear ở phiên bản nào").
const checkGearData = {
  currentVersion: null,
  deadline: null, // dd/mm/yyyy, do NPC set qua /set-check-gear
  messageId: null,
  channelId: null,
};

module.exports = { scrimData, bcData, srcImageData, reminderState, chatChannels, accessIds, noticeBoardNotices, autoDmContents, autoDmSchedules, broadcastSchedules, broadcastHistory, customScheduleEvents, feedbackSubmissions, checkGearData };