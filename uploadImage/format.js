// Format tin nhắn "Đội hình" gửi kèm ảnh chụp Scrim 1 / Scrim 2 / Bang Chiến.
const { scrimData } = require('../state');
const { BC_EVENT_HOUR, BC_EVENT_MINUTE, FEEDBACK_CHANNEL_ID } = require('../config');
const { getVnNow } = require('../utils/time');

const SRC_IMAGE_LABELS = {
  scrim1: 'Scrim 1',
  scrim2: 'Scrim 2',
  bc: 'Bang Chiến',
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Thứ trong tuần theo tiếng Việt (0 = Chủ Nhật, theo Date.getDay()).
const WEEKDAY_NAMES_VI = [
  'Chủ Nhật',
  'Thứ Hai',
  'Thứ Ba',
  'Thứ Tư',
  'Thứ Năm',
  'Thứ Sáu',
  'Thứ Bảy',
];

// Trả về { weekday: "Thứ Tư", dateStr: "26/08" } theo ngày hiện tại (giờ
// VIỆT NAM, quy đổi qua getVnNow() — KHÔNG dùng giờ server chạy bot, vốn là
// UTC trên Railway nên gần nửa đêm VN sẽ bị lệch cả Thứ lẫn Ngày do UTC vẫn
// còn ở ngày hôm trước) — dùng để chèn động vào tiêu đề "Đội hình của Scrim ...".
function getVietnameseWeekdayAndDate(date = getVnNow()) {
  const weekday = WEEKDAY_NAMES_VI[date.getDay()];
  const dateStr = `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}`;
  return { weekday, dateStr };
}

// "chỉ cần lấy giờ" — scrimData.session1Time/session2Time vốn đã chỉ chứa
// giờ (vd "19:00"), riêng Bang Chiến giờ cố định lấy từ config.js.
function getSrcImageStartTime(key) {
  if (key === 'scrim1') return scrimData.session1Time ? scrimData.session1Time.trim() : 'Đang cập nhật';
  if (key === 'scrim2') return scrimData.session2Time ? scrimData.session2Time.trim() : 'Đang cập nhật';
  if (key === 'bc') return `${pad2(BC_EVENT_HOUR)}:${pad2(BC_EVENT_MINUTE)}`;
  return 'Đang cập nhật';
}

function formatSrcImageMessage(key) {
  // Scrim 1 / Scrim 2: thay số cố định bằng Thứ + Ngày tháng hiện tại
  // (vd "Scrim Thứ Tư, Ngày 26/08"). Bang Chiến giữ nguyên tên như cũ.
  let label;
  if (key === 'scrim1' || key === 'scrim2') {
    const { weekday, dateStr } = getVietnameseWeekdayAndDate();
    label = `Scrim ${weekday}, Ngày ${dateStr}`;
  } else {
    label = SRC_IMAGE_LABELS[key] || key;
  }

  const startTime = getSrcImageStartTime(key);

  return `# Đội hình của ${label} :\n## Bắt đầu lúc: ${startTime}\n## Mọi người onl trước 30 phút để ổn định đội hình và tạo phòng\n### Mọi ý kiến đóng góp xin vui lòng gửi vào: <#${FEEDBACK_CHANNEL_ID}>`;
}

module.exports = { SRC_IMAGE_LABELS, formatSrcImageMessage };