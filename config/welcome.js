// ===== config/welcome.js — Tự gán role + gửi ảnh chào khi có người MỚI vào server =====
// Chỉ chứa giá trị, không chứa logic. Xem welcome/index.js.

// Chỉ chạy trong server này (bot chỉ ở 1 server, nhưng khoá cứng cho chắc).
const WELCOME_GUILD_ID = process.env.WELCOME_GUILD_ID || '1450588370517360670';

// Role tự gán cho mọi thành viên (không phải bot) vừa vào server.
// Bot cần quyền "Manage Roles" và role của bot phải nằm TRÊN role này trong danh sách role của server.
const WELCOME_ROLE_ID = process.env.WELCOME_ROLE_ID || '1472401099506847999';

// Kênh gửi ảnh chào. Để trống thì lần lượt dùng: kênh "Tin nhắn hệ thống" của server (Cài đặt server -> Tổng quan),
// rồi FEEDBACK_CHANNEL_ID (kênh /hi chào thành viên). Đặt ENV WELCOME_CHANNEL_ID trên Railway để chỉ định kênh khác.
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID || '';

// Bật/tắt nhanh: ENV WELCOME_ENABLED=false để tắt cả gán role lẫn gửi chào.
const WELCOME_ENABLED = String(process.env.WELCOME_ENABLED || 'true').toLowerCase() !== 'false';

// Thời gian chờ tải avatar (ms) — quá hạn thì vẽ ảnh chào với vòng tròn trống.
const WELCOME_AVATAR_TIMEOUT_MS = 8000;

// Tên trong ảnh chào phải GIỐNG tên hiện ở lời tag (biệt danh trong server). Lúc vừa vào, biệt danh thường chưa có
// (bot/tính năng khác đặt sau vài giây) nên bot chờ rồi tải lại thành viên trước khi vẽ: tối đa CHECKS lần, mỗi lần chờ WAIT_MS.
// Đã có biệt danh thì vẽ ngay, người không đặt biệt danh sẽ chờ tổng cộng tối đa CHECKS x WAIT_MS.
const WELCOME_NAME_WAIT_MS = Number(process.env.WELCOME_NAME_WAIT_MS) || 3000;
const WELCOME_NAME_MAX_CHECKS = Number(process.env.WELCOME_NAME_MAX_CHECKS) || 3;

module.exports = {
  WELCOME_NAME_WAIT_MS,
  WELCOME_NAME_MAX_CHECKS,
  WELCOME_GUILD_ID,
  WELCOME_ROLE_ID,
  WELCOME_CHANNEL_ID,
  WELCOME_ENABLED,
  WELCOME_AVATAR_TIMEOUT_MS,
};
