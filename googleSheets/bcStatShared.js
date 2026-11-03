// ===== BcStat sheet: hằng số + helper dùng chung =====
// CATEGORIES (9 hạng mục), tên tab -> khoá hạng mục, header các tab và các helper
// nhỏ (Sheets client, colLetter, chuẩn hoá tên, Levenshtein) mà mọi module bcStat* cùng dùng.

const { google } = require('./googleClient');
const { getGoogleAuthClient } = require('./auth');

// 9 hạng mục (mục 3 trong spec), ĐÚNG THỨ TỰ cột trong RawLog/Cumulative.
// "Chết" trong công thức tính kỷ lục (xem computeAndWriteSummary) CHÍNH LÀ
// cột "Trọng thương" ở đây — không có cột "Chết" riêng.
// tabLabel dùng để hiển thị trong UI chọn tab (bcstat/format.js), không ảnh
// hưởng gì tới việc ghi sheet.
const CATEGORIES = [
  { key: 'giet', label: 'Giết', tab: 'Chiến Lược' },
  { key: 'hoTro', label: 'Hỗ trợ', tab: 'Chiến Lược' },
  { key: 'vatTu', label: 'Vật tư', tab: 'Chiến Lược' },
  { key: 'stNguoiChoi', label: 'St. người chơi', tab: 'Sát Thương' },
  { key: 'stTru', label: 'St. trụ', tab: 'Sát Thương' },
  { key: 'triLieu', label: 'Trị liệu', tab: 'Trị Liệu' },
  { key: 'chongChiu', label: 'Chống chịu', tab: 'Trị Liệu' },
  { key: 'trongThuong', label: 'Trọng thương', tab: 'Trọng Thương' },
  { key: 'hoiSinh', label: 'Hồi sinh', tab: 'Trọng Thương' },
];

// Tab -> danh sách category key ĐÚNG THỨ TỰ cột trong game (mục 3 spec) —
// dùng để biết cần đọc mấy cột + tên cột nào khi gọi Gemini Vision cho từng
// tab (xem bcstat/geminiVision.js).
const TAB_CATEGORY_KEYS = {};
CATEGORIES.forEach((cat) => {
  if (!TAB_CATEGORY_KEYS[cat.tab]) TAB_CATEGORY_KEYS[cat.tab] = [];
  TAB_CATEGORY_KEYS[cat.tab].push(cat.key);
});
const TAB_NAMES = Object.keys(TAB_CATEGORY_KEYS);

const RAWLOG_HEADER = ['Session/Trận', 'Tên người chơi (ingame)', ...CATEGORIES.map((c) => c.label)];

// Cumulative: 1 dòng/(người, trận) — nguồn "sự thật" duy nhất, KHÔNG còn
// Tổng/Số lần/trung bình (xem ghi chú đầu file). "Trận" là nhãn tự do "Tên
// đối thủ - dd/mm/yy" do NPC nhập khi bấm "Hoàn tất & Lưu" (bcstat/format.js
// ::buildMatchLabelModal) — lưu lại đúng nhãn đã có (hoặc dùng nút "✏️ Sửa
// trận đã lưu") sẽ GHI ĐÈ đúng dòng đó, không tạo trận mới.
const CUMULATIVE_HEADER = ['Tên người chơi', 'Trận (đối thủ - ngày)', ...CATEGORIES.map((c) => c.label)];

// Alias: 2 cột — Tên gõ sai/chưa khớp (chuẩn hoá làm khoá) | Tên chuẩn
// (đúng như trong tab "Bang"). Ghi thêm mỗi khi NPC bấm xác nhận gộp tên ở
// nút "🔗 Xem & xác nhận tên chưa khớp" (bcstat/format.js + index.js) —
// xem getAliasMap()/resolveAliases()/mergeUnmatchedAlias() bên dưới.
const ALIAS_HEADER = ['Tên gõ sai/chưa khớp', 'Tên chuẩn (đã xác nhận)'];

// Record: 1 dòng/người, 2 cột/hạng mục — "<Hạng mục> (Kỷ lục)" (giá trị) +
// "<Hạng mục> (Trận đạt)" (nhãn trận đạt được kỷ lục đó, chỉ để tham khảo).
// Xem ghi chú đầu file — đây là nguồn "sự thật" của Kỷ lục, tách riêng khỏi
// Cumulative để không mất khi Cumulative bị dọn theo chu kỳ về sau.
const RECORD_HEADER = [
  'Tên người chơi',
  ...CATEGORIES.flatMap((c) => [`${c.label} (Kỷ lục)`, `${c.label} (Trận đạt)`]),
];

// Mỗi hạng mục giờ chỉ có ĐÚNG 1 cột "Kỷ lục" (xem computeAndWriteSummary)
// thay cho 2 cột trung bình + 1 cột "Trận 1/2/3" trước đây.
const SUMMARY_HEADER = [
  'Tên người chơi',
  'Discord ID',
  'Class',
  ...CATEGORIES.map((c) => `${c.label} (Kỷ lục)`),
];

// Cycle: 1 dòng DUY NHẤT, 1 cột — số thứ tự chu kỳ SẮP TỚI (xem ghi chú đầu
// file + getBcStatCycleStatus/startNewBcStatCycle bên dưới).
const CYCLE_HEADER = ['Chu kỳ kế tiếp'];

async function getSheetsClient() {
  const auth = await getGoogleAuthClient();
  if (!auth) throw new Error('Chưa cấu hình Google Sheets credentials cho bot.');
  return google.sheets({ version: 'v4', auth });
}

function colLetter(index0) {
  // index0: 0-based cột trong sheet -> chữ cái cột ('A', 'B', ..., 'Z', 'AA', ...)
  let n = index0 + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Chuẩn hoá tên/nhãn trận để so khớp giữa các lần ghi nhận / với tab "Bang"
// — trim, gộp khoảng trắng thừa, lowercase. Vẫn hiển thị bản gốc
// (displayName/matchLabel) ở mọi nơi, chỉ dùng bản chuẩn hoá này để LÀM
// KHOÁ so khớp.
function normalizeName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// Levenshtein distance đơn giản, tự viết (không thêm thư viện ngoài) — dùng
// để GỢI Ý tên gần đúng khi không khớp 100% với tab "Bang" (mục 8 spec: đổi
// tên nhân vật/gõ sai). Chỉ để gợi ý cho người xác nhận thủ công, KHÔNG tự
// động ghép khi không khớp chính xác.
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

module.exports = {
  CATEGORIES,
  TAB_CATEGORY_KEYS,
  TAB_NAMES,
  RAWLOG_HEADER,
  CUMULATIVE_HEADER,
  ALIAS_HEADER,
  RECORD_HEADER,
  SUMMARY_HEADER,
  CYCLE_HEADER,
  getSheetsClient,
  colLetter,
  normalizeName,
  levenshtein,
};
