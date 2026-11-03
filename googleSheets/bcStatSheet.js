// Đọc/ghi 3 tab cho tool tổng hợp chỉ số Bang Chiến (`/bcstat`):
//   - BCSTAT_RAWLOG_SHEET_NAME: LOG THÔ, mỗi dòng = 1 lần ghi nhận (session)
//     của 1 người — Session/Trận | Tên người chơi (ingame) | 9 cột hạng mục.
//     Vì mỗi phiên có thể chỉ nhập vài tab (không bắt buộc đủ 4 tab), các
//     cột không thu thập được ở phiên đó để trống. Chỉ dùng để tra cứu/đối
//     chiếu thủ công — KHÔNG còn là nguồn tính toán Summary (xem Cumulative
//     bên dưới), nên có thể tự do xoá bớt dòng cũ sau này để đỡ phình sheet
//     mà KHÔNG ảnh hưởng tới số liệu.
//   - BCSTAT_CUMULATIVE_SHEET_NAME: nguồn "sự thật" thật sự — 1 dòng/(người,
//     trận), mỗi trận xác định bởi nhãn "Tên đối thủ - dd/mm/yy" (Bang Chiến
//     luôn diễn ra Thứ 7). KHÔNG còn giới hạn 3 trận/chu kỳ như trước — mỗi
//     trận là 1 dòng riêng, ghi đè (upsert) nếu lưu lại đúng trận đã có (=
//     SỬA số liệu trận đó, xem updateCumulative). Được cập nhật NGAY mỗi khi
//     có phiên mới (xem appendSessionRows -> updateCumulative), không phải
//     tính lại từ đầu — nên hoàn toàn độc lập với việc RawLog còn giữ được
//     bao nhiêu dòng.
//   - BCSTAT_RECORD_SHEET_NAME: nguồn "sự thật" của Kỷ lục — TÁCH RIÊNG khỏi
//     Cumulative (yêu cầu "Lưu Kỷ Lục Riêng 1 Chỗ"), 1 dòng/người, 2 cột/hạng
//     mục (giá trị Kỷ lục + tên trận đạt được). Cập nhật NGAY (cộng dồn, giữ
//     giá trị cao nhất) mỗi khi có phiên /bcstat mới (xem appendSessionRows
//     -> updateRecords), KHÔNG tính lại bằng cách quét toàn bộ Cumulative —
//     nên Kỷ lục sẽ SỐNG SÓT kể cả sau này Cumulative bị xoá/dọn theo chu kỳ
//     (tính năng "Bắt Đầu Chu Kỳ Mới"). Nếu tab này chưa tồn tại (lần đầu
//     nâng cấp), được khởi tạo 1 LẦN bằng cách quét Cumulative hiện có (xem
//     seedRecordsFromCumulative) để không mất Kỷ lục cũ đã tính trước đó.
//   - BCSTAT_SUMMARY_SHEET_NAME: bảng tổng hợp hiển thị — đọc trực tiếp từ
//     Record (không đọc Cumulative/RawLog nữa), ghép thêm Discord ID + Class
//     từ tab "Bang" (SRC_IMAGE_SPREADSHEET_ID, xem memberSheet.js ->
//     getAllBangMembers). KHÔNG còn tính trung bình — mỗi hạng mục chỉ có 1
//     cột "Kỷ lục" lấy thẳng từ Record. Ghi đè lại toàn bộ (clear + rewrite)
//     mỗi lần được tính lại — bảng này luôn là "ảnh chụp mới nhất", không
//     phải log.
//
// ===== Điều phối chung =====
// Module này giờ chỉ còn re-export API công khai; logic thật đã tách theo
// đúng ranh giới chức năng (mọi nơi khác vẫn require('.../bcStatSheet') như cũ):
//   - bcStatShared.js     : hằng số (CATEGORIES, header các tab) + helper dùng chung
//                           (getSheetsClient, colLetter, normalizeName, levenshtein)
//   - bcStatMatchLabel.js : nhãn trận "Đối thủ - dd/mm/yy" (build/split/validate)
//   - bcStatCumulative.js : tab Cumulative (updateCumulative, getRecentMatchLabels)
//   - bcStatRecords.js    : tab Record - Kỷ lục (đọc/ghi/upsert/seed/merge alias)
//   - bcStatSummary.js    : tab Summary (computeAndWriteSummary, getSummaryRows)
//   - bcStatAlias.js      : tab Alias + gộp tên chưa khớp (mergeUnmatchedAlias)
//   - bcStatSetup.js      : tạo tab + header (ensureBcStatSheetsExist)
//   - bcStatSession.js    : ghi 1 phiên vào RawLog (appendSessionRows)
//   - bcStatCycle.js      : chu kỳ (trạng thái, dữ liệu chu kỳ hiện tại, bắt đầu chu kỳ mới)

const { CATEGORIES, TAB_CATEGORY_KEYS, TAB_NAMES, normalizeName } = require('./bcStatShared');
const { ensureBcStatSheetsExist } = require('./bcStatSetup');
const { appendSessionRows } = require('./bcStatSession');
const { updateCumulative, getRecentMatchLabels } = require('./bcStatCumulative');
const { updateRecords } = require('./bcStatRecords');
const { getBcStatCycleStatus, getCurrentCycleData, startNewBcStatCycle } = require('./bcStatCycle');
const { computeAndWriteSummary, getSummaryRows } = require('./bcStatSummary');
const { getAliasMap, resolveAliases, mergeUnmatchedAlias } = require('./bcStatAlias');
const { buildMatchLabel, splitMatchLabel, validateMatchInput } = require('./bcStatMatchLabel');

module.exports = {
  CATEGORIES,
  TAB_CATEGORY_KEYS,
  TAB_NAMES,
  ensureBcStatSheetsExist,
  appendSessionRows,
  updateCumulative,
  updateRecords,
  getBcStatCycleStatus,
  startNewBcStatCycle,
  computeAndWriteSummary,
  getSummaryRows,
  getCurrentCycleData,
  normalizeName,
  getAliasMap,
  resolveAliases,
  mergeUnmatchedAlias,
  buildMatchLabel,
  splitMatchLabel,
  validateMatchInput,
  getRecentMatchLabels,
};
