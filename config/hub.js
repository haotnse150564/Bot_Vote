// ===== config/hub.js — Kênh Hub (menu tính năng), bảo vệ kênh, Thư Viện Hệ Phái, Hòm Thư Góp Ý =====
// Tách khỏi config.js (file gốc giờ chỉ gộp lại các module trong thư mục config/).
// Chỉ chứa giá trị, không chứa logic.

// ===== KÊNH HUB (MENU CHỌN TÍNH NĂNG) =====
// Kênh DUY NHẤT có tin menu cố định (5 nút) để thành viên bấm chọn tính
// năng: Check Gear / Đua Rank Thí Kiếm / Vinh Danh Bang Chiến (chỉ NPC) /
// Hòm Thư Góp Ý. Chọn xong bot trả lời RIÊNG TƯ (ephemeral) ngay tại đây
// kèm các nút của tính năng đó — không còn kênh riêng cho từng tính năng.
// Xem hub/index.js + hub/format.js. Override qua ENV HUB_CHANNEL_ID.
const HUB_CHANNEL_ID = process.env.HUB_CHANNEL_ID || '1561270680899821691';

// --- BẢO VỆ KÊNH HUB (xem hub/messageGuard.js) ---
// Kênh Hub CHỈ nhận tin nhắn của người đang có 1 phiên "chờ gửi ảnh" (đã bấm nút
// tính năng cần gửi ảnh, vd Check Gear / /bcstat). Mọi tin khác bị bot xoá.
//   HUB_GUARD_ENABLED       : 'false'/'off'/'0' để tắt HẲN (cả xoá ngay lẫn dọn định kỳ).
//   HUB_AUTO_CLEAR_MINUTES  : cứ mỗi N phút quét kênh 1 lần, xoá tin sót (mặc định 10,
//                             đặt 0 để tắt riêng phần dọn định kỳ).
//   HUB_SWEEP_MIN_AGE_SECONDS: tin phải "già" hơn ngần này giây mới bị dọn định kỳ
//                             (chừa thời gian cho tin đang xử lý dở / thông báo tạm).
const HUB_GUARD_ENABLED = !/^(0|false|off|no)$/i.test(String(process.env.HUB_GUARD_ENABLED || 'true').trim());
const HUB_AUTO_CLEAR_MINUTES = (() => {
  const raw = process.env.HUB_AUTO_CLEAR_MINUTES;
  if (raw === undefined || String(raw).trim() === '') return 10;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : 10;
})();
const HUB_SWEEP_MIN_AGE_MS = (Number(process.env.HUB_SWEEP_MIN_AGE_SECONDS) || 60) * 1000;
// Thư Viện Hệ Phái — nút của menu Hub trả lời riêng tư kèm 1 nút LINK dẫn tới kênh
// Forum thư viện. Giờ chỉ còn 1 kênh Forum DUY NHẤT (LIBRARY_CHANNEL_ID), mỗi
// Hệ Phái / chủ đề là 1 HASHTAG (tag) của Forum chứ không còn là kênh riêng nữa.
const LIBRARY_CHANNEL_ID = process.env.LIBRARY_CHANNEL_ID || '1561111711862362223';
// Danh sách hashtag (tag Forum) -> tên tab Google Sheet, dùng để bot theo dõi bài
// thảo luận (xem theVien/index.js). className PHẢI trùng đúng tên tab trên sheet
// LIBRARY_SPREADSHEET_ID. tagId = ID của tag trong Forum (bài đăng gắn tag nào thì
// ghi vào tab đó; bài gắn nhiều tag lấy tag đầu tiên khớp theo thứ tự khai báo ở
// đây, class trước - tag phụ sau). tagId để '' = không khớp ID nào, dùng làm tab
// MẶC ĐỊNH cho bài không gắn tag nào đã khai báo (xem LIBRARY_FALLBACK_CLASS_NAME).
const LIBRARY_CLASS_TAGS = [
  { className: 'Cửu Linh', tagId: '1561272829339635712' },
  { className: 'Tố Vấn', tagId: '1561272887560634499' },
  { className: 'Thần Tương', tagId: '1561272945219731556' },
  { className: 'Toái Mộng', tagId: '1561272992854712420' },
  { className: 'Long Ngâm', tagId: '1561273046277431307' },
  { className: 'Huyết Hà', tagId: '1561273081916563547' },
  { className: 'Thiết Y', tagId: '1561273176011309086' },
  { className: 'Huyền Cơ', tagId: '1561288473732980857' },
  // Tag phụ
  { className: 'PoV', tagId: '1561273385659666442' },
  { className: 'Thí Kiếm', tagId: '1561273530711015546' },
  { className: 'Bang Chiến', tagId: '1561273639234568212' },
  { className: 'Khác', tagId: '' },
];
// Tab nhận bài không gắn tag nào khớp LIBRARY_CLASS_TAGS (kể cả tag "Khác").
const LIBRARY_FALLBACK_CLASS_NAME = 'Khác';
// Các kênh thư viện CŨ (mỗi Class 1 kênh) — chỉ còn dùng để route đọc nội dung bài
// (POST /admin/library/post-content) vẫn mở được các bài đã ghi trong sheet từ trước.
const LIBRARY_LEGACY_CHANNEL_IDS = [
  '1550440191980871780',
  '1550477133149900880',
  '1550476962894712922',
  '1550439844419993640',
  '1550477032259985498',
  '1550440352597413908',
  '1550476583851008142',
  '1550476062750937178',
  '1490215257665437766',
];

// Nút "Cập Nhật Thông Tin" ở menu Hub — nút LINK (không tốn lượt tương tác),
// bấm là nhảy thẳng tới kênh này. Override qua ENV UPDATE_INFO_CHANNEL_ID.
const UPDATE_INFO_CHANNEL_ID = process.env.UPDATE_INFO_CHANNEL_ID || '1520705676521771089';

// Nút LINK "Truy Cập Trang Web Của Bang: Nhất Mộng" ở menu Hub (hàng nút thứ 2) + dòng link trong embed.
// Đổi địa chỉ qua ENV GUILD_WEBSITE_URL (không cần sửa code). Để rỗng = ẩn nút và dòng link.
const GUILD_WEBSITE_URL = (process.env.GUILD_WEBSITE_URL || 'https://nhatmongnth.vercel.app/').trim();

// Sheet riêng lưu lịch sử bài thảo luận Thư Viện Hệ Phái (mỗi Class 1 tab,
// tên tab = className ở LIBRARY_CLASS_TAGS phía trên) — xem
// googleSheets/libraryPostSheet.js + theVien/index.js.
const LIBRARY_SPREADSHEET_ID = process.env.LIBRARY_SPREADSHEET_ID || '1ALaP1Mx2t_pdT4NXP5TdyYxkSVoAZaHV8GqbPPPhhig';

// --- Hòm Thư Góp Ý: kênh Discord riêng (do NPC tự tạo) để thành viên gửi
// góp ý — chọn ẩn danh hoặc không. Bot tự đăng 1 tin "form" (embed + nút
// bấm) vào ĐÚNG kênh này lúc khởi động — bấm nút mở popup nhập nội dung,
// không cần gõ lệnh hay gõ tay vào kênh (xem feedbackBox/index.js). Danh
// sách góp ý được lưu vào tab "Hòm Thư Góp Ý" (cùng spreadsheet
// BOT_CHAT_HISTORY_SPREADSHEET_ID) và hiển thị trên trang quản lý bot
// (NMTeam) qua GET /admin/feedback/list.
// PHẢI set FEEDBACK_BOX_CHANNEL_ID trên Railway (không có kênh mặc định nào
// hợp lý để hardcode sẵn) — chưa set thì tính năng này tự tắt hẳn (bot
// không đăng form vào đâu cả).
// (ĐÃ GỘP VÀO HUB_CHANNEL_ID: form góp ý giờ mở từ menu Hub, không còn đăng form
// riêng vào kênh này nữa — biến này chỉ còn để tương thích ngược.)
const FEEDBACK_BOX_CHANNEL_ID = process.env.FEEDBACK_BOX_CHANNEL_ID || '';
const FEEDBACK_BOX_SHEET_NAME = 'Hòm Thư Góp Ý';
// Chống spam: tối đa FEEDBACK_SPAM_LIMIT_COUNT góp ý / FEEDBACK_SPAM_LIMIT_WINDOW_MS
// mỗi người (tính theo Discord ID, kể cả khi gửi ẩn danh — ẩn danh chỉ ẩn
// TÊN hiển thị trên trang quản lý, bot vẫn cần biết ai gửi để chặn spam).
const FEEDBACK_SPAM_LIMIT_COUNT = 3;
const FEEDBACK_SPAM_LIMIT_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 tiếng
// Tự động xoá góp ý cũ hơn mốc này (cả trên sheet lẫn bộ nhớ) — dọn dẹp
// định kỳ, xem feedbackBox/index.js -> cleanupExpiredFeedback().
const FEEDBACK_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 2 tuần
const FEEDBACK_CONTENT_MAX_LEN = 1000;
// Độ dài tối đa cho "Biệt danh" (nút "🎭 Gửi biệt danh" — tự đặt tên hiển thị
// thay vì hiện Ingame thật HOẶC chữ "Ẩn danh" trần trụi; vẫn ẩn danh tính
// thật/Discord ID như gửi ẩn danh bình thường, xem feedbackBox/index.js).
const FEEDBACK_NICKNAME_MAX_LEN = 30;

// Các kênh CŨ từng có tin nút riêng (Đua Rank Thí Kiếm + Vinh Danh, Check Gear) — sau
// khi gộp về kênh Hub, mỗi lần khởi động bot xoá các tin CỦA CHÍNH BOT còn sót
// trong những kênh này (tin của người dùng KHÔNG bị đụng) để không còn nút cũ
// gây nhầm lẫn. Đổi/tắt qua ENV LEGACY_BUTTON_CHANNEL_IDS (danh sách ID cách nhau
// bởi dấu phẩy; đặt "none" để tắt hẳn).
const LEGACY_BUTTON_CHANNEL_IDS = (process.env.LEGACY_BUTTON_CHANNEL_IDS || '1550487757812531281')
  .split(',')
  .map((id) => id.trim())
  .filter((id) => /^\d{15,25}$/.test(id));

module.exports = {
  HUB_CHANNEL_ID,
  HUB_GUARD_ENABLED,
  HUB_AUTO_CLEAR_MINUTES,
  HUB_SWEEP_MIN_AGE_MS,
  LIBRARY_CHANNEL_ID,
  LIBRARY_CLASS_TAGS,
  LIBRARY_FALLBACK_CLASS_NAME,
  LIBRARY_LEGACY_CHANNEL_IDS,
  LIBRARY_SPREADSHEET_ID,
  UPDATE_INFO_CHANNEL_ID,
  GUILD_WEBSITE_URL,
  FEEDBACK_BOX_CHANNEL_ID,
  FEEDBACK_BOX_SHEET_NAME,
  FEEDBACK_SPAM_LIMIT_COUNT,
  FEEDBACK_SPAM_LIMIT_WINDOW_MS,
  FEEDBACK_MAX_AGE_MS,
  FEEDBACK_CONTENT_MAX_LEN,
  FEEDBACK_NICKNAME_MAX_LEN,
  LEGACY_BUTTON_CHANNEL_IDS,
};
