const { SlashCommandBuilder } = require('discord.js');
const { buildMergedSlashCommands } = require('./slashMerged'); // /upload /usi /post /rpost /where (gộp 15 lệnh cũ)

// Chỉ dùng cho 1 server Discord duy nhất -> KHÔNG cần phân biệt "server
// gốc" với "server khác" nữa, help luôn hiện TOÀN BỘ danh sách lệnh. Cờ
// `global` trên từng dòng bên dưới không còn tác dụng lọc gì cả (giữ lại
// data cho gọn, không phải xóa từng dòng), chỉ còn ý nghĩa ghi chú.
const HELP_ENTRIES = [
  { text: '`nm!scrim` hoặc `/scrim` — Tạo tin nhắn thông báo scrim tuần này (NPC). `/scrim` nhận sẵn các option `b1_ngay/b1_gio/b1_ngaythang/b1_doithu/b1_sotran` và `b2_...` tương tự cho Buổi 2 — điền luôn lúc tạo, không bắt buộc phải gọi thêm `/us1 /us2` (vẫn dùng `/us1 /us2` sau đó nếu muốn sửa)' },
  { text: '`nm!rsvote` hoặc `/rsvote` — Reset dữ liệu vote scrim trên Google Sheet (NPC)' },
  { text: '`✅ trên tin scrim` — Đăng ký Auto Vote: tự động tích Thứ 4,5,6 mọi tuần sau, không cần react lại (bỏ react để huỷ)' },
  { text: '`us1 [ngày] ; [giờ,ngày/tháng] ; [đối thủ] ; [số trận]` — Cập nhật/sửa lại Buổi 1 (NPC)' },
  { text: '`us2 [ngày] ; [giờ,ngày/tháng] ; [đối thủ] ; [số trận]` — Cập nhật/sửa lại Buổi 2 (NPC)' },
  { text: '`code [mã code]` — Thông báo Gift Code mới, ping role, đăng vào kênh code (NPC)' },
  { text: '`reset` — Reset thông tin lịch scrim (NPC)' },
  { text: '`bc` — Gửi tin điểm danh Bang Chiến (NPC)' },
  { text: '`checkvote` — Đồng bộ lại vote từ react thực tế trên Discord (NPC)' },
  { text: '`nm!topvote` hoặc `/topvote` — Xem Bảng Xếp Hạng Chuyên Cần Vote (Top 10), cộng dồn theo từng tuần', global: true },
  { text: '`testbc` — Gửi thử tin nhắc Bang Chiến (NPC)' },
  { text: '`testgcmn` — Gửi thử tin nhắc Giải Cứu Mỹ Nhân (NPC)' },
  { text: '`testscrim1` / `testscrim2` — Gửi thử tin nhắc Scrim Buổi 1/2 (NPC)' },
  { text: '`nm!uploadscrim1` / `nm!uploadscrim2` / `nm!uploadBC` hoặc `/upload loai:<scrim1|scrim2|bc>` — Tải ẢNH MỚI vùng Scrim 1 (E1:O25) / Scrim 2 (E1:O30) / Bảng Chiến (E1:O25) từ Google Sheet nguồn (NPC)' },
  { text: '`nm!usi1` / `nm!usi2` / `nm!ubci` hoặc `/usi loai:<scrim1|scrim2|bc>` — Gửi tin nhắn ảnh mới cho Scrim 1 / Scrim 2 / Bảng Chiến (NPC)' },
  { text: '`nm!rpostscrim1` / `nm!rpostscrim2` / `nm!rpostbc` hoặc `/rpost loai:<scrim1|scrim2|bc>` — Cập nhật lại tin đã đăng bằng post (ảnh + nội dung mới nhất) (NPC)' },
  { text: '`nm!wherebc` / `nm!wherescrim1` / `nm!wherescrim2` hoặc `/where loai:<scrim1|scrim2|bc>` — Tạo nút xem Vị Trí/Phân Công/Ghi Chú Bang Chiến / Scrim 1 / Scrim 2 (chỉ người bấm thấy) (NPC)' },
  { text: 'Đua Rank Thí Kiếm — gửi ảnh chụp màn hình Thí Kiếm Thiên Hạ để cập nhật điểm (tối đa 1 lần/3 tiếng), bấm nút "⚔️ Đua Rank Thí Kiếm" ở menu trong kênh Hub rồi bấm "📤 Cập nhật điểm" để mở popup chọn file. Tên ingame lấy theo tab "Bang" — nếu chưa có, vào kênh đăng ký thông tin thành viên để được thêm trước', global: true },
  { text: '`/set-mua-giai [ten] [ngay-bat-dau] [ngay-ket-thuc]` — [NPC] Cập nhật cấu hình Mùa Giải Đua Rank Thí Kiếm', global: true },
  { text: '`/xoa-diem-thi-kiem discord-id:<id>` — [NPC] Xoá dữ liệu điểm Thí Kiếm của 1 Discord ID', global: true },
  { text: '`/xem-bang-xep-hang-thi-kiem` — Đăng lại bảng xếp hạng Đua Rank Thí Kiếm mới nhất', global: true },
  { text: '`/bcstat` — Mở nút tổng hợp chỉ số Bang Chiến: chọn tab (Chiến Lược/Sát Thương/Trị Liệu/Trọng Thương) rồi gửi ảnh bảng xếp hạng, bấm "Hoàn tất & Lưu" để ghi vào Google Sheet (RawLog + Summary tính trung bình theo Class từ tab Bang) (NPC)' },
  { text: '`/rank [user]` hoặc `nm!rank [@user|discord-id]` — Xem rank card Thí Kiếm Thiên Hạ (số trận, hạ gục, kỷ lục, trung bình...) của bạn hoặc người khác, dùng được ở mọi kênh; cũng có nút "🔍 Xem Rank" cạnh nút cập nhật điểm để xem nhanh rank của chính mình. Hiện công khai ở kênh chat được phép, riêng tư (ephemeral/DM) ở kênh khác', global: true },
  { text: '`/vinhdanh anh-1:<ảnh> [anh-2:<ảnh>]` hoặc `nm!vinhdanh` + đính kèm 1-2 ảnh — [NPC] Cập nhật Sảnh Vinh Danh Bang Chiến (khung "Danh hiệu vinh quang" sau mỗi trận), hoặc bấm nút "🏆 Vinh Danh Bang Chiến" ở menu trong kênh Hub (chỉ role NPC dùng được). Người đang giữ danh hiệu "Quần Long Chi Chủ" được bot tự động gắn role tương ứng, tháo lại khi đổi người', global: true },
  { text: '`/xem-vinh-danh` — [NPC] Xem Sảnh Vinh Danh Bang Chiến mới nhất', global: true },
  { text: '`/voice` — Xem ai đang ngồi voice Bang Chiến/Scrim và đếm số người', global: true },
  { text: '`/voicestats [khoang] [loai]` — Thống kê thời gian ngồi voice Bang Chiến/Scrim (7 ngày / 30 ngày / tất cả; lọc Bang Chiến hoặc Scrim)', global: true },
  { text: '`/lich` — Xem lịch Bang sắp tới (Bang Chiến, Scrim, GCMN, Thứ 5, Box)', global: true },
  { text: '`/pickrole bang-moi | them | xoa | doi-tieu-de | bang-xoa | ds` — [NPC] Quản lý các bảng Pick Role: bot đăng bảng trong kênh Pick Role, ai react đúng icon thì được cấp role đó, bỏ react thì gỡ role', global: true },
  { text: '**Role tự động**: thành viên mới vào server được gán role + chào bằng ảnh; ai được gắn role member bang được bot chào; react ✅ trên tin scrim = đăng ký Auto Vote (role auto-vote)', global: true },
  { text: '`ping` — Kiểm tra bot còn sống không', global: true },
  { text: '`help` — Xem danh sách lệnh của bot', global: true },
];

// Discord giới hạn 2000 ký tự/tin nhắn — help text gộp lại vượt xa mức đó,
// nên PHẢI chia thành nhiều đoạn (mỗi đoạn <= maxLen) rồi gửi nối tiếp
// nhau, thay vì gửi nguyên 1 chuỗi dài sẽ bị Discord từ chối thẳng
// ("Must be 2000 or fewer in length").
function chunkLines(lines, maxLen = 1900) {
  const chunks = [];
  let current = '';

  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > maxLen) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);

  return chunks;
}

// Chỉ 1 server duy nhất -> luôn trả về TOÀN BỘ HELP_ENTRIES, tham số
// guildId giữ lại trong chữ ký hàm để chỗ gọi cũ (messageCommands.js,
// getHelpText bên dưới) không cần sửa gì thêm, dù giờ không dùng tới nữa.
function getHelpLinesForGuild() {
  return HELP_ENTRIES.map((entry) => entry.text);
}

function getHelpTextChunksForGuild(guildId) {
  const lines = ['**Danh sách lệnh của bot** (dùng `nm!...` hoặc `/...`):', ...getHelpLinesForGuild(guildId)];
  return chunkLines(lines);
}

// Giữ lại cho code cũ còn gọi getHelpText() không kèm guildId — LƯU Ý:
// chuỗi trả về có thể dài hơn 2000 ký tự, KHÔNG được gửi thẳng vào 1 tin
// nhắn Discord. Nơi gọi cần dùng getHelpTextChunksForGuild() để chia đoạn
// trước khi gửi.
function getHelpText() {
  return getHelpTextChunksForGuild().join('\n\n');
}

const SLASH_COMMANDS = [
  new SlashCommandBuilder()
    .setName('scrim')
    .setDescription('[NPC] Tạo tin nhắn vote lịch scrim tuần này')
    // Toàn bộ option optional — không nhập gì thì /scrim vẫn hoạt động y hệt
    // như trước (tin trống, điền sau bằng /us1 /us2). Nhập luôn ở đây để
    // khỏi phải gọi thêm /us1 /us2 ngay sau khi tạo.
    .addStringOption((opt) => opt.setName('b1_ngay').setDescription('Buổi 1 — Ngày trong tuần (VD: Thứ 5)').setRequired(false))
    .addStringOption((opt) => opt.setName('b1_gio').setDescription('Buổi 1 — Giờ (VD: 19:00)').setRequired(false))
    .addStringOption((opt) => opt.setName('b1_ngaythang').setDescription('Buổi 1 — Ngày/tháng (VD: 20/08/26)').setRequired(false))
    .addStringOption((opt) => opt.setName('b1_doithu').setDescription('Buổi 1 — Đối thủ').setRequired(false))
    .addStringOption((opt) => opt.setName('b1_sotran').setDescription('Buổi 1 — Số trận').setRequired(false))
    .addStringOption((opt) => opt.setName('b2_ngay').setDescription('Buổi 2 — Ngày trong tuần (VD: Thứ 4)').setRequired(false))
    .addStringOption((opt) => opt.setName('b2_gio').setDescription('Buổi 2 — Giờ (VD: 21:00)').setRequired(false))
    .addStringOption((opt) => opt.setName('b2_ngaythang').setDescription('Buổi 2 — Ngày/tháng (VD: 21/08/26)').setRequired(false))
    .addStringOption((opt) => opt.setName('b2_doithu').setDescription('Buổi 2 — Đối thủ').setRequired(false))
    .addStringOption((opt) => opt.setName('b2_sotran').setDescription('Buổi 2 — Số trận').setRequired(false)),
  new SlashCommandBuilder()
    .setName('rsvote')
    .setDescription('[NPC] Reset dữ liệu vote scrim trên Google Sheet'),
  new SlashCommandBuilder()
    .setName('us1')
    .setDescription('[NPC] Cập nhật thông tin Buổi 1')
    .addStringOption((opt) => opt.setName('ngay').setDescription('Ngày trong tuần (VD: Thứ 5)').setRequired(false))
    .addStringOption((opt) => opt.setName('gio').setDescription('Giờ (VD: 19:00)').setRequired(false))
    .addStringOption((opt) => opt.setName('ngaythang').setDescription('Ngày/tháng (VD: 20/08/26)').setRequired(false))
    .addStringOption((opt) => opt.setName('doithu').setDescription('Đối thủ Buổi 1').setRequired(false))
    .addStringOption((opt) => opt.setName('sotran').setDescription('Số trận Buổi 1').setRequired(false)),
  new SlashCommandBuilder()
    .setName('us2')
    .setDescription('[NPC] Cập nhật thông tin Buổi 2')
    .addStringOption((opt) => opt.setName('ngay').setDescription('Ngày trong tuần (VD: Thứ 4)').setRequired(false))
    .addStringOption((opt) => opt.setName('gio').setDescription('Giờ (VD: 21:00)').setRequired(false))
    .addStringOption((opt) => opt.setName('ngaythang').setDescription('Ngày/tháng (VD: 21/08/26)').setRequired(false))
    .addStringOption((opt) => opt.setName('doithu').setDescription('Đối thủ Buổi 2').setRequired(false))
    .addStringOption((opt) => opt.setName('sotran').setDescription('Số trận Buổi 2').setRequired(false)),
  new SlashCommandBuilder()
    .setName('reset')
    .setDescription('[NPC] Reset thông tin lịch scrim về mặc định'),
  new SlashCommandBuilder()
    .setName('code')
    .setDescription('[NPC] Thông báo Gift Code mới')
    .addStringOption((opt) => opt.setName('code').setDescription('Mã Gift Code').setRequired(true)),
  new SlashCommandBuilder()
    .setName('bc')
    .setDescription('[NPC] Gửi tin điểm danh Bang Chiến (ping role, react offline)'),
  new SlashCommandBuilder()
    .setName('checkvote')
    .setDescription('[NPC] Đồng bộ lại vote scrim từ react thực tế trên Discord'),
  new SlashCommandBuilder()
    .setName('topvote')
    .setDescription('Xem Bảng Xếp Hạng Chuyên Cần Vote (Top 10), cộng dồn theo từng tuần'),
  ...buildMergedSlashCommands(SlashCommandBuilder),
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Kiểm tra bot còn sống không'),
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Xem danh sách lệnh của bot'),
].map((cmd) => cmd.toJSON());

module.exports = { getHelpText, getHelpTextChunksForGuild, SLASH_COMMANDS };