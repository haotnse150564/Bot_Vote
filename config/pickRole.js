// ===== config/pickRole.js — Pick Role bằng react (prhd = hoạt động trong game, prhp = hệ phái) =====
// Bot đăng 2 tin riêng trong kênh PICK_ROLE_CHANNEL_ID: tin "Pick Hệ Phái Của Bạn" (prhp) và tin
// "Pick Role Hoạt Động Bạn Muốn" (prhd). Ai react đúng icon của role nào thì bot cấp role đó, bỏ react thì gỡ.
// Mỗi "bảng" = 1 tin, tạo thoải mái bằng /pickrole (bang-moi, them, xoa, bang-xoa, ds...), chỉ NPC/admin. Lối tắt cũ /addprhd /addprhp /removeprhd /removeprhp đã gỡ đăng ký (dùng /pickrole them|xoa).
// ENV (Render): PICK_ROLE_CHANNEL_ID = ID kênh dành cho bot đăng 2 tin (mặc định đã là kênh 1565525228766109786; đặt ENV để đổi).
// Danh sách lưu ở tab "Pick Role" (cùng spreadsheet BOT_CHAT_HISTORY_SPREADSHEET_ID).
const PICK_ROLE_CHANNEL_ID = process.env.PICK_ROLE_CHANNEL_ID || '1565525228766109786';
const PICK_ROLE_SHEET_NAME = 'Pick Role';
const PICK_ROLE_BOARD_SHEET_NAME = 'Pick Role Bảng'; // danh sách các tin/bảng (mỗi bảng = 1 tin trong kênh)
const PICK_ROLE_MAX_BOARDS = 10;
const PICK_ROLE_TITLE_MAX_LEN = 80;
// Discord chỉ cho tối đa 20 reaction khác nhau trên 1 tin -> mỗi loại tối đa 20 role.
const PICK_ROLE_MAX_PER_KIND = 20;
const PICK_ROLE_DESC_MAX_LEN = 150;

module.exports = { PICK_ROLE_CHANNEL_ID, PICK_ROLE_SHEET_NAME, PICK_ROLE_BOARD_SHEET_NAME, PICK_ROLE_MAX_BOARDS, PICK_ROLE_TITLE_MAX_LEN, PICK_ROLE_MAX_PER_KIND, PICK_ROLE_DESC_MAX_LEN };
