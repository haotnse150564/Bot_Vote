// ===== config/ai.js — AI auto-reply: Gemini/Serper, cụm từ gọi bot, cooldown, người tạo bot =====
// Tách khỏi config.js (file gốc giờ chỉ gộp lại các module trong thư mục config/).
// Chỉ chứa giá trị, không chứa logic.

// AI chat: gõ "bot ơi, <hành động>, <chủ đề>" (vd: "bot ơi, làm thơ, thơ
// tình") thì bot nhờ Gemini xử lý thay vì chỉ trả lời theo keyword có sẵn.
// Dùng "bot ơi," (thay vì chỉ "bot,") để tránh bị trigger nhầm khi ai đó vô
// tình gõ "bot" + dấu phẩy trong 1 câu bình thường.
// Set GEMINI_API_KEY trên Railway (lấy tại https://aistudio.google.com/apikey)
// — nếu không set, bot sẽ báo chưa cấu hình thay vì im lặng khó hiểu.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const SERPER_API_KEY = process.env.SERPER_API_KEY || '';

const GEMINI_MODELS = (process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.5-flash,gemini-3.8-flash,gemini-3.6-flash,gemini-3-flash-preview')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

// GEMINI_SEARCH_MODELS không cần nữa — search giờ dùng Serper, không dùng
// Gemini's built-in google_search tool nữa (bị chặn quota trên free tier).

// Các cách gọi bot để CHAT thường (không search) — không phân biệt hoa/
// thường, phải có dấu phẩy ngay sau cụm từ. Vd: "bot ơi, làm thơ, thơ
// tình", "ê bot, kể chuyện cười", "kìa bot, hôm nay đánh scrim với ai vậy".
// Thêm/bớt cách gọi thì sửa mảng này — logic build regex nằm ở
// AutoReply/index.js, không cần đụng vào.
const AI_CHAT_TRIGGER_PHRASES = ['bot ơi', 'ê bot ơi', 'ê bot', 'kìa bot'];

// Các cách gọi bot để SEARCH (qua Serper) trước khi trả lời — dùng khi cần
// thông tin thời sự/mới nhất. Vd: "bot ơi tìm, tin tức hôm nay",
// "tìm giúp tôi, giá vàng hôm nay".
const AI_SEARCH_TRIGGER_PHRASES = ['bot ơi tìm', 'tìm giúp tôi', 'tôi cần tìm, '];

// Cooldown (ms) giữa 2 lần bot AUTO-REPLY cùng 1 từ khóa (KEYWORD_RESPONSES)
// HOẶC cùng 1 user bị mention (MENTION_RESPONSES) TRONG CÙNG 1 KÊNH — tránh
// bị spam trả lời dồn dập khi nhiều người liên tục gõ trúng cùng từ khóa,
// hoặc 1 người cố tình lặp lại nhiều lần để chọc bot. Trong lúc cooldown,
// bot im lặng bỏ qua (không reply), không báo lỗi gì. Set biến ENV
// AUTOREPLY_KEYWORD_COOLDOWN_MS trên Railway để đổi mà không cần sửa code,
// mặc định 30 phút (tăng từ 10 phút lên, áp dụng cho MỌI từ khóa TRỪ nhóm
// "gọi bot" — xem AUTOREPLY_GOI_BOT_COOLDOWN_MS ngay bên dưới).
const AUTOREPLY_KEYWORD_COOLDOWN_MS = Number(process.env.AUTOREPLY_KEYWORD_COOLDOWN_MS) || 30 * 60 * 1000;

// Cooldown (ms) RIÊNG cho nhóm từ khóa "gọi bot" trống không (con bot / bot
// đâu / bot ơi / bot à — xem GOI_BOT_KEYWORDS ở AutoReply/keywords.js) —
// KHÔNG bị tăng lên 30 phút như AUTOREPLY_KEYWORD_COOLDOWN_MS ở trên, vẫn
// giữ mặc định 10 phút như cũ vì đây là cách gọi bot thông thường/thường
// xuyên nhất. Set biến ENV AUTOREPLY_GOI_BOT_COOLDOWN_MS trên Railway nếu
// muốn đổi mà không cần sửa code.
const AUTOREPLY_GOI_BOT_COOLDOWN_MS = Number(process.env.AUTOREPLY_GOI_BOT_COOLDOWN_MS) || 10 * 60 * 1000;

// Cooldown (ms) giữa 2 lần bot AUTO-REPLY khi bị TAG TRỰC TIẾP (@TênBot)
// TRONG CÙNG 1 KÊNH — tách riêng với AUTOREPLY_KEYWORD_COOLDOWN_MS vì đây là
// tín hiệu "đang nói chuyện trực tiếp với bot", hợp lý để cooldown ngắn hơn
// từ khóa thường. Set biến ENV BOT_MENTION_COOLDOWN_MS trên Railway để đổi,
// mặc định 3 phút.
const BOT_MENTION_COOLDOWN_MS = Number(process.env.BOT_MENTION_COOLDOWN_MS) || 5 * 60 * 1000;

// Discord User ID của "Sếp" — người đã tạo/dạy bot (AutoReply/index.js ->
// getMemberInfoAnySource() so khớp discordId với biến này để gắn cờ
// isCreator: true, aiClient.js dựa vào cờ đó để AI đối xử đặc biệt kính
// trọng/thân thiết hơn khi chat cùng người này). Set biến ENV
// BOT_CREATOR_DISCORD_ID trên Railway nếu muốn đổi mà không cần sửa code.
const BOT_CREATOR_DISCORD_ID = process.env.BOT_CREATOR_DISCORD_ID || '398099412070694912';

// Danh sách Discord User ID của "đệ tử" Sếp trong game — bot chỉ cần BIẾT
// đây là đệ tử của Sếp (để lỡ cần dùng sau này), KHÔNG tự ý đổi thái độ/
// cách nhắn tin nhiều với nhóm này ở thời điểm hiện tại. Danh sách sẽ được
// Sếp bổ sung thêm dần, nên tách riêng thành mảng dễ thêm bớt.
const BOT_CREATOR_DISCIPLE_DISCORD_IDS = [
  '1048839485351268362',
  '929415845917118554',
  '1436283119119372315',
  '1309453657905037312',
  '777064247359569941',
];

// --- Nâng cấp "chất liệu" cho AI chat (xem AutoReply/channelContext.js, timeContext.js, temperaturePolicy.js) ---

// Nhiệt độ sinh câu cho CHAT THƯỜNG (tám chuyện, trêu, chào...) — cao hơn mặc định để câu bớt an toàn/nhạt.
// Set ENV GEMINI_CHAT_TEMPERATURE trên Railway để chỉnh mà không cần sửa code (khoảng 0.9–1.0 là hợp lý).
const CHAT_TEMPERATURE = Number.isFinite(Number(process.env.GEMINI_CHAT_TEMPERATURE)) && process.env.GEMINI_CHAT_TEMPERATURE
  ? Number(process.env.GEMINI_CHAT_TEMPERATURE)
  : 0.95;

// Nhiệt độ cho câu trả lời cần BÁM DỮ LIỆU (hỏi kiến thức game / có kèm kết quả search) — thấp để khỏi bịa.
const GROUNDED_TEMPERATURE = Number.isFinite(Number(process.env.GEMINI_GROUNDED_TEMPERATURE)) && process.env.GEMINI_GROUNDED_TEMPERATURE
  ? Number(process.env.GEMINI_GROUNDED_TEMPERATURE)
  : 0.4;

// "Đọc không khí kênh": đưa các tin nhắn gần nhất của MỌI NGƯỜI trong kênh (không chỉ lượt hỏi–đáp với bot) vào prompt.
// Tắt bằng ENV CHANNEL_CONTEXT_ENABLED=false. Tin cũ hơn CHANNEL_CONTEXT_MAX_AGE_MIN phút thì bỏ qua (chuyện đã nguội).
const CHANNEL_CONTEXT_ENABLED = String(process.env.CHANNEL_CONTEXT_ENABLED || 'true').toLowerCase() !== 'false';
const CHANNEL_CONTEXT_FETCH_LIMIT = 30; // số tin lấy từ Discord (trước khi lọc bot/tin rỗng/tin cũ)
const CHANNEL_CONTEXT_MAX_LINES = 15; // tối đa số dòng đưa vào prompt
const CHANNEL_CONTEXT_MAX_AGE_MIN = Number(process.env.CHANNEL_CONTEXT_MAX_AGE_MIN) || 60;
const CHANNEL_CONTEXT_MAX_CHARS_PER_MSG = 200;

module.exports = {
  GEMINI_API_KEY,
  SERPER_API_KEY,
  GEMINI_MODELS,
  AI_CHAT_TRIGGER_PHRASES,
  AI_SEARCH_TRIGGER_PHRASES,
  AUTOREPLY_KEYWORD_COOLDOWN_MS,
  AUTOREPLY_GOI_BOT_COOLDOWN_MS,
  BOT_MENTION_COOLDOWN_MS,
  BOT_CREATOR_DISCORD_ID,
  BOT_CREATOR_DISCIPLE_DISCORD_IDS,
  CHAT_TEMPERATURE,
  GROUNDED_TEMPERATURE,
  CHANNEL_CONTEXT_ENABLED,
  CHANNEL_CONTEXT_FETCH_LIMIT,
  CHANNEL_CONTEXT_MAX_LINES,
  CHANNEL_CONTEXT_MAX_AGE_MIN,
  CHANNEL_CONTEXT_MAX_CHARS_PER_MSG,
};
