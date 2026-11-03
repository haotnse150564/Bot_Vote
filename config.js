// Tất cả các hằng số cấu hình của bot — không chứa logic, chỉ chứa giá trị.
//
// File này CHỈ gộp lại các module trong thư mục config/ (tách theo nhóm chức năng).
// Muốn sửa 1 hằng số: tìm đúng nhóm trong bảng dưới rồi sửa ở file tương ứng.
//
//   - config/core.js              : Định danh server/role/user, emoji, kênh lẻ và hằng số dùng chung toàn bot
//   - config/sheets.js            : Google Sheet chính: tab vote/state/broadcast + spreadsheet lịch sử chat
//   - config/sourceSheets.js      : Google Sheet NGUỒN: chụp ảnh, DKScrim, /where, tab Bang
//   - config/schedule.js          : Kênh nhắc lịch, giờ các sự kiện định kỳ (Bang Chiến, GCMN, Thứ 5, Box)
//   - config/ai.js                : Khoá/endpoint Gemini (dùng cho đọc ảnh Vision của Thí Kiếm/Vinh Danh/BC Stat)
//   - config/hub.js               : Kênh Hub (menu tính năng) và bảo vệ kênh
//   - config/bcstat.js            : /bcstat — tổng hợp chỉ số Bang Chiến
//   - config/thiKiemVinhDanh.js   : Đua Rank Thí Kiếm Thiên Hạ + Sảnh Vinh Danh Bang Chiến
//   - config/voiceStats.js        : Thống kê voice Bang Chiến/Scrim + Lịch Bang
//   - config/welcome.js           : Thành viên mới vào server — tự gán role + gửi ảnh chào
//   - config/pickRole.js          : Pick Role bằng react (hệ phái + hoạt động)

module.exports = {
  ...require('./config/core'),
  ...require('./config/sheets'),
  ...require('./config/sourceSheets'),
  ...require('./config/schedule'),
  ...require('./config/ai'),
  ...require('./config/hub'),
  ...require('./config/bcstat'),
  ...require('./config/thiKiemVinhDanh'),
  ...require('./config/voiceStats'),
  ...require('./config/welcome'),
  ...require('./config/pickRole'),
};
