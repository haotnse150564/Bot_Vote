// ===== config/sourceSheets.js — Google Sheet NGUỒN: chụp ảnh, Nhật Ký Đội Hình, DKScrim, /where, tab Bang, Cập nhật phái =====
// Tách khỏi config.js (file gốc giờ chỉ gộp lại các module trong thư mục config/).
// Chỉ chứa giá trị, không chứa logic.

// --- Chụp ảnh (screenshot) 1 vùng từ Google Sheet NGUỒN, khác với SPREADSHEET_ID (config/sheets.js) ---
const SRC_IMAGE_SPREADSHEET_ID = '1o1yobj8zfKSyDi7f_XMjfzyDp0LDZzRdbGJwKiPNVK0';

// key nội bộ -> tên tab (PHẢI khớp chính xác tên tab trong Google Sheet) + vùng cần chụp
const SRC_IMAGE_TARGETS = {
  scrim1: { sheetTitle: 'Scrim 1', range: 'D1:O23' },
  scrim2: { sheetTitle: 'Scrim 2', range: 'D1:O23' },
  bc: { sheetTitle: 'Bang Chiến', range: 'D1:O25' },
};

// --- /wherebc /wherescrim1 /wherescrim2 — tra cứu Vị Trí/Phân Công/Ghi Chú
// của từng người theo Discord ID.
// ĐỔI (theo yêu cầu): TRƯỚC ĐÂY đọc từ tab "List BC/Scrim" nằm CHUNG
// SRC_IMAGE_SPREADSHEET_ID (sheet dùng để chụp ảnh ở trên) — GIỜ đọc thẳng
// từ tab "Nhật Ký Đội Hình" trong 1 Google Sheet RIÊNG
// (TEAM_LOG_SPREADSHEET_ID), do trang web NMTeam ghi trực tiếp mỗi lần NPC
// bấm "Đăng ảnh"/"Cập nhật ảnh" (xem routes/pushBot.js bên repo NMTeam) —
// dữ liệu luôn LÀ MỚI NHẤT ngay khi web ghi xong, không cần đồng bộ/làm mới
// gì thêm qua Apps Script như tab "List BC/Scrim" cũ nữa (nút "Làm Mới" ở
// /wherebc /wherescrim1 /wherescrim2 vì vậy cũng đã bỏ, xem where/ui.js).
// Cấu trúc cột trong tab "Nhật Ký Đội Hình" (PHẢI khớp ĐÚNG với
// lib/teamLogSheet.js bên repo NMTeam — đổi 1 bên thì phải đổi bên kia):
//   A = Discord ID, B = Ingame, C = Class
//   D/E/F = Vị Trí/Phân Công/Ghi Chú của Bang Chiến
//   G/H/I = Vị Trí/Phân Công/Ghi Chú của Scrim 1
//   J/K/L = Vị Trí/Phân Công/Ghi Chú của Scrim 2
// Có thể override bằng biến môi trường TEAM_LOG_SPREADSHEET_ID trên Railway
// (ĐÚNG TÊN biến với bên NMTeam, để set 1 lần dùng chung nếu deploy chung
// môi trường) — mặc định dùng đúng ID sheet "Nhật Ký Đội Hình" đã tạo theo
// yêu cầu này. QUAN TRỌNG: phải share sheet này cho đúng email Service
// Account của BOT (không nhất thiết trùng service account của web NMTeam)
// với quyền ít nhất Viewer (bot chỉ ĐỌC, không ghi gì vào sheet này).
const TEAM_LOG_SPREADSHEET_ID = process.env.TEAM_LOG_SPREADSHEET_ID || '17UgDJnp7XbCPb3okAUwkGWPWh-LQZoSztINp-Y7_1jI';
const TEAM_LOG_TAB_NAME = 'Nhật Ký Đội Hình';

// --- Đồng bộ danh sách "Đã Đăng Ký" Buổi 1/2 — mỗi khi tab "Kết Quả Vote"
// (SPREADSHEET_ID) được refresh, bot lọc ra những ai đã vote đúng ngày đang
// active của Buổi 1 (scrimData.session1Day) / Buổi 2 (scrimData.session2Day)
// rồi GHI ĐÈ (chỉ cột A:C — ID/Ingame/Class, không đụng cột D+ nếu tab có
// dùng thêm cột phân công/vị trí riêng) vào 2 tab dưới đây, nằm trong CÙNG
// Google Sheet nguồn với SRC_IMAGE_SPREADSHEET_ID ở trên.
// Xem googleSheets/dkScrimSheet.js.
const DK_SCRIM_BANG1_SHEET_NAME = 'DKScrimBang1';
const DK_SCRIM_BANG2_SHEET_NAME = 'DKScrimBang2';

const WHERE_LOCATION_LABELS = {
  bc: 'Bang Chiến',
  scrim1: 'Scrim 1',
  scrim2: 'Scrim 2',
};

const WHERE_LOCATION_COLUMNS = {
  bc: { viTri: 'D', phanCong: 'E', ghiChu: 'F' },
  scrim1: { viTri: 'G', phanCong: 'H', ghiChu: 'I' },
  scrim2: { viTri: 'J', phanCong: 'K', ghiChu: 'L' },
};

// Gọi HTTP tới Apps Script Web App (deploy từ file Code.gs đã gộp — doPost
// chạy CẢ 2 việc mỗi lần gọi: đồng bộ tab "List BC/Scrim" (cho nút "Làm
// Mới") VÀ tô lại màu nền/chữ theo bảng mã cột A (cho /post + /rpost trước
// khi chụp ảnh, tránh tô sai màu class). Trước đây tách 2 biến ENV riêng vì
// 2 project Apps Script khác nhau — giờ code .gs đã gộp làm 1 nên chỉ cần
// 1 URL duy nhất. Set biến ENV APPS_SCRIPT_WEBHOOK_URL trên Railway — không
// set thì nút "Làm Mới" báo lỗi, còn bước tô màu trước khi post thì bot tự
// bỏ qua (không chặn post) — xem hướng dẫn deploy trong file .gs.
const APPS_SCRIPT_WEBHOOK_URL = process.env.APPS_SCRIPT_WEBHOOK_URL || '';

// --- Tra cứu tên/class người chơi theo Discord ID cho auto-chat AI (bot ơi,
// reply-to-bot, mention, keyword...) — đọc từ tab "Bang" trong CÙNG Google
// Sheet nguồn (SRC_IMAGE_SPREADSHEET_ID). Cấu trúc cột trong tab "Bang":
//   A = Discord ID, C = Ingame, D = Class
const BANG_SHEET_NAME = 'Bang';
const BANG_SHEET_COLUMNS = { discordId: 'A', ingame: 'C', className: 'D', khongTrongBang: 'O' };

// --- Tra cứu Tên Discord/Ingame/Class theo Discord ID để TỰ ĐỘNG điền vào
// tab "Bang" mỗi khi /hi (hoặc nm!hi, POST /admin/hi) chào 1 người — xem
// commands/hiHelper.js. Đọc từ tab "Cập nhật phái" (CÙNG Google Sheet nguồn
// SRC_IMAGE_SPREADSHEET_ID) — đây là sheet nhận dữ liệu member TỰ cập nhật
// tên ingame/class (có cột "Cập nhật lúc" ghi thời điểm submit), nên có
// nhiều thành viên hơn tab "Bang" (kể cả người ngoài bang/chưa xếp team) và
// có sẵn cột "Tên người dùng" (username Discord) mà tab "Bang" không có.
// Cấu trúc cột trong tab "Cập nhật phái" (dòng 1 là HEADER, dữ liệu từ dòng 2):
//   A = Discord User ID, B = Tên người dùng (username Discord),
//   D = Tên nhân vật (Ingame), E = Hệ Phái (Class)
const UPDATE_PROFILE_SHEET_NAME = 'Cập nhật phái';
const UPDATE_PROFILE_SHEET_COLUMNS = { discordId: 'A', username: 'B', ingame: 'D', className: 'E' };

module.exports = {
  SRC_IMAGE_SPREADSHEET_ID,
  SRC_IMAGE_TARGETS,
  TEAM_LOG_SPREADSHEET_ID,
  TEAM_LOG_TAB_NAME,
  DK_SCRIM_BANG1_SHEET_NAME,
  DK_SCRIM_BANG2_SHEET_NAME,
  WHERE_LOCATION_LABELS,
  WHERE_LOCATION_COLUMNS,
  APPS_SCRIPT_WEBHOOK_URL,
  BANG_SHEET_NAME,
  BANG_SHEET_COLUMNS,
  UPDATE_PROFILE_SHEET_NAME,
  UPDATE_PROFILE_SHEET_COLUMNS,
};
