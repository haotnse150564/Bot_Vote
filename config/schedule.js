// ===== config/schedule.js — Kênh nhắc lịch, giờ các sự kiện định kỳ (Bang Chiến, GCMN, Thứ 5, Box) và auto chat tình hình vote =====
// Tách khỏi config.js (file gốc giờ chỉ gộp lại các module trong thư mục config/).
// Chỉ chứa giá trị, không chứa logic.

// Reminder settings — chia 3 kênh: Bang chiến / Scrim / Thông báo bang (chung).
// Đang test nên cả 3 đều tạm fallback về 1 kênh test (REMINDER_CHANNEL_ID).
// Khi deploy thật, chỉ cần set riêng 3 biến ENV bên dưới trên Railway — không cần sửa code:
//   BC_REMINDER_CHANNEL_ID, SCRIM_REMINDER_CHANNEL_ID, GUILD_REMINDER_CHANNEL_ID
const REMINDER_CHANNEL_ID = process.env.REMINDER_CHANNEL_ID || '1536936493321551923'; // kênh test tạm

const BC_REMINDER_CHANNEL_ID = process.env.BC_REMINDER_CHANNEL_ID || REMINDER_CHANNEL_ID; // Bang chiến
const SCRIM_REMINDER_CHANNEL_ID = process.env.SCRIM_REMINDER_CHANNEL_ID || REMINDER_CHANNEL_ID; // Scrim (Buổi 1 & 2)
// Thông báo bang chung — gộp Giải cứu mỹ nhân, Thứ 5 May Mắn, Box 0 Ngọc
const GUILD_REMINDER_CHANNEL_ID = process.env.GUILD_REMINDER_CHANNEL_ID || REMINDER_CHANNEL_ID;

// Bang chiến: every Saturday 20:00 (UTC+7), reminder 30 minutes before -> 19:30
const BC_EVENT_DAY = 6; // Saturday (0 = Sunday ... 6 = Saturday)
const BC_EVENT_HOUR = 20;
const BC_EVENT_MINUTE = 0;
const BC_REMINDER_MINUTES_BEFORE = 30;

// Điểm danh Bang Chiến TỰ ĐỘNG (bc/post.js): mỗi Thứ 4 lúc 10:00 sáng (giờ VN) bot tự
// gửi tin điểm danh giống lệnh nm!bc (reset sheet Offline + ping role + react Offline).
// Kênh mặc định = kênh nhắc Bang chiến; đổi bằng ENV BC_CHECKIN_CHANNEL_ID, tắt bằng BC_CHECKIN_AUTO=off.
const BC_CHECKIN_AUTO = String(process.env.BC_CHECKIN_AUTO || 'on').toLowerCase() !== 'off';
const BC_CHECKIN_CHANNEL_ID = process.env.BC_CHECKIN_CHANNEL_ID || BC_REMINDER_CHANNEL_ID;
const BC_CHECKIN_DAY = 3; // Thứ 4 (getDay(): 0 = CN ... 3 = Thứ 4)
const BC_CHECKIN_HOUR = 10;
const BC_CHECKIN_MINUTE = 0;

// Giải cứu mỹ nhân: every other Tuesday 20:30 (UTC+7), reminder 15 minutes before -> 20:15
// Reference date: 18/08/2026 is a confirmed opening Tuesday
const GCMN_EVENT_DAY = 2; // Tuesday
const GCMN_EVENT_HOUR = 20;
const GCMN_EVENT_MINUTE = 30;
const GCMN_REMINDER_MINUTES_BEFORE = 15;
const GCMN_REFERENCE_DATE_UTC = Date.UTC(2026, 7, 18); // month is 0-indexed: 7 = August

// Scrim (Buổi 1 / Buổi 2): giờ đánh lấy từ scrimData (session1/2 Day + Time),
// được NPC cập nhật qua nm!us1 / nm!us2 mỗi tuần — không cố định.
const SCRIM_REMINDER_MINUTES_BEFORE = 30;

// Thứ 5 = 4, Thứ 7 = 6 (getDay(): 0=CN, 1=T2 ... 6=T7)
const THU5_EVENT_DAY = 4;
const THU5_EVENT_HOUR = 8;
const THU5_EVENT_MINUTE = 0;

const BOX_SALE_EVENT_DAY = 6;
const BOX_SALE_EVENT_HOUR = 8;
const BOX_SALE_EVENT_MINUTE = 0;

// Auto chat "Cập nhật tình hình vote" — cứ mỗi VOTE_STATUS_INTERVAL_MS lại tự
// gửi 1 tin nhắn tổng hợp số vote Thứ 4/5/6 + Không Đánh + số người chưa vote
// (đọc từ googleSheets/resultSheet.js -> getVoteSummary(), format ở
// voteStatus/format.js -> formatVoteStatusMessage()). KHÔNG mention ai cả.
// Gửi vào kênh SCRIM_REMINDER_CHANNEL_ID theo mặc định (cùng kênh nhắc lịch
// scrim) — set biến ENV VOTE_STATUS_CHANNEL_ID trên Railway nếu muốn đổi kênh
// mà không cần sửa code.
const VOTE_STATUS_CHANNEL_ID = process.env.VOTE_STATUS_CHANNEL_ID || '1472424393215840374';
const VOTE_STATUS_INTERVAL_HOURS = Number(process.env.VOTE_STATUS_INTERVAL_HOURS) || 3;
const VOTE_STATUS_INTERVAL_MS = VOTE_STATUS_INTERVAL_HOURS * 60 * 60 * 1000;

// Chỉ tự chat trong khung giờ 8h sáng -> 11h tối (giờ VN, [start, end)) và
// chỉ trong khoảng Thứ 2 -> Thứ 4 mỗi tuần — ngoài khung giờ/ngày này thì
// checkVoteStatusAutoChat() bỏ qua hoàn toàn (xem AutoReply/index.js).
// getDay(): 0 = Chủ Nhật, 1 = Thứ 2, 2 = Thứ 3, 3 = Thứ 4, ...
const VOTE_STATUS_ACTIVE_HOUR_START = 8;
const VOTE_STATUS_ACTIVE_HOUR_END = 23;
const VOTE_STATUS_ACTIVE_DAYS = [1, 2, 3]; // Thứ 2, Thứ 3, Thứ 4

module.exports = {
  REMINDER_CHANNEL_ID,
  BC_REMINDER_CHANNEL_ID,
  SCRIM_REMINDER_CHANNEL_ID,
  GUILD_REMINDER_CHANNEL_ID,
  BC_CHECKIN_AUTO,
  BC_CHECKIN_CHANNEL_ID,
  BC_CHECKIN_DAY,
  BC_CHECKIN_HOUR,
  BC_CHECKIN_MINUTE,
  BC_EVENT_DAY,
  BC_EVENT_HOUR,
  BC_EVENT_MINUTE,
  BC_REMINDER_MINUTES_BEFORE,
  GCMN_EVENT_DAY,
  GCMN_EVENT_HOUR,
  GCMN_EVENT_MINUTE,
  GCMN_REMINDER_MINUTES_BEFORE,
  GCMN_REFERENCE_DATE_UTC,
  SCRIM_REMINDER_MINUTES_BEFORE,
  THU5_EVENT_DAY,
  THU5_EVENT_HOUR,
  THU5_EVENT_MINUTE,
  BOX_SALE_EVENT_DAY,
  BOX_SALE_EVENT_HOUR,
  BOX_SALE_EVENT_MINUTE,
  VOTE_STATUS_CHANNEL_ID,
  VOTE_STATUS_INTERVAL_HOURS,
  VOTE_STATUS_INTERVAL_MS,
  VOTE_STATUS_ACTIVE_HOUR_START,
  VOTE_STATUS_ACTIVE_HOUR_END,
  VOTE_STATUS_ACTIVE_DAYS,
};
