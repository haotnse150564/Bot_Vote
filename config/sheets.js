// ===== config/sheets.js — Google Sheet chính: tab vote/state/broadcast + spreadsheet lịch sử chat, Auto DM, ChatGlobal, quan hệ =====
// Tách khỏi config.js (file gốc giờ chỉ gộp lại các module trong thư mục config/).
// Chỉ chứa giá trị, không chứa logic.

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || 'BotVote';
const DSB_SHEET_NAME = 'DSB';
const RESULT_SHEET_NAME = 'Kết Quả Vote';
// Sheet lưu BẢNG XẾP HẠNG CHUYÊN CẦN VOTE — cộng dồn theo TỪNG TUẦN (khác
// RESULT_SHEET_NAME ở trên, chỉ phản ánh ĐÚNG tuần hiện tại vì BotVote bị
// clear mỗi lần /rsvote). Mỗi khi /rsvote (hoặc nm!rsvote) chạy, số tuần đã
// vote của từng người trong tuần vừa kết thúc được +1 vào sheet này TRƯỚC
// khi BotVote bị xóa — xem googleSheets/topVoteSheet.js + hook trong
// googleSheets/voteSheet.js -> resetVoteSheet(). Lệnh /topvote đọc sheet
// này để in top 10 người chuyên cần vote nhất.
const TOPVOTE_SHEET_NAME = 'BXH Vote';
const BC_SHEET_NAME = 'Vote Off BC';
const AUTOVOTE_SHEET_NAME = 'RoleAutoVote';
// Sheet lưu persistent state (scrimData/bcData) để không mất khi deploy lại.
const STATE_SHEET_NAME = 'BotState';
// Sheet riêng lưu danh sách kênh chat được phép/server — 2 cột serverId |
// channelId, mỗi dòng là 1 cặp (server, channel), 1 server có thể có nhiều
// dòng nếu cho phép nhiều kênh. Tách riêng khỏi BotState (thay vì nhét
// chung 1 blob JSON) để dễ mở sheet lên xem/sửa tay trực tiếp, tránh lưu
// trùng lặp dữ liệu ở 2 chỗ.
const CHAT_CHANNEL_ALLOWS_SHEET_NAME = 'ChatChanelAllows';

// Sheet lưu SNAPSHOT 5 số tổng hợp (Tổng Thứ 4/5/6/Không Đánh/Chưa Vote) của
// MỖI TUẦN — khác RESULT_SHEET_NAME (bị ghi đè mỗi tuần, không giữ lịch sử).
// Mỗi khi resetVoteSheet() chạy (nm!rsvote / /rsvote / nút "Reset Vote" trên
// web), 1 dòng mới được APPEND vào đây TRƯỚC khi BotVote bị xóa — dùng cho
// route GET /admin/stats/history (web vẽ biểu đồ xu hướng tham gia theo
// tuần). Xem googleSheets/voteHistorySheet.js.
const VOTE_HISTORY_SHEET_NAME = 'Lịch Sử Vote';

// Sheet lưu CHI TIẾT theo từng thành viên của MỖI TUẦN (khác
// VOTE_HISTORY_SHEET_NAME ở trên chỉ lưu 5 số TỔNG HỢP, không biết từng
// người vote gì) — mỗi lần resetVoteSheet() chạy, APPEND thêm 1 dòng cho
// MỖI thành viên trong "Kết Quả Vote" tuần đó. Dùng để tính chuỗi số tuần
// liên tục 1 người vote "Không Đánh" hoặc không vote gì — xem route GET
// /admin/stats/absentees và googleSheets/voteHistorySheet.js.
const VOTE_HISTORY_DETAIL_SHEET_NAME = 'Chi Tiết Vote Theo Tuần';

// Sheet "AccessID" (trong BOT_CHAT_HISTORY_SPREADSHEET_ID, cùng spreadsheet
// với ChatGlobal) — lưu danh sách Discord ID được ADMIN_USER_ID cấp quyền
// dùng các tính năng LIÊN QUAN TỚI CHAT ngang với role NPC (hiện tại: gửi
// tin ẩn danh /tlmn + set thay profile người khác qua /setpf) — KHÔNG cấp
// các quyền NPC khác (scrim, bang chiến, checkvote...). Set qua lệnh
// /setidsnpc, chỉ ADMIN_USER_ID mới gọi được lệnh đó. Xem
// googleSheets/accessIdSheet.js + utils/permissions.js.
const ACCESS_ID_SHEET_NAME = 'AccessID';

// Sheet "Broadcast Schedule" (cùng spreadsheet BOT_CHAT_HISTORY_SPREADSHEET_ID
// ở trên) — lên lịch gửi 1 tin nhắn vào 1 KÊNH cố định mỗi ngày vào 1 giờ cố
// định, giống hệt cơ chế Auto DM Schedule nhưng gửi vào channel thay vì DM
// riêng. Xem googleSheets/broadcastScheduleSheet.js + broadcast/scheduler.js.
const BROADCAST_SCHEDULE_SHEET_NAME = 'Broadcast Schedule';

// Sheet "Broadcast History" (cùng spreadsheet BOT_CHAT_HISTORY_SPREADSHEET_ID
// ở trên) — LƯU LẠI các tin "Gửi thông báo tuỳ ý" đã bấm "Gửi ngay" (khác
// Broadcast Schedule ở trên vốn chỉ lưu tin ĐANG chờ lên lịch lặp lại) —
// để trang web hiển thị lại, cho phép "Dùng lại" (nạp nội dung/kênh/role cũ
// vào form để sửa rồi gửi tiếp) hoặc xoá khỏi danh sách. Xem
// googleSheets/broadcastHistorySheet.js.
const BROADCAST_HISTORY_SHEET_NAME = 'Broadcast History';

// Sheet "Lich Bang Custom" (cùng spreadsheet BOT_CHAT_HISTORY_SPREADSHEET_ID) — sự kiện Lịch Bang
// do admin tự tạo trên web (thứ + giờ + lặp mỗi 1-4 tuần). Xem googleSheets/lichBangSheet.js.
const LICH_BANG_CUSTOM_SHEET_NAME = 'Lich Bang Custom';

// Lịch sử chat giữa bot và người dùng (googleSheets/chatHistorySheet.js) —
// lưu tối đa BOT_CHAT_HISTORY_MAX_ENTRIES tin nhắn gần nhất vào tab
// "BotChatHistory" trong Google Sheet riêng (set qua ENV nếu muốn đổi mà
// không cần sửa code), để AI (AutoReply/aiClient.js) có ngữ cảnh trả lời
// tiếp những gì đã trao đổi trước đó thay vì mất trí nhớ mỗi lượt chat.
const BOT_CHAT_HISTORY_SPREADSHEET_ID =
  process.env.BOT_CHAT_HISTORY_SPREADSHEET_ID || '1ITyzekoWrXlKsGOBYesoHgDnIUcePusKTeWreLbekvw';
const BOT_CHAT_HISTORY_SHEET_NAME = 'BotChatHistory';
const BOT_CHAT_HISTORY_MAX_ENTRIES = 100;

// Lịch sử chat kênh để AI tóm tắt (googleSheets/chatDigestSheet.js + AutoReply/chatDigest.js) — tab "ChatDigest"
// trong Google Sheet riêng (phải chia sẻ quyền Editor cho email service account của bot). Đổi bằng ENV
// CHAT_DIGEST_SPREADSHEET_ID nếu muốn dùng sheet khác mà không cần sửa code.
const CHAT_DIGEST_SPREADSHEET_ID =
  process.env.CHAT_DIGEST_SPREADSHEET_ID || '1_gJcQNrpW5gy7IVHzAz3Kdn2Gh9l9ULGqCaPBTXZy54';
const CHAT_DIGEST_SHEET_NAME = 'ChatDigest';

// --- Auto DM: bot tự động DM (tin nhắn riêng) cho từng người vào 1 giờ cố
// định MỖI NGÀY, nội dung lấy từ 1 trong các mẫu đã lưu sẵn. Dùng 2 tab,
// CÙNG spreadsheet BOT_CHAT_HISTORY_SPREADSHEET_ID ở trên (bot đã có sẵn
// quyền ghi vào đó, không cần thêm credentials gì mới):
//   - "Auto DM" (AUTO_DM_CONTENT_SHEET_NAME): A = Id, B = Nội dung — danh
//     sách các MẪU nội dung tin nhắn, thêm qua /autoDM (nm!autoDM).
//   - "Auto DM Schedule" (AUTO_DM_SCHEDULE_SHEET_NAME — tên tự đặt, sheet
//     ghi AI là người nhận tin): A = Id, B = UserID Discord, C = ID DM (so
//     với cột A của "Auto DM" để lấy đúng nội dung), D = Thời Gian Gửi
//     (giờ VN, dạng "HH:mm", vd "19:30") — set qua /setUserDM (nm!setUserDM).
//     Mỗi user chỉ có TỐI ĐA 1 dòng lịch — set lại nghĩa là GHI ĐÈ dòng cũ
//     của đúng user đó (xem googleSheets/autoDmSheet.js).
// Cơ chế gửi: autoDm/scheduler.js check mỗi phút (cùng kiểu với
// reminders/scheduler.js) — đúng phút khớp giờ VN ở cột D thì DM cho đúng
// UserID Discord ở cột B, nội dung lấy từ "Auto DM" theo Id ở cột C — lặp
// lại MỖI NGÀY, không có ngày kết thúc.
const AUTO_DM_CONTENT_SHEET_NAME = 'Auto DM';
const AUTO_DM_SCHEDULE_SHEET_NAME = 'Auto DM Schedule';

// --- Profile TOÀN BỘ (không giới hạn 1 server) cho Ingame/Class/Biệt Danh —
// đọc/ghi từ tab "ChatGlobal", nằm CÙNG spreadsheet với BotChatHistory ở
// trên (BOT_CHAT_HISTORY_SPREADSHEET_ID) — khác với tab "Bang" (chỉ dành
// cho thành viên server chính, đọc từ SRC_IMAGE_SPREADSHEET_ID). Dùng cho
// lệnh /setprofile (googleSheets/chatGlobalSheet.js): CHO PHÉP người dùng
// từ BẤT KỲ server nào bot có mặt tự set (hoặc set THAY người khác qua
// mention) Ingame/Class/Biệt Danh của họ — không giới hạn quyền. Danh sách
// này cũng được gộp vào memberDirectory cho AI auto-chat (AutoReply/index.js)
// để AI nhận diện được cả người NGOÀI server chính.
// Cấu trúc cột trong tab "ChatGlobal": A = Discord ID, B = Ingame,
// C = Class, D = Biệt Danh (khác thứ tự cột của tab "Bang" vì tab đó không
// có cột Biệt Danh và các cột đang xếp liền nhau, không bỏ cách như "Bang").
const CHAT_GLOBAL_SHEET_NAME = 'ChatGlobal';
const CHAT_GLOBAL_SHEET_COLUMNS = { discordId: 'A', ingame: 'B', className: 'C', nickname: 'D' };

// --- Cột mối quan hệ trong game, thêm vào CUỐI tab "ChatGlobal" (E/F/G) —
// dùng cho lệnh /setmqh và nm!setmqh (googleSheets/chatGlobalSheet.js):
//   E = Sư Phụ   -> chỉ chứa Discord ID của sư phụ (1 sư phụ tối đa
//                   RELATIONSHIP_MAX_DISCIPLES đệ tử, đếm bằng cách đếm số
//                   dòng có cột E = ID người đó).
//   F = Tri Kỷ -> Discord ID của "nửa kia", quan hệ 2 chiều 1-1 —
//                   set ID A vào dòng B thì bot TỰ set ngược lại ID B vào
//                   dòng A (và ngược lại khi đổi/xoá).
//   G = Kim Lan  -> chỉ là TÊN kim lan (text), trùng tên = chung 1 kim lan,
//                   tối đa RELATIONSHIP_MAX_KIM_LAN_MEMBERS người/kim lan.
const CHAT_GLOBAL_RELATIONSHIP_COLUMNS = { suPhu: 'E', triKy: 'F', kimLan: 'G' };
const RELATIONSHIP_MAX_DISCIPLES = 8;
const RELATIONSHIP_MAX_KIM_LAN_MEMBERS = 12;

// Timeout toàn cục cho mọi request Google Sheets/Drive (thay cho google.options của gói googleapis).
const GOOGLE_API_TIMEOUT_MS = 5 * 60 * 1000;

module.exports = {
  GOOGLE_API_TIMEOUT_MS,
  SPREADSHEET_ID,
  SHEET_NAME,
  DSB_SHEET_NAME,
  RESULT_SHEET_NAME,
  TOPVOTE_SHEET_NAME,
  BC_SHEET_NAME,
  AUTOVOTE_SHEET_NAME,
  STATE_SHEET_NAME,
  CHAT_CHANNEL_ALLOWS_SHEET_NAME,
  VOTE_HISTORY_SHEET_NAME,
  VOTE_HISTORY_DETAIL_SHEET_NAME,
  ACCESS_ID_SHEET_NAME,
  BROADCAST_SCHEDULE_SHEET_NAME,
  BROADCAST_HISTORY_SHEET_NAME,
  LICH_BANG_CUSTOM_SHEET_NAME,
  BOT_CHAT_HISTORY_SPREADSHEET_ID,
  BOT_CHAT_HISTORY_SHEET_NAME,
  BOT_CHAT_HISTORY_MAX_ENTRIES,
  CHAT_DIGEST_SPREADSHEET_ID,
  CHAT_DIGEST_SHEET_NAME,
  AUTO_DM_CONTENT_SHEET_NAME,
  AUTO_DM_SCHEDULE_SHEET_NAME,
  CHAT_GLOBAL_SHEET_NAME,
  CHAT_GLOBAL_SHEET_COLUMNS,
  CHAT_GLOBAL_RELATIONSHIP_COLUMNS,
  RELATIONSHIP_MAX_DISCIPLES,
  RELATIONSHIP_MAX_KIM_LAN_MEMBERS,
};
