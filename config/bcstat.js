// ===== config/bcstat.js — /bcstat — tổng hợp chỉ số Bang Chiến (các tab Google Sheet + timeout chờ ảnh) =====
// Tách khỏi config.js (file gốc giờ chỉ gộp lại các module trong thư mục config/).
// Chỉ chứa giá trị, không chứa logic.

const { BOT_CHAT_HISTORY_SPREADSHEET_ID } = require('./sheets');

// --- `/bcstat`: tổng hợp chỉ số Bang Chiến (Chiến Lược/Sát Thương/Trị
// Liệu/Trọng Thương) từ ảnh chụp bảng xếp hạng trong game, ghi nhận nhiều
// lần theo thời gian rồi tính trung bình — xem googleSheets/bcStatSheet.js +
// bcstat/index.js. Class/Ingame tra cứu trực tiếp từ tab "Bang"
// (SRC_IMAGE_SPREADSHEET_ID, xem googleSheets/memberSheet.js ->
// getAllBangMembers) — CHÍNH LÀ sheet "Bang Nhất Mộng" nêu trong spec, bot
// đã có sẵn quyền đọc từ tính năng Đua Rank Thí Kiếm nên không cần cấu hình
// gì thêm. Theo yêu cầu người dùng: RawLog + Summary là 2 TAB HOÀN TOÀN MỚI
// (không tái sử dụng tab có sẵn nào), mặc định nằm chung spreadsheet với
// BOT_CHAT_HISTORY_SPREADSHEET_ID (đúng sheet "Nhat Mong Bot Auto" trong
// spec) — set ENV BCSTAT_SPREADSHEET_ID nếu muốn tách riêng.
const BCSTAT_SPREADSHEET_ID = process.env.BCSTAT_SPREADSHEET_ID || BOT_CHAT_HISTORY_SPREADSHEET_ID;
const BCSTAT_RAWLOG_SHEET_NAME = 'BC Stat - RawLog';
const BCSTAT_SUMMARY_SHEET_NAME = 'BC Stat - Summary';
// Tab MỚI lưu 1 dòng/(người, trận) — trận xác định bởi nhãn tự do "Tên đối
// thủ - dd/mm/yy" NPC nhập khi bấm "Hoàn tất & Lưu" (không còn giới hạn
// 3 trận/chu kỳ) — cập nhật NGAY mỗi khi có phiên /bcstat mới (xem
// googleSheets/bcStatSheet.js::updateCumulative). Nhờ tách riêng khỏi
// RawLog, "Kỷ lục" (giá trị cao nhất từng đạt được, trừ Trọng thương của
// đúng trận đó) KHÔNG bị mất/sai nếu sau này RawLog bị dọn bớt (xoá dòng cũ)
// để đỡ phình sheet — Cumulative không cần đọc lại RawLog để tính, nên xoá
// RawLog cũ không ảnh hưởng gì tới số liệu.
const BCSTAT_CUMULATIVE_SHEET_NAME = 'BC Stat - Cumulative';
// Tab MỚI (2 cột: Tên gõ sai/chưa khớp | Tên chuẩn trong tab "Bang") lưu lại
// các lần NPC XÁC NHẬN 1 tên không khớp thật ra là ai (qua nút "🔗 Xem & xác
// nhận tên chưa khớp" ở /bcstat) — từ lần lưu SAU trở đi, tên gõ sai này tự
// động được hiểu là tên chuẩn tương ứng (xem
// googleSheets/bcStatSheet.js::resolveAliases/mergeUnmatchedAlias), không
// cần xác nhận lại lần 2 nếu NPC lại gõ/đọc nhầm y hệt như vậy.
const BCSTAT_ALIAS_SHEET_NAME = 'BC Stat - Alias';
// Tab MỚI (yêu cầu "Lưu Kỷ Lục Riêng 1 Chỗ") — lưu Kỷ lục CAO NHẤT từng đạt
// được của MỖI người/hạng mục (kèm tên trận đạt được) TÁCH RIÊNG khỏi
// Cumulative, cập nhật NGAY mỗi khi có phiên /bcstat mới (xem
// googleSheets/bcStatSheet.js::updateRecords) thay vì tính lại bằng cách
// quét Cumulative mỗi lần. Nhờ vậy Kỷ lục sẽ KHÔNG bị mất nếu sau này
// Cumulative bị dọn/xoá theo chu kỳ (tính năng "Bắt Đầu Chu Kỳ Mới").
const BCSTAT_RECORD_SHEET_NAME = 'BC Stat - Kỷ Lục';
// Tab MỚI (yêu cầu "Bắt Đầu Chu Kỳ Mới") — chỉ lưu ĐÚNG 1 số: "chu kỳ kế
// tiếp" sẽ được gán cho lần xuất Excel + dọn dữ liệu SẮP TỚI. Không cần lưu
// gì thêm vì "3 trận của chu kỳ hiện tại" = TOÀN BỘ trận đang có trong
// Cumulative tại thời điểm bấm nút (xem googleSheets/bcStatSheet.js::
// getBcStatCycleStatus/startNewBcStatCycle) — mỗi lần xuất xong sẽ xoá
// sạch Cumulative (+ RawLog của đúng các trận đó), nên phần còn lại trong
// Cumulative luôn LÀ chu kỳ đang tích luỹ dở, không cần theo dõi ngày bắt
// đầu/kết thúc chu kỳ riêng.
const BCSTAT_CYCLE_SHEET_NAME = 'BC Stat - Chu Kỳ';
// Sau bao lâu KHÔNG có ảnh mới gửi thì tự đóng phiên "đang chờ ảnh" của 1
// tab (dữ liệu các tab đã gửi trước đó trong phiên KHÔNG mất — chỉ mất nếu
// bấm "Huỷ phiên"/bot restart) — set ENV BCSTAT_AWAIT_IMAGE_TIMEOUT_MS nếu
// muốn đổi (đơn vị mili-giây).
const BCSTAT_AWAIT_IMAGE_TIMEOUT_MS = Number(process.env.BCSTAT_AWAIT_IMAGE_TIMEOUT_MS) || 5 * 60 * 1000;

module.exports = {
  BCSTAT_SPREADSHEET_ID,
  BCSTAT_RAWLOG_SHEET_NAME,
  BCSTAT_SUMMARY_SHEET_NAME,
  BCSTAT_CUMULATIVE_SHEET_NAME,
  BCSTAT_ALIAS_SHEET_NAME,
  BCSTAT_RECORD_SHEET_NAME,
  BCSTAT_CYCLE_SHEET_NAME,
  BCSTAT_AWAIT_IMAGE_TIMEOUT_MS,
};
