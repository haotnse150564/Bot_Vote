// ===== config/core.js — Định danh server/role/user, emoji, kênh lẻ và hằng số dùng chung toàn bot =====
// Tách khỏi config.js (file gốc giờ chỉ gộp lại các module trong thư mục config/).
// Chỉ chứa giá trị, không chứa logic.

const DAY_REACTIONS = {
  '4️⃣': 4,
  '5️⃣': 5,
  '6️⃣': 6,
  '0️⃣': 0,
};

// ID server Discord DUY NHẤT bot chạy. Hardcode sẵn giá trị thật (thấy từ
// log "Registered slash commands for guild ..." lúc deploy) làm mặc định —
// không cần set biến ENV gì thêm trên Railway. Vẫn có thể override qua ENV
// DISCORD_GUILD_ID nếu sau này đổi sang server khác.
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || '1450588370517360670';

// Auto-vote: react ✅ on the current nm!scrim message once to be auto-checked
// into Thứ 4 / Thứ 5 / Thứ 6 on every future nm!scrim, without reacting again.
// NOTE: bot needs "Manage Roles" permission and its own role placed ABOVE
// this role in the server's role hierarchy to be able to assign/remove it.
const AUTOVOTE_ROLE_ID = '1539139333205008534';
const AUTOVOTE_EMOJI = '✅';
const AUTOVOTE_REACTION_TAG = 'auto';

const NPC_ROLE_ID = '1472421811055493142';

// TEAM_VIEWER_ROLE_ID — role thứ 2 được phép MỞ trang Team (NMTeam), nhưng
// CHỈ XEM (không được thêm/sửa/xoá — CRUD vẫn dành riêng cho NPC_ROLE_ID).
// LƯU Ý: đây trùng đúng ID với SCRIM_PING_ROLE_ID khai báo bên dưới (role
// "member bang" ngoài đời) — tách thành hằng số riêng ở đây (thay vì tái sử
// dụng SCRIM_PING_ROLE_ID) để 2 mục đích (tag ping scrim vs phân quyền xem
// trang Team) không bị dính logic vào nhau, dù cùng 1 role Discord thật.
const TEAM_VIEWER_ROLE_ID = '1450590370194001941';

// Discord user ID của người quản lý bot (admin) — dùng chung cho các tính
// năng cần bot tự nhắn tin riêng (DM) báo cho admin, ví dụ nm!tlmn / /tlmn.
const ADMIN_USER_ID = '398099412070694912';

// Token dùng để xác thực các request /admin/* (trang quản lý bot NMTeam gọi
// vào) — đặt qua biến môi trường trên Railway, KHÔNG lưu giá trị thật trong
// code/Git. Không set biến này thì toàn bộ route /admin/* tự tắt (503).
const BOT_ADMIN_TOKEN = process.env.BOT_ADMIN_TOKEN || '';

// Phòng voice mà bot TREO CỐ ĐỊNH (events/voiceFollow.js) — bot tự vào khi khởi
// động và tự vào lại nếu bị đá/rớt kết nối. Có thể đổi qua ENV
// VOICE_HOME_CHANNEL_ID trên Railway mà không cần sửa code.
const VOICE_HOME_CHANNEL_ID = process.env.VOICE_HOME_CHANNEL_ID || '1525389720685908022';

// Giới hạn RAM (MB) dùng để tính % RAM đang dùng cho memoryWatcher.js.
// Railway KHÔNG có "instance type" cố định: RAM tính tiền theo mức dùng thực tế,
// trần mặc định theo gói (Hobby: 8 GB/replica) hoặc trần bạn tự đặt ở
// Settings → Resources → Memory Limit của service. Bot không tự đọc được số này —
// PHẢI set ENV MEMORY_LIMIT_MB cho khớp (vd 1024 nếu đặt trần 1 GB), nếu không
// cảnh báo % sẽ SAI. Mặc định 512 nếu không set.
const MEMORY_LIMIT_MB = parseInt(process.env.MEMORY_LIMIT_MB, 10) || 512;

// SCRIM_PING_ROLE_ID — role được tag khi có lịch scrim/nhắc lịch.
// Đang dùng role TEST (không làm phiền mọi người khi tag). Khi chạy thật,
// comment dòng test lại và bỏ comment dòng thực tế bên dưới.
const SCRIM_PING_ROLE_ID = process.env.SCRIM_PING_ROLE_ID || '1450590370194001941'; // role thực tế
// const SCRIM_PING_ROLE_ID = process.env.SCRIM_PING_ROLE_ID || '1528993894052659331'; // role test
const OFFLINE_EMOJI_NAME = 'offline';
const OFFLINE_EMOJI_ID = '1498552256226656297';
const OFFLINE_EMOJI_MENTION = `<:${OFFLINE_EMOJI_NAME}:${OFFLINE_EMOJI_ID}>`;
const OFFLINE_EMOJI_REACT = `${OFFLINE_EMOJI_NAME}:${OFFLINE_EMOJI_ID}`;
const UPDATE_INFO_CHANNEL_ID = '1520705676521771089';
const SCRIM_SIGNUP_CHANNEL_ID = '1508378901498302586';
// Kênh "Tham khảo Build, update điểm rank và các hoạt động bang" — dòng thứ 3
// trong tin chào /hi (commands/hiHelper.js). Override qua ENV BUILD_INFO_CHANNEL_ID.
const BUILD_INFO_CHANNEL_ID = process.env.BUILD_INFO_CHANNEL_ID || '1561270680899821691';
// Kênh đăng Gift Code — /code, nm!code và nút "Đăng code" trên web (POST
// /admin/scrim/code) đều gửi tin Gift Code vào ĐÚNG kênh này (không còn tuỳ
// theo kênh đang gõ lệnh hay dùng kênh đăng ký scrim). Đặt biến CODE_CHANNEL_ID
// trên Railway nếu muốn đổi kênh mà không cần sửa code.
const CODE_CHANNEL_ID = process.env.CODE_CHANNEL_ID || '1507777853813686393';
// Kênh "Trao Đổi Bang Chiến" — nơi nhận góp ý sau khi gửi ảnh đội hình.
// Set biến FEEDBACK_CHANNEL_ID trên Railway nếu muốn đổi kênh mà không cần sửa code.
const FEEDBACK_CHANNEL_ID = process.env.FEEDBACK_CHANNEL_ID || '1495792409416695868';
// Direct (hotlink-safe) gif URLs for nm!moe — picked at random each time
const MOE_GIF_URLS = [
  'https://media1.tenor.com/m/WgvfGvz013EAAAAC/anime.gif',
  'https://media1.tenor.com/m/y0Pa1lpLBXAAAAAd/love-cute.gif',
  'https://media1.tenor.com/m/jtiibdPsFx8AAAAd/moe-moe-kyun.gif',
  'https://media1.tenor.com/m/zqldlCY9TjUAAAAd/u149-deresute.gif',
  'https://media1.tenor.com/m/is3dNzRWE_gAAAAd/rabidredsalsa-denonbu.gif',
];

module.exports = {
  DAY_REACTIONS,
  DISCORD_GUILD_ID,
  AUTOVOTE_ROLE_ID,
  AUTOVOTE_EMOJI,
  AUTOVOTE_REACTION_TAG,
  NPC_ROLE_ID,
  TEAM_VIEWER_ROLE_ID,
  ADMIN_USER_ID,
  BOT_ADMIN_TOKEN,
  VOICE_HOME_CHANNEL_ID,
  MEMORY_LIMIT_MB,
  SCRIM_PING_ROLE_ID,
  OFFLINE_EMOJI_NAME,
  OFFLINE_EMOJI_ID,
  OFFLINE_EMOJI_MENTION,
  OFFLINE_EMOJI_REACT,
  UPDATE_INFO_CHANNEL_ID,
  SCRIM_SIGNUP_CHANNEL_ID,
  BUILD_INFO_CHANNEL_ID,
  CODE_CHANNEL_ID,
  FEEDBACK_CHANNEL_ID,
  MOE_GIF_URLS,
};
