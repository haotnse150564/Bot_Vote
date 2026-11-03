const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  LabelBuilder,
  FileUploadBuilder,
} = require('discord.js');

const THIKIEM_UPDATE_BUTTON_ID = 'thikiem_update_score';
// Nút "🔍 Xem Rank" đặt CẠNH nút cập nhật điểm — bấm vào luôn trả về rank
// card CỦA CHÍNH NGƯỜI BẤM (không chọn được người khác qua nút, muốn xem
// người khác thì dùng nm!rank/`/rank`). Xem thiKiem/index.js ->
// handleThiKiemViewRankButton.
const THIKIEM_VIEW_RANK_BUTTON_ID = 'thikiem_rank_card_button';
// Modal + field bấm nút mở ra (thay cho cách chờ 60 giây gửi ảnh thả trong
// kênh trước đây) — cần discord.js >=14.24 (đã khai ^14.27.0 trong
// package.json) để có LabelBuilder/FileUploadBuilder trong Modal.
const THIKIEM_UPDATE_MODAL_ID = 'thikiem_update_score_modal';
const THIKIEM_UPDATE_FILE_FIELD_ID = 'thikiem_screenshot';

const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };

// ==== Màu theo Class ====
// Discord KHÔNG cho bot tuỳ chỉnh màu NỀN của nút bấm bằng mã hex tuỳ ý —
// ButtonBuilder chỉ nhận đúng 5 style dựng sẵn (Primary/Secondary/Success/
// Danger/Link), không có API nào (kể cả Components V2 mới) cho phép gắn
// hex riêng cho nền nút. Đây là giới hạn của chính nền tảng Discord, không
// phải giới hạn của code — nên nút Class chỉ còn tên Class (Primary khi
// đang chọn, Secondary khi không) để phân biệt tab, KHÔNG cố gán màu gần
// đúng (không dùng emoji tròn màu nữa — chỉ khớp GẦN ĐÚNG nên không giải
// quyết được vấn đề, xem NMTeam (trang web) để xem đúng màu từng Class).
// Ngược lại, THANH VIỀN màu bên trái embed (setColor) thì Discord cho tuỳ
// ý 1 màu hex bất kỳ — áp dụng đúng chỗ này với đúng mã màu chính thức
// từng Class (CLASS_COLORS bên dưới). Class nào KHÔNG có trong bảng này
// (chưa cập nhật hoặc Class mới) thì tự sinh màu ổn định theo hash tên
// (hashStringToHue + hslToColorInt) để không bị vỡ. Riêng tab "Tổng" dùng
// 1 màu vàng cố định như cũ — Discord không hỗ trợ gradient cho embed nên
// không thể làm hiệu ứng chuyển màu được.
const TONG_COLOR = 0xf1c40f;

const CLASS_COLORS = {
  'Tố Vấn': 0xff99cc,
  'Thiết Y': 0xff9900,
  'Huyết Hà': 0xaa0000,
  'Cửu Linh': 0xcc66ff,
  'Thần Tương': 0x3366ff,
  'Long Ngâm': 0x00cc99,
  'Toái Mộng': 0x66ccff,
};

// Hash chuỗi tên Class -> 1 số 0-359 (hue trên vòng màu HSL) — dùng làm
// màu DỰ PHÒNG cho Class chưa có trong CLASS_COLORS ở trên. Cùng 1 tên
// Class luôn ra cùng 1 hue, khác tên gần như chắc chắn ra hue khác.
function hashStringToHue(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

// Đổi HSL -> số hex (0xRRGGBB) mà EmbedBuilder.setColor() nhận được trực
// tiếp. Cố định saturation/lightness ở mức tươi + đủ sáng (70%/55%) để màu
// nào cũng nổi rõ trên nền tối của Discord, chỉ có hue là đổi theo Class.
function hslToColorInt(h, s, l) {
  const sat = s / 100;
  const light = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toByte = (x) => Math.round(255 * x);
  return (toByte(f(0)) << 16) + (toByte(f(8)) << 8) + toByte(f(4));
}

function getClassColor(className) {
  const known = CLASS_COLORS[(className || '').trim()];
  if (known !== undefined) return known;
  return hslToColorInt(hashStringToHue(className || ''), 70, 55);
}

// (Trước đây có thêm 1 emoji vòng tròn màu gần đúng gắn lên nút Class để
// bù cho việc Discord không cho đổi màu nền nút thật — đã bỏ theo yêu cầu
// vì chỉ khớp GẦN ĐÚNG (Discord chỉ có 6 emoji tròn màu cố định) chứ không
// giải quyết được vấn đề, nút Class giờ chỉ còn tên Class. Màu THẬT theo
// từng Class (CLASS_COLORS) vẫn giữ nguyên cho thanh viền embed bên dưới —
// chỗ duy nhất Discord thật sự cho tuỳ ý màu hex.

// ==== Tab "Tổng" / theo Class trên bảng xếp hạng ====
// Bảng xếp hạng giờ có dạng tab: mặc định hiện "Tổng" (toàn bộ mọi người),
// bấm nút tên 1 Class thì bảng chuyển sang chỉ hiện người thuộc Class đó
// (hạng đánh lại từ #1 riêng cho Class), bấm lại "Tổng" thì quay về như cũ.
// Đây là 1 tin nhắn DUY NHẤT được edit qua lại (đúng tinh thần kênh chỉ có
// 2 tin cố định) — ai bấm nút cũng đổi tab cho TẤT CẢ mọi người đang xem
// (không phải xem riêng), tab đang chọn được lưu vào Config Mùa Giải (key
// "board_view", xem thiKiem/index.js) để lần cập nhật điểm tiếp theo vẫn
// giữ đúng tab đang xem thay vì tự nhảy về "Tổng".
const VIEW_TONG = 'tong';
const THIKIEM_VIEW_BUTTON_PREFIX = 'thikiem_view_';

// Số dòng tối đa giữ lại trong tin Nhật Ký Cập Nhật (tin cố định #3) — xem
// buildRecentUpdatesPayload bên dưới và thiKiem/board.js -> appendRecentUpdateLine.
const RECENT_UPDATES_MAX_LINES = 5;

// Tin cố định #3 (LUÔN đăng, cạnh Bảng Xếp Hạng) — nhật ký NGẮN các lần cập
// nhật điểm gần nhất, mới nhất ở trên, tối đa RECENT_UPDATES_MAX_LINES dòng.
// Chỉ 1 tin DUY NHẤT được EDIT lại mỗi lần có người cập nhật điểm thành
// công (không gửi tin mới mỗi lần — giữ kênh sạch, đúng tinh thần các tin
// cố định khác). Xem thiKiem/board.js -> appendRecentUpdateLine.
function buildRecentUpdatesPayload(lines) {
  const content = lines && lines.length
    ? lines.join('\n')
    : '_Chưa có lượt cập nhật điểm nào gần đây._';
  return { content };
}

function formatEntryLine(hang, entry) {
  const medal = MEDALS[hang] || '';
  const label = medal ? `#${hang} ${medal}` : `#${hang}`;
  // In đậm tên ingame để nổi bật hơn 1 chút trên bảng xếp hạng — Discord
  // embed không có thuộc tính "cỡ chữ" riêng cho từng đoạn text trong
  // cùng 1 dòng, nên **bold** là cách khả dụng gần nhất để tên trông
  // "to" hơn phần còn lại của dòng.
  const ten = entry.ingame ? `**${entry.ingame}**` : `<@${entry.discordId}>`;
  return `${label} ${ten} — ${entry.diem} điểm`;
}

// Danh sách Class đang thật sự có người cập nhật điểm (lấy trực tiếp từ dữ
// liệu, KHÔNG hardcode tên 7 Class) — dùng để build hàng nút bấm, sort theo
// bảng chữ cái tiếng Việt cho ổn định thứ tự giữa các lần bấm.
function getDistinctClassNames(entries) {
  const names = new Set();
  entries.forEach((e) => {
    const cls = (e.className || '').trim();
    if (cls) names.add(cls);
  });
  return Array.from(names).sort((a, b) => a.localeCompare(b, 'vi'));
}

// customId của nút Class KHÔNG thể để thẳng tên Class (dấu tiếng Việt +
// khoảng trắng) làm chuỗi so khớp dễ lỗi/khó đọc log — encode base64
// (round-trip đầy đủ Unicode, gọn hơn encodeURIComponent) rồi decode lại
// lúc xử lý bấm nút (xem decodeViewFromCustomId bên dưới).
function encodeClassCustomId(className) {
  return THIKIEM_VIEW_BUTTON_PREFIX + Buffer.from(className, 'utf8').toString('base64');
}

function decodeViewFromCustomId(customId) {
  const raw = customId.slice(THIKIEM_VIEW_BUTTON_PREFIX.length);
  if (raw === VIEW_TONG) return VIEW_TONG;
  try {
    return Buffer.from(raw, 'base64').toString('utf8');
  } catch (error) {
    return VIEW_TONG; // customId lỗi/không decode được -> an toàn quay về Tổng
  }
}

// Build hàng nút "Tổng" + từng Class đang có người cập nhật điểm — nút của
// tab đang chọn tô Primary (nổi bật) để người xem biết đang ở tab nào, các
// nút còn lại Secondary. Tối đa 5 nút/hàng (giới hạn Discord) nên tự chia
// hàng khi có nhiều Class.
function buildViewButtons(entries, view) {
  const classNames = getDistinctClassNames(entries);

  const buttons = [
    new ButtonBuilder()
      .setCustomId(THIKIEM_VIEW_BUTTON_PREFIX + VIEW_TONG)
      .setLabel('Tổng')
      .setEmoji('📊')
      .setStyle(!view || view === VIEW_TONG ? ButtonStyle.Primary : ButtonStyle.Secondary),
    ...classNames.map((cls) =>
      new ButtonBuilder()
        .setCustomId(encodeClassCustomId(cls))
        .setLabel(cls)
        .setStyle(view === cls ? ButtonStyle.Primary : ButtonStyle.Secondary)
    ),
  ];

  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  }
  return rows;
}

// view = VIEW_TONG (hoặc rỗng/undefined, mặc định) -> bảng toàn bộ mọi
// người, hạng lấy nguyên từ entries (đã tính sẵn trên toàn bộ). view = tên
// 1 Class -> lọc riêng người thuộc Class đó, đánh lại hạng #1 TRONG PHẠM VI
// Class này (khác hoàn toàn hạng ở tab Tổng).
function formatLeaderboardEmbed(seasonConfig, entries, view) {
  const tenMuaGiai = seasonConfig.ten_mua_giai || 'Đang cập nhật';
  const ngayBatDau = seasonConfig.ngay_bat_dau || '?';
  const ngayKetThuc = seasonConfig.ngay_ket_thuc || '?';

  const isTong = !view || view === VIEW_TONG;
  let title;
  let lines;

  if (isTong) {
    title = `🏆 BẢNG XẾP HẠNG ĐUA RANK — ${tenMuaGiai}`;
    lines = entries.length ? entries.map((e) => formatEntryLine(e.hang, e)) : ['Chưa có ai cập nhật điểm.'];
  } else {
    const classEntries = entries.filter((e) => (e.className || '').trim() === view);
    title = `🏆 BXH ĐUA RANK — ${view} — ${tenMuaGiai}`;
    lines = classEntries.length
      ? classEntries.map((e, idx) => formatEntryLine(idx + 1, e))
      : [`Chưa có ai thuộc Class "${view}" cập nhật điểm.`];
  }

  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(`Thời gian: ${ngayBatDau} - ${ngayKetThuc}\n\n${lines.join('\n')}`)
    .setColor(isTong ? TONG_COLOR : getClassColor(view))
    .setTimestamp(new Date());
}

// ==== Rank Card (nút "🔍 Xem Rank" / nm!rank / `/rank`) ====
// Bố trí bám sát ảnh gốc mục "Dữ Liệu Mùa Giải" trong game — 1 khối thông
// tin mùa giải (tên/ingame/hệ phái/hạng/điểm) + số liệu trận đấu & 5 dòng
// Kỷ lục/Trung bình.
//
// TRƯỚC ĐÂY phần số liệu được tự vẽ thành 1 bảng ASCII (padEnd + ký tự
// khung ┌─┐│└┘├─┤) nhét trong 1 code block ``` — cách này BỊ VỠ cả trên PC
// lẫn mobile vì 2 lý do: (1) code block trên mobile bị thu hẹp lại nên các
// dòng dài (~40-46 ký tự) bị Discord tự xuống dòng giữa chừng, lệch hết cột;
// (2) ngay cả khi không bị xuống dòng, các ký tự vẽ khung Unicode không
// chắc có cùng độ rộng với chữ thường trong font code của Discord, nên
// bảng vẫn lệch dù đếm ký tự đã khớp.
//
// GIẢI PHÁP: bỏ hẳn việc tự canh cột bằng khoảng trắng, chuyển sang dùng
// FIELD có sẵn của Discord Embed (embed.addFields). Field là kiểu bố cục
// RESPONSIVE gốc của Discord: trên PC tự xếp tối đa 3 field "inline" mỗi
// hàng theo chiều rộng cửa sổ, còn trên mobile Discord LUÔN xếp mỗi field
// 1 hàng full-width bất kể inline hay không — nên không bao giờ bị vỡ/lệch
// dòng như bảng ASCII nữa, vì không còn phụ thuộc vào việc đếm ký tự hay
// độ rộng font.

function statOrPlaceholder(value) {
  return value !== undefined && value !== null && value !== '' ? String(value) : '?';
}

// entry: kết quả getRankEntryByDiscordId (có thể null nếu chưa từng cập
// nhật điểm — nơi gọi tự kiểm tra & báo lỗi riêng, hàm này không tự xử lý
// trường hợp null), CỘNG THÊM field "hangHePhai" (Hạng trong phạm vi Class,
// tính động ở thiKiem/rankCard.js -> buildRankCardEmbedForId vì sheet không
// lưu sẵn cột này). targetUser: object User của discord.js (dùng lấy
// username/avatar hiển thị) — có thể null nếu không fetch được, khi đó
// dùng tạm entry.ingame hoặc Discord ID.
function formatRankCardEmbed(targetUser, entry, seasonConfig) {
  const tenMuaGiai = seasonConfig.ten_mua_giai || 'Đang cập nhật';
  const displayName = entry.ingame || (targetUser && targetUser.username) || `<@${entry.discordId}>`;

  // Bố cục: Tên mùa giải -> Ingame/Hệ Phái nằm trong description. Điểm
  // rank/Hạng chuyển thành field "🏆 Xếp Hạng" (thay vì heading ### như
  // trước) để trên PC nó có thể nằm NGANG HÀNG với field "⚔️ Trận Đấu"
  // ngay bên phải (Discord tự xếp tối đa 3 field inline/hàng theo thứ tự
  // thêm vào — Xếp Hạng luôn là field đầu tiên nên field kế tiếp luôn nằm
  // cùng hàng bên phải nó trên màn hình đủ rộng).
  const lines = [
    `**${tenMuaGiai}**`,
    '',
    `**Ingame: ${displayName}**`,
    `**Hệ Phái: ${entry.className || '?'}**`,
  ];

  const embed = new EmbedBuilder()
    .setTitle(`🏆 Thí Kiếm Thiên Hạ — ${displayName}`)
    .setDescription(lines.join('\n'))
    .setColor(entry.className ? getClassColor(entry.className) : TONG_COLOR)
    .setTimestamp(new Date());

  if (targetUser) {
    embed.setThumbnail(targetUser.displayAvatarURL());
  }

  // "Xếp Hạng" luôn có (kể cả khi chưa từng gửi ảnh cập nhật thống kê) vì
  // điểm/hạng lấy trực tiếp từ sheet chính, không phụ thuộc phần thống kê
  // đọc từ ảnh (soTran, haGuc...).
  embed.addFields({
    name: '🏆 Xếp Hạng',
    value: `Điểm rank: **${entry.diem ?? '?'}**\nHạng Hệ Phái: **${entry.hangHePhai ?? '?'}**\nHạng Tổng: **${entry.hang ?? '?'}**`,
    inline: true,
  });

  // Chỉ có nếu người này ĐÃ TỪNG gửi ảnh sau khi tính năng đọc thêm thống kê
  // được thêm vào (trước đó sheet chỉ có điểm rank, các cột G-T để trống).
  const hasStats = [
    entry.soTran,
    entry.haGuc,
    entry.kyLucHaGuc,
    entry.kyLucSatThuong,
    entry.haGucTb,
  ].some((v) => v !== undefined && v !== null && v !== '');

  if (hasStats) {
    const soTranNum = Number(entry.soTran);
    const soTranThangNum = Number(entry.soTranThang);
    const tyLe =
      Number.isFinite(soTranNum) && soTranNum > 0 && Number.isFinite(soTranThangNum)
        ? ` (${Math.round((soTranThangNum / soTranNum) * 100)}%)`
        : '';
    const soTranThangDisplay = entry.soTranThang !== '' && entry.soTranThang !== undefined ? `${entry.soTranThang}${tyLe}` : '?';

    // "Trận Đấu": Số trận / Thắng xuống 2 DÒNG riêng (không gộp 1 dòng
    // bằng dấu • nữa) — thêm ngay sau field "Xếp Hạng" nên trên PC nó tự
    // nằm cùng hàng, bên phải Xếp Hạng. Hàng đầu CHỈ có 2 field này —
    // field "spacer" \u200b full-width ngay sau ép Discord xuống hàng
    // mới, không cho field kế tiếp (K/D) tự nhảy lên lấp nốt ô thứ 3 cùng
    // hàng (mặc định Discord xếp field inline liên tục 3/hàng).
    embed.addFields(
      {
        name: '⚔️ Trận Đấu',
        value: `Số trận: **${statOrPlaceholder(entry.soTran)}**\nThắng: **${soTranThangDisplay}**`,
        inline: true,
      },
      { name: '\u200b', value: '\u200b', inline: false }
    );

    // "K/D" = Hạ gục/Bị hạ gục — đứng ĐẦU nhóm dưới (đổi tên từ "Hạ Gục"
    // cũ để không trùng tên với field "⚒ Hạ Gục" — Kỷ lục/Trung bình ngay
    // sau nó). Gộp chung 1 mảng với 5 field Kỷ lục/Trung bình để xếp
    // CHUNG 1 lượt 2 field/hàng (xem ghi chú "khoảng cách giữa các ô" bên
    // dưới), dù value format khác nhau (K/D: Hạ gục/Bị hạ, còn lại:
    // Kỷ lục/Trung bình).
    const KD_AND_STAT_FIELDS = [
      { name: '🏹 K/D', value: `Hạ gục: **${statOrPlaceholder(entry.haGuc)}**\nBị hạ: **${statOrPlaceholder(entry.biHaGuc)}**` },
      { name: '⚒ Hạ Gục', value: `Kỷ lục: **${statOrPlaceholder(entry.kyLucHaGuc)}**\nTrung bình: **${statOrPlaceholder(entry.haGucTb)}**` },
      { name: '🛠 Hỗ Trợ', value: `Kỷ lục: **${statOrPlaceholder(entry.kyLucHoTro)}**\nTrung bình: **${statOrPlaceholder(entry.hoTroTb)}**` },
      { name: '🗡 Sát Thương', value: `Kỷ lục: **${statOrPlaceholder(entry.kyLucSatThuong)}**\nTrung bình: **${statOrPlaceholder(entry.satThuongTb)}**` },
      { name: '🛡 Chống Chịu', value: `Kỷ lục: **${statOrPlaceholder(entry.kyLucChiuSt)}**\nTrung bình: **${statOrPlaceholder(entry.chiuStTb)}**` },
      { name: '❇ Trị Liệu', value: `Kỷ lục: **${statOrPlaceholder(entry.kyLucTriLieu)}**\nTrung bình: **${statOrPlaceholder(entry.triLieuTb)}**` },
    ];

    // LƯU Ý QUAN TRỌNG: khoảng cách GIỮA các ô (gutter) là do chính client
    // Discord tự vẽ theo CSS riêng của nó — không có tuỳ chọn nào trong
    // Discord Embed API (kể cả field, kể cả EmbedBuilder) cho phép bot
    // chỉnh độ rộng khoảng cách này. Đòn bẩy DUY NHẤT bot có là SỐ CỘT mỗi
    // hàng: 3 field/hàng (như trước) làm mỗi ô hẹp lại nên nhìn có vẻ sát
    // nhau hơn; xuống còn 2 field/hàng thì mỗi ô rộng hơn, khoảng trắng 2
    // bên mỗi ô theo đó cũng nhiều hơn — đổi lại bảng cao hơn 1 hàng.
    // Cách làm: cứ 2 field inline thì chèn 1 field "spacer" \u200b
    // full-width để ép Discord xuống hàng mới thay vì tự lấp ô thứ 3.
    KD_AND_STAT_FIELDS.forEach((field, idx) => {
      embed.addFields({ ...field, inline: true });
      if (idx % 2 === 1 && idx < KD_AND_STAT_FIELDS.length - 1) {
        embed.addFields({ name: '\u200b', value: '\u200b', inline: false });
      }
    });
  } else {
    embed.addFields({
      name: '\u200b',
      value: '_Chưa có dữ liệu Số trận/Kỷ lục — gửi ảnh chụp mục Dữ Liệu Mùa Giải để cập nhật đầy đủ hơn._',
    });
  }

  return embed;
}

// Hàng 2 nút "📤 Cập nhật điểm" + "🔍 Xem Rank" — dùng chung cho tin nút cố định
// cũ (buildButtonMessage) lẫn bản hiện riêng tư mở từ menu Hub (thiKiem/index.js
// -> buildRankMenuReply).
function buildActionRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(THIKIEM_UPDATE_BUTTON_ID)
      .setLabel('Cập nhật điểm')
      .setEmoji('📤')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(THIKIEM_VIEW_RANK_BUTTON_ID)
      .setLabel('Xem Rank')
      .setEmoji('🔍')
      .setStyle(ButtonStyle.Secondary)
  );
}

function buildButtonMessage() {
  const row = buildActionRow();

  return {
    content:
      'Nhấn nút và upload hình để cập nhật rank hoặc gửi trực tiếp ảnh vào chat tại kênh này.\n' +
      'Ảnh hợp lệ là ảnh **chụp full màn hình mục Dữ Liệu Mùa Giải của Thí Kiếm Thiên Hạ**.\n' +
      'Bấm "🔍 Xem Rank" để xem lại thông tin của bạn, hoặc gõ `nm!rank`/`/rank` (kèm @người khác) để tra rank của người khác.\n' +
      'Xem Tại Web: https://nhatmongnth.vercel.app/rank',
    components: [row],
  };
}

// Modal thật (popup có ô "chọn file") mở ra khi bấm nút "Cập nhật điểm" —
// FileUploadBuilder phải được bọc trong 1 LabelBuilder (bắt buộc theo API
// Modal Components mới của Discord, không thể thêm thẳng vào ModalBuilder).
function buildScoreUpdateModal() {
  const fileUpload = new FileUploadBuilder()
    .setCustomId(THIKIEM_UPDATE_FILE_FIELD_ID)
    .setRequired(true)
    .setMinValues(1)
    .setMaxValues(1);
  // KHÔNG gọi setFileTypes/addFileTypes ở đây — 1 số bản vá discord.js có
  // FileUploadBuilder nhưng chưa (hoặc không còn) có hàm này, ném lỗi
  // "not a function" ngay khi build modal. Không bắt buộc lọc loại file vì
  // bước Gemini Vision phía sau (geminiVision.js) đã tự validate is_valid_screenshot rồi.

  const label = new LabelBuilder()
    .setLabel('Ảnh chụp màn hình Thí Kiếm Thiên Hạ')
    .setDescription('Chọn 1 ảnh chụp màn hình mục Thí Kiếm Thiên Hạ để cập nhật điểm.')
    .setFileUploadComponent(fileUpload);

  return new ModalBuilder()
    .setCustomId(THIKIEM_UPDATE_MODAL_ID)
    .setTitle('Cập nhật điểm Thí Kiếm')
    .addLabelComponents(label);
}

// Bản xem trước dạng text thuần (dùng cho nút "👁 Xem trước" trên web,
// giống formatScrimMessage/formatCodeMessage) — tóm tắt đúng phần Tên +
// Thời gian sẽ hiện lên đầu Bảng Xếp Hạng thật (xem formatLeaderboardEmbed
// ở trên) để NPC xem lại trước khi bấm "Cập Nhật".
function formatSeasonUpdateMessage(seasonConfig) {
  const tenMuaGiai = seasonConfig.ten_mua_giai || '(chưa đặt tên)';
  const ngayBatDau = seasonConfig.ngay_bat_dau || '?';
  const ngayKetThuc = seasonConfig.ngay_ket_thuc || '?';
  return `🏆 BẢNG XẾP HẠNG ĐUA RANK — ${tenMuaGiai}\nThời gian: ${ngayBatDau} - ${ngayKetThuc}`;
}

module.exports = {
  THIKIEM_UPDATE_BUTTON_ID,
  THIKIEM_VIEW_RANK_BUTTON_ID,
  THIKIEM_UPDATE_MODAL_ID,
  THIKIEM_UPDATE_FILE_FIELD_ID,
  THIKIEM_VIEW_BUTTON_PREFIX,
  VIEW_TONG,
  RECENT_UPDATES_MAX_LINES,
  buildRecentUpdatesPayload,
  formatLeaderboardEmbed,
  formatRankCardEmbed,
  buildViewButtons,
  decodeViewFromCustomId,
  buildButtonMessage,
  buildActionRow,
  buildScoreUpdateModal,
  formatSeasonUpdateMessage,
};