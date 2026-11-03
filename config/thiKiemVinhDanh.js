// ===== config/thiKiemVinhDanh.js — Đua Rank Thí Kiếm Thiên Hạ + Sảnh Vinh Danh Bang Chiến =====
// Tách khỏi config.js (file gốc giờ chỉ gộp lại các module trong thư mục config/).
// Chỉ chứa giá trị, không chứa logic.

const { SPREADSHEET_ID, BOT_CHAT_HISTORY_SPREADSHEET_ID } = require('./sheets');

// --- Đua Rank Thí Kiếm Thiên Hạ: nhận ảnh screenshot qua nút bấm trong kênh
// THIKIEM_BOARD_CHANNEL_ID, dùng Gemini Vision đọc điểm rank, ghi vào Google
// Sheet riêng (mặc định DÙNG CHUNG spreadsheet với SPREADSHEET_ID, có thể
// tách riêng qua ENV THIKIEM_SPREADSHEET_ID nếu muốn). Xem
// googleSheets/thiKiemSheet.js + thiKiem/index.js.
const THIKIEM_SPREADSHEET_ID = process.env.THIKIEM_SPREADSHEET_ID || SPREADSHEET_ID;
const THIKIEM_RANK_SHEET_NAME = 'Đua Rank Thí Kiếm';
const THIKIEM_CONFIG_SHEET_NAME = 'Config Mùa Giải';
// Kênh CHỈ có đúng 2 tin nhắn cố định do bot quản lý (bảng xếp hạng + nút
// bấm) — set ENV THIKIEM_BOARD_CHANNEL_ID nếu muốn đổi mà không cần sửa code.
// KÊNH BẢNG XẾP HẠNG RIÊNG (khôi phục): bot tự đăng "Sảnh Vinh Danh" + "Bảng Xếp
// Hạng Thí Kiếm" vào kênh này mỗi lần deploy (kênh được dọn sạch trước — xem
// utils/channelReset.js) và tự EDIT lại mỗi khi có người cập nhật điểm/Vinh Danh.
// Nút cập nhật điểm vẫn nằm ở menu Hub (KHÔNG đăng lại tin nút ở đây trừ khi bật
// THIKIEM_BOARD_SHOW_BUTTONS). Override qua ENV THIKIEM_BOARD_CHANNEL_ID (KHÔNG
// được trùng HUB_CHANNEL_ID).
const THIKIEM_BOARD_CHANNEL_ID = process.env.THIKIEM_BOARD_CHANNEL_ID || '1561269757351690382';
// Có đăng thêm tin "📤 Cập nhật điểm / 🔍 Xem Rank" dưới bảng không (mặc định KHÔNG).
const THIKIEM_BOARD_SHOW_BUTTONS = /^(1|true|on|yes)$/i.test(String(process.env.THIKIEM_BOARD_SHOW_BUTTONS || '').trim());
// Rate limit: mỗi người chỉ được CẬP NHẬT ĐIỂM THÀNH CÔNG 1 lần mỗi
// THIKIEM_RATE_LIMIT_HOURS tiếng (không tính lần gửi ảnh lỗi/không hợp lệ).
const THIKIEM_RATE_LIMIT_HOURS = Number(process.env.THIKIEM_RATE_LIMIT_HOURS) || 3;
const THIKIEM_RATE_LIMIT_MS = THIKIEM_RATE_LIMIT_HOURS * 60 * 60 * 1000;
// Tên ingame lấy trực tiếp từ tab "Bang" (SRC_IMAGE_SPREADSHEET_ID, xem
// googleSheets/memberSheet.js -> getMemberInfoByDiscordId()) — KHÔNG còn
// lệnh tự đăng ký riêng cho Thí Kiếm nữa. Nếu Discord ID chưa có (hoặc chưa
// có cột Ingame) trong tab "Bang", báo người dùng qua kênh này để được thêm/
// sửa thông tin — set ENV THIKIEM_INGAME_REGISTER_CHANNEL_ID nếu muốn đổi.
const THIKIEM_INGAME_REGISTER_CHANNEL_ID = process.env.THIKIEM_INGAME_REGISTER_CHANNEL_ID || '1520705676521771089';

// --- Sảnh Vinh Danh Bang Chiến: nhận ảnh khung "Danh hiệu vinh quang" (sau
// mỗi trận Bang Chiến), dùng Gemini Vision đọc 10 hạng mục + tên người đạt,
// ghi vào Google Sheet riêng (mặc định DÙNG CHUNG spreadsheet với
// BOT_CHAT_HISTORY_SPREADSHEET_ID (config/sheets.js) — set ENV VINHDANH_SPREADSHEET_ID
// nếu muốn tách riêng). Xem googleSheets/vinhDanhSheet.js + vinhDanh/index.js.
const VINHDANH_SPREADSHEET_ID = process.env.VINHDANH_SPREADSHEET_ID || BOT_CHAT_HISTORY_SPREADSHEET_ID;
const VINHDANH_SHEET_NAME = 'Vinh Danh Bang Chiến';
const VINHDANH_CONFIG_SHEET_NAME = 'Vinh Danh Config';
// Kênh đăng tin "Sảnh Vinh Danh" cố định — DÙNG CHUNG kênh với bảng xếp
// hạng Đua Rank Thí Kiếm (THIKIEM_BOARD_CHANNEL_ID), theo đúng yêu cầu
// "dùng chung kênh với rank Thí Kiếm". Có thể override qua ENV
// VINHDANH_CHANNEL_ID nếu sau này muốn tách riêng lại. Vì dùng chung kênh,
// ảnh cập nhật KHÔNG còn được nhận bằng cách gửi ảnh trực tiếp vào kênh nữa
// (sẽ đụng hàng với luồng "gửi ảnh = cập nhật điểm Thí Kiếm" của kênh đó) —
// giờ CHỈ nhận qua lệnh `/vinhdanh` (đính kèm ảnh vào option) hoặc
// `nm!vinhdanh` + đính kèm ảnh, xem vinhDanh/index.js.
// Mặc định kế thừa THIKIEM_BOARD_CHANNEL_ID (cùng kênh bảng xếp hạng). Việc CẬP NHẬT
// Vinh Danh vẫn mở từ menu Hub (CHỈ role NPC) — kênh này chỉ hiện bảng.
const VINHDANH_CHANNEL_ID = process.env.VINHDANH_CHANNEL_ID || THIKIEM_BOARD_CHANNEL_ID;

// --- Danh hiệu "Quần Long Chi Chủ" trong Sảnh Vinh Danh Bang Chiến là danh
// hiệu CAO NHẤT — người đang giữ danh hiệu này (theo lô Vinh Danh mới nhất)
// được bot TỰ ĐỘNG gắn role QUAN_LONG_CHI_CHU_ROLE_ID bên dưới. Mỗi khi có
// ảnh cập nhật mới (kể cả khi mùa Bang Chiến/tuần đó kết thúc và người giữ
// danh hiệu đổi sang người khác), bot tự THÁO role khỏi (các) người giữ cũ
// rồi GẮN lại cho (các) người giữ mới — xem vinhDanh/index.js.
// Tên danh hiệu PHẢI khớp (không phân biệt hoa/thường, đã trim khoảng
// trắng) với đúng text Gemini Vision đọc được từ ảnh trong khung "Danh hiệu
// vinh quang" — sửa lại đây nếu tên hiển thị trong game khác đi.
const QUAN_LONG_CHI_CHU_TITLE = 'Quần Long Chi Chủ';
const QUAN_LONG_CHI_CHU_ROLE_ID = '1549706281479315547';

module.exports = {
  THIKIEM_SPREADSHEET_ID,
  THIKIEM_RANK_SHEET_NAME,
  THIKIEM_CONFIG_SHEET_NAME,
  THIKIEM_BOARD_CHANNEL_ID,
  THIKIEM_BOARD_SHOW_BUTTONS,
  THIKIEM_RATE_LIMIT_HOURS,
  THIKIEM_RATE_LIMIT_MS,
  THIKIEM_INGAME_REGISTER_CHANNEL_ID,
  VINHDANH_SPREADSHEET_ID,
  VINHDANH_SHEET_NAME,
  VINHDANH_CONFIG_SHEET_NAME,
  VINHDANH_CHANNEL_ID,
  QUAN_LONG_CHI_CHU_TITLE,
  QUAN_LONG_CHI_CHU_ROLE_ID,
};
