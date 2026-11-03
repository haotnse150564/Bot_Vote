// ===== config/voiceStats.js — Thống kê voice Bang Chiến/Scrim + Lịch Bang =====
// Chỉ chứa giá trị, không chứa logic.

// Danh mục (category) chứa các kênh voice dùng khi Bang Chiến / Scrim — bot
// đếm mọi người đang ngồi trong các voice channel thuộc danh mục này.
// Override qua ENV VOICE_STATS_CATEGORY_ID.
const VOICE_STATS_CATEGORY_ID = process.env.VOICE_STATS_CATEGORY_ID || '1549831928772038698';

// Tab ghi lịch sử mỗi lượt ngồi voice, nằm trong Google Sheet chính (SPREADSHEET_ID).
const VOICE_STATS_SHEET_NAME = 'Voice Bang';

// Lượt ngồi dưới ngưỡng này (giây) bị bỏ qua (vào nhầm rồi thoát ngay).
const VOICE_STATS_MIN_SECONDS = 60;

// Cửa sổ giờ để gắn nhãn lượt ngồi là "Bang Chiến" / "Scrim" (phút so với giờ
// bắt đầu sự kiện). Lượt ngồi chồng lấn cửa sổ nào nhiều nhất thì mang nhãn đó,
// không chồng lấn cửa sổ nào thì là "Khác".
const VOICE_WINDOW_BEFORE_MINUTES = 30;
const VOICE_WINDOW_BC_AFTER_MINUTES = 180;
const VOICE_WINDOW_SCRIM_AFTER_MINUTES = 150;

module.exports = {
  VOICE_STATS_CATEGORY_ID,
  VOICE_STATS_SHEET_NAME,
  VOICE_STATS_MIN_SECONDS,
  VOICE_WINDOW_BEFORE_MINUTES,
  VOICE_WINDOW_BC_AFTER_MINUTES,
  VOICE_WINDOW_SCRIM_AFTER_MINUTES,
};
