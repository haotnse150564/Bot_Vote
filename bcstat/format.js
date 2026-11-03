const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  LabelBuilder,
  FileUploadBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { TAB_NAMES, TAB_CATEGORY_KEYS, CATEGORIES } = require('../googleSheets/bcStatSheet');

const TAB_BUTTON_PREFIX = 'bcstat_tab_';
// Nút "Gửi ảnh tự động" — không cần chọn tab trước, bot tự đọc tab đang
// sáng trong từng ảnh (xem bcstat/geminiVision.js::analyzeBcStatScreenshotAuto).
const AUTO_BUTTON_ID = 'bcstat_auto';
const FINISH_BUTTON_ID = 'bcstat_finish';
const CANCEL_BUTTON_ID = 'bcstat_cancel';
const DONE_TAB_BUTTON_ID = 'bcstat_done_tab';
const BACK_BUTTON_ID = 'bcstat_back';
// Nút "📤 Chọn ảnh" trên màn hình chờ ảnh của TỪNG tab (và cả chế độ auto) —
// mở popup thật (Modal, giống thiKiem/format.js::buildScoreUpdateModal)
// có ô "chọn file" cho phép chọn NHIỀU ảnh cùng lúc (tối đa
// MAX_UPLOAD_FILES) thay vì phải kéo/dán từng ảnh vào kênh. customId gắn
// theo tab (`${UPLOAD_BUTTON_PREFIX}${tab}`) để biết đang chọn ảnh cho tab
// nào — có thể bấm lại nút này nhiều lần để "bổ sung" thêm ảnh cho cùng 1
// tab trước khi bấm "✅ Xong tab này". Vẫn giữ song song cách gửi ảnh trực
// tiếp vào kênh (MessageCreate listener ở bcstat/imagePipeline.js::handleImageMessage) — 2 đường không
// loại trừ nhau, giống đúng tinh thần thiKiem/index.js.
const UPLOAD_BUTTON_PREFIX = 'bcstat_upload_';
const UPLOAD_MODAL_PREFIX = 'bcstat_upload_modal_';
const UPLOAD_FILE_FIELD_ID = 'bcstat_upload_files';
const MAX_UPLOAD_FILES = 8;
// Màn hình chọn "Trận nào" hiện ra SAU khi bấm "Hoàn tất & Lưu", TRƯỚC khi
// thật sự ghi vào sheet — 2 nút: nhập trận MỚI (đối thủ + ngày) hoặc chọn 1
// trận ĐÃ LƯU để sửa (tránh gõ lại/gõ sai tên+ngày tạo nhầm trận mới).
const MATCH_NEW_BUTTON_ID = 'bcstat_match_new';
const MATCH_EDIT_BUTTON_ID = 'bcstat_match_edit';
const MATCH_BACK_BUTTON_ID = 'bcstat_match_back';
// Select menu liệt kê tối đa 25 trận gần nhất để chọn sửa (xem
// getRecentMatchLabels trong googleSheets/bcStatSheet.js).
const MATCH_EDIT_SELECT_ID = 'bcstat_match_edit_select';
// Modal nhập "Tên đối thủ" + "Ngày (dd/mm/yy)" — mode 'new' (trận mới, 2 ô
// trống) hoặc 'edit' (đã điền sẵn theo trận vừa chọn ở select menu trên).
const MATCH_MODAL_NEW_ID = 'bcstat_match_modal_new';
const MATCH_MODAL_EDIT_ID = 'bcstat_match_modal_edit';
const MATCH_OPPONENT_FIELD_ID = 'bcstat_match_opponent';
const MATCH_DATE_FIELD_ID = 'bcstat_match_date';

// ===== Xác nhận gộp tên chưa khớp (mục "nếu trùng thì hiện nút xác nhận
// để cho phép bot tự gộp thông tin đã nói" trong yêu cầu người dùng) =====
// Luồng: bấm "🔗 Xem & xác nhận tên chưa khớp" (ở màn hình chính HOẶC embed
// kết quả sau khi lưu) -> bot tính lại Summary, lọc ra những tên CHƯA khớp
// tab "Bang" NHƯNG có gợi ý gần đúng (Levenshtein <= 2) -> hiện select menu
// liệt kê "tên gõ sai -> tên gợi ý" -> tích chọn 1 HOẶC NHIỀU dòng (select
// menu multi-select) -> hiện màn xác nhận liệt kê lại các cặp đã chọn kèm 2
// nút Xác nhận/Huỷ -> bấm Xác nhận -> gộp thật từng cặp
// (mergeUnmatchedAlias) + lưu alias để lần sau tự động áp dụng, không cần
// hỏi lại.
const UNMATCHED_REVIEW_BUTTON_ID = 'bcstat_review_unmatched';
const UNMATCHED_SELECT_ID = 'bcstat_unmatched_select';
const UNMATCHED_BULK_CONFIRM_BUTTON_ID = 'bcstat_merge_bulk_confirm';
const UNMATCHED_CANCEL_BUTTON_ID = 'bcstat_merge_cancel';

const LABEL_BY_KEY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));

// Màn hình chính: 4 nút chọn tab (hiện kèm số người đã thu thập trong phiên
// hiện tại nếu có) + hàng nút Hoàn tất/Huỷ.
function buildMainMenuPayload(session) {
  const tabRow = new ActionRowBuilder().addComponents(
    TAB_NAMES.map((tab) => {
      const count = session.tabs[tab] ? session.tabs[tab].size : 0;
      return new ButtonBuilder()
        .setCustomId(`${TAB_BUTTON_PREFIX}${tab}`)
        .setLabel(count ? `${tab} (${count})` : tab)
        .setStyle(count ? ButtonStyle.Success : ButtonStyle.Secondary);
    })
  );

  const autoRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(AUTO_BUTTON_ID)
      .setLabel('🚀 Gửi ảnh tự động (tự nhận tab)')
      .setStyle(ButtonStyle.Primary)
  );

  const totalTabs = TAB_NAMES.filter((tab) => session.tabs[tab] && session.tabs[tab].size).length;
  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(FINISH_BUTTON_ID)
      .setLabel('✅ Hoàn tất & Lưu')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(totalTabs === 0),
    new ButtonBuilder().setCustomId(CANCEL_BUTTON_ID).setLabel('🗑 Huỷ phiên').setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(UNMATCHED_REVIEW_BUTTON_ID)
      .setLabel('🔗 Xem & xác nhận tên chưa khớp')
      .setStyle(ButtonStyle.Secondary)
  );

  const lines = TAB_NAMES.map((tab) => {
    const count = session.tabs[tab] ? session.tabs[tab].size : 0;
    return `${count ? '✅' : '⬜'} ${tab}${count ? ` — đã ghi nhận ${count} người` : ''}`;
  });

  const embed = new EmbedBuilder()
    .setTitle('📊 Tổng hợp chỉ số Bang Chiến')
    .setDescription(
      `Bấm "🚀 Gửi ảnh tự động" để gửi ảnh của CẢ 4 tab lẫn lộn cùng lúc (nhiều tin nhắn, nhiều ảnh/tin đều được) — bot tự đọc từng ảnh thuộc tab nào.\n` +
        `Hoặc chọn đúng 1 tab bên dưới nếu muốn gửi riêng từng tab.\n\n${lines.join('\n')}`
    )
    .setColor(0x5865f2);

  return { embeds: [embed], components: [autoRow, tabRow, actionRow] };
}

// Màn hình "đang chờ ảnh" — cho 1 tab cụ thể, HOẶC chế độ auto (tab ===
// AUTO_BUTTON_ID: nhận ảnh của cả 4 tab lẫn lộn, tự phân loại theo tab đọc
// được trong từng ảnh).
function buildWaitingPayload(session, tab, lastNote) {
  if (tab === AUTO_BUTTON_ID) {
    const lines = TAB_NAMES.map((t) => {
      const count = session.tabs[t] ? session.tabs[t].size : 0;
      return `${count ? '✅' : '⬜'} ${t}${count ? ` — đã ghi nhận ${count} người` : ''}`;
    });

    const embed = new EmbedBuilder()
      .setTitle('📸 Đang chờ ảnh — Chế độ tự động (cả 4 tab)')
      .setDescription(
        `Cứ gửi ảnh chụp bảng xếp hạng ngay trong kênh này — tab nào cũng được, lẫn lộn cũng được, nhiều tin nhắn/nhiều ảnh mỗi tin đều được. Bot tự đọc từng ảnh xem thuộc tab nào rồi tự xếp đúng chỗ.\n` +
          `Bấm "✅ Xong" khi đã gửi hết ảnh.\n\n${lines.join('\n')}` +
          (lastNote ? `\n\n${lastNote}` : '')
      )
      .setColor(0xfee75c);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${UPLOAD_BUTTON_PREFIX}${AUTO_BUTTON_ID}`)
        .setLabel(`📤 Chọn ảnh (tối đa ${MAX_UPLOAD_FILES})`)
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(DONE_TAB_BUTTON_ID).setLabel('✅ Xong').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(BACK_BUTTON_ID).setLabel('🔙 Quay lại').setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [row] };
  }

  const map = session.tabs[tab];
  const names = map ? [...map.values()].map((e) => e.displayName) : [];
  const categoryLabels = TAB_CATEGORY_KEYS[tab].map((k) => LABEL_BY_KEY[k]);

  const embed = new EmbedBuilder()
    .setTitle(`📸 Đang chờ ảnh — Tab "${tab}"`)
    .setDescription(
      `Bấm "📤 Chọn ảnh" để chọn tối đa ${MAX_UPLOAD_FILES} ảnh cùng lúc cho tab **${tab}** (cột: ${categoryLabels.join(', ')}) — có thể bấm lại nhiều lần để bổ sung thêm ảnh. Vẫn có thể gửi/dán ảnh trực tiếp vào kênh này nếu muốn.\n` +
        `Bấm "✅ Xong tab này" khi đã gửi đủ ảnh.\n\n` +
        `Đã ghi nhận (${names.length}): ${names.length ? names.join(', ') : '_chưa có ai_'}` +
        (lastNote ? `\n\n${lastNote}` : '')
    )
    .setColor(0xfee75c);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${UPLOAD_BUTTON_PREFIX}${tab}`)
      .setLabel(`📤 Chọn ảnh (tối đa ${MAX_UPLOAD_FILES})`)
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(DONE_TAB_BUTTON_ID).setLabel('✅ Xong tab này').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(BACK_BUTTON_ID).setLabel('🔙 Quay lại chọn tab').setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row] };
}

// Modal thật (popup có ô "chọn file", cho chọn NHIỀU ảnh cùng lúc) mở ra khi
// bấm "📤 Chọn ảnh" ở màn hình chờ — xem chú thích UPLOAD_BUTTON_PREFIX ở
// đầu file. tab === AUTO_BUTTON_ID -> modal cho chế độ tự nhận diện.
function buildImageUploadModal(tab) {
  const fileUpload = new FileUploadBuilder()
    .setCustomId(UPLOAD_FILE_FIELD_ID)
    .setRequired(true)
    .setMinValues(1)
    .setMaxValues(MAX_UPLOAD_FILES);
  // KHÔNG gọi setFileTypes/addFileTypes — xem lý do tương tự trong
  // thiKiem/format.js::buildScoreUpdateModal (Gemini Vision phía sau đã tự
  // validate is_valid_screenshot rồi).

  const tabLabel = tab === AUTO_BUTTON_ID ? 'chế độ tự động (cả 4 tab)' : `tab "${tab}"`;
  const label = new LabelBuilder()
    .setLabel(`Ảnh chụp bảng xếp hạng — ${tabLabel}`)
    .setDescription(`Chọn tối đa ${MAX_UPLOAD_FILES} ảnh để gửi cùng lúc. Có thể bấm lại nút "📤 Chọn ảnh" nhiều lần để bổ sung thêm.`)
    .setFileUploadComponent(fileUpload);

  return new ModalBuilder()
    .setCustomId(`${UPLOAD_MODAL_PREFIX}${tab}`)
    .setTitle('Chọn ảnh Bang Chiến')
    .addLabelComponents(label);
}

// Hàng nút "🔙 Quay lại" dùng chung cho toàn bộ màn hình chọn/nhập trận —
// luôn quay về màn hình chính (buildMainMenuPayload), KHÔNG mất dữ liệu đã
// thu thập trong phiên.
function matchBackRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(MATCH_BACK_BUTTON_ID).setLabel('🔙 Quay lại').setStyle(ButtonStyle.Secondary)
  );
}

// Màn hình chọn "Trận nào" — hiện SAU khi bấm "✅ Hoàn tất & Lưu" ở màn hình
// chính, TRƯỚC khi thật sự ghi vào Google Sheet. 2 lựa chọn:
//   - "🆕 Trận mới": mở form nhập tên đối thủ + ngày cho 1 trận mới.
//   - "✏️ Sửa trận đã lưu": chọn lại 1 trận ĐÃ CÓ để ghi đè số liệu (không
//     tạo trận mới) — tránh gõ sai/gõ lại tên đối thủ+ngày dẫn tới bị hiểu
//     nhầm thành 1 trận khác.
function buildMatchPickerPayload() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(MATCH_NEW_BUTTON_ID).setLabel('🆕 Trận mới').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(MATCH_EDIT_BUTTON_ID).setLabel('✏️ Sửa trận đã lưu').setStyle(ButtonStyle.Secondary)
  );

  const embed = new EmbedBuilder()
    .setTitle('🗓 Lưu vào trận nào?')
    .setDescription(
      'Bấm "🆕 Trận mới" để nhập tên đối thủ + ngày cho 1 trận Bang Chiến MỚI (vd: Thanh Vân Các - 05/09/26 — ngày luôn là Thứ 7).\n' +
        'Bấm "✏️ Sửa trận đã lưu" nếu muốn chọn lại 1 trận đã có sẵn để ghi đè số liệu (sẽ ghi đè đúng trận đó, không tạo trận mới).'
    )
    .setColor(0x5865f2);

  return { embeds: [embed], components: [row, matchBackRow()] };
}

// Modal nhập "Tên đối thủ" + "Ngày (dd/mm/yy)" — mode 'new': 2 ô trống;
// mode 'edit': điền sẵn theo đúng trận vừa chọn ở select menu
// (buildMatchEditSelectPayload) để NPC tiện sửa lại (đổi tên đối thủ/ngày
// nếu gõ sai, hoặc giữ nguyên rồi bấm Lưu để chỉ ghi đè số liệu).
function buildMatchLabelModal({ mode = 'new', opponent = '', dateStr = '' } = {}) {
  const opponentInput = new TextInputBuilder()
    .setCustomId(MATCH_OPPONENT_FIELD_ID)
    .setLabel('Tên đối thủ')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);
  if (opponent) opponentInput.setValue(opponent);

  const dateInput = new TextInputBuilder()
    .setCustomId(MATCH_DATE_FIELD_ID)
    .setLabel('Ngày (dd/mm/yy) — luôn là Thứ 7')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('05/09/26')
    .setMaxLength(8);
  if (dateStr) dateInput.setValue(dateStr);

  return new ModalBuilder()
    .setCustomId(mode === 'edit' ? MATCH_MODAL_EDIT_ID : MATCH_MODAL_NEW_ID)
    .setTitle(mode === 'edit' ? '✏️ Sửa trận đã lưu' : '🆕 Trận mới')
    .addComponents(
      new ActionRowBuilder().addComponents(opponentInput),
      new ActionRowBuilder().addComponents(dateInput)
    );
}

// Select menu liệt kê các trận đã lưu (tối đa 25, MỚI NHẤT trước — xem
// getRecentMatchLabels) để chọn 1 trận muốn sửa — chọn xong sẽ mở modal
// buildMatchLabelModal({mode:'edit', ...}) điền sẵn theo trận đã chọn.
function buildMatchEditSelectPayload(labels) {
  if (!labels.length) {
    return {
      content: '❌ Chưa có trận nào được lưu trước đó để sửa — hãy bấm "🆕 Trận mới".',
      embeds: [],
      components: [matchBackRow()],
    };
  }

  const options = labels.slice(0, 25).map((label, idx) => ({
    label: label.slice(0, 100),
    value: String(idx),
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId(MATCH_EDIT_SELECT_ID)
    .setPlaceholder('Chọn 1 trận muốn sửa...')
    .addOptions(options);

  const embed = new EmbedBuilder()
    .setTitle('✏️ Chọn trận muốn sửa')
    .setDescription(
      `${labels.length} trận gần nhất — chọn 1 trận để mở lại form (điền sẵn tên đối thủ/ngày), sửa nếu cần rồi bấm Lưu để ghi đè số liệu vừa nhập vào đúng trận đó.` +
        (labels.length > 25 ? `\n\n_(chỉ hiện 25/${labels.length} trận gần nhất)_` : '')
    )
    .setColor(0x5865f2);

  return { content: null, embeds: [embed], components: [new ActionRowBuilder().addComponents(select), matchBackRow()] };
}

// Hàng nút "🔗 Xem & xác nhận tên chưa khớp" — dùng lại ở cả embed kết quả
// sau khi lưu (buildResultEmbed) lẫn có thể gắn thêm ở nơi khác sau này.
function buildUnmatchedReviewButtonRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(UNMATCHED_REVIEW_BUTTON_ID)
      .setLabel('🔗 Xem & xác nhận tên chưa khớp')
      .setStyle(ButtonStyle.Secondary)
  );
}

// Select menu liệt kê những tên chưa khớp NHƯNG có gợi ý gần đúng (chỉ
// những dòng này mới gộp được — không có gợi ý thì không biết gộp vào ai).
// `withSuggestion`: mảng [{name, suggestion}] đã lọc sẵn suggestion khác
// null (xem handleUnmatchedReviewButton ở index.js). Discord giới hạn tối
// đa 25 option/select nên chỉ lấy 25 dòng đầu.
function buildUnmatchedReviewPayload(withSuggestion) {
  if (!withSuggestion.length) {
    return {
      content: '✅ Không có tên nào chưa khớp mà có gợi ý gần đúng để gộp — mọi tên đã khớp hoặc chưa đủ giống tên nào trong tab "Bang".',
      embeds: [],
      components: [],
    };
  }

  const options = withSuggestion.slice(0, 25).map((u, idx) => ({
    label: `${u.name} → ${u.suggestion}`.slice(0, 100),
    description: 'Tích chọn để gộp tên gõ sai này vào tên chuẩn'.slice(0, 100),
    value: String(idx),
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId(UNMATCHED_SELECT_ID)
    .setPlaceholder('Chọn 1 hoặc nhiều tên để gộp...')
    .setMinValues(1)
    .setMaxValues(options.length)
    .addOptions(options);

  const embed = new EmbedBuilder()
    .setTitle('🔗 Tên chưa khớp — có gợi ý gần đúng')
    .setDescription(
      `Tìm thấy ${withSuggestion.length} tên chưa khớp tab "Bang" nhưng có gợi ý gần đúng.\n` +
        'Tích chọn 1 hoặc NHIỀU dòng bên dưới (bấm ra ngoài để đóng danh sách), bot sẽ hiện màn xem lại rồi bấm "✅ Xác nhận gộp" nếu đúng — bot sẽ gộp toàn bộ số liệu đã ghi nhận của các tên gõ sai vào đúng tên chuẩn, và TỰ ĐỘNG áp dụng luôn cho các lần lưu sau nếu còn gặp lại tên gõ sai y hệt.' +
        (withSuggestion.length > 25 ? `\n\n_(chỉ hiện 25/${withSuggestion.length} dòng đầu, xử lý xong sẽ hiện tiếp các dòng còn lại)_` : '')
    )
    .setColor(0x5865f2);

  return { content: null, embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] };
}

// Màn xem lại lần cuối sau khi tích chọn (1 hoặc nhiều) dòng ở select menu:
// liệt kê từng cặp "tên gõ sai → tên chuẩn" + 2 nút Xác nhận gộp (N)/Huỷ.
// `chosen`: mảng [{name, suggestion}] (xem handleUnmatchedSelect ở index.js).
// Chưa gộp thật ở bước này.
function buildBulkMergeConfirmPayload(chosen) {
  const MAX_LINES = 25; // select menu tối đa 25 dòng nên không bao giờ vượt
  const lines = chosen.slice(0, MAX_LINES).map((u) => `• **${u.name}** → **${u.suggestion}**`);
  const embed = new EmbedBuilder()
    .setTitle(`🔗 Xác nhận gộp ${chosen.length} tên?`)
    .setDescription(
      `${lines.join('\n')}\n\n` +
        'Bấm "✅ Xác nhận gộp" để gộp toàn bộ số liệu của các tên gõ sai bên trái vào tên chuẩn bên phải, và tự động áp dụng cho các lần lưu sau. Bấm "❌ Huỷ" để quay lại chọn lại.'
    )
    .setColor(0xfee75c);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(UNMATCHED_BULK_CONFIRM_BUTTON_ID)
      .setLabel(`✅ Xác nhận gộp (${chosen.length})`)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(UNMATCHED_CANCEL_BUTTON_ID).setLabel('❌ Huỷ').setStyle(ButtonStyle.Danger)
  );

  return { content: null, embeds: [embed], components: [row] };
}

function buildResultEmbed({ sessionLabel, matchLabel, playerCount, summaryResult }) {
  const embed = new EmbedBuilder()
    .setTitle('✅ Đã lưu phiên ghi nhận Bang Chiến')
    .addFields(
      { name: 'Session', value: sessionLabel, inline: false },
      { name: 'Trận', value: matchLabel, inline: true },
      { name: 'Số người trong phiên này', value: String(playerCount), inline: true },
      { name: 'Tổng số người trong Summary', value: String(summaryResult.playerCount), inline: true },
      { name: 'Khớp Class (tab Bang)', value: String(summaryResult.matched), inline: true }
    )
    .setColor(0x57f287);

  if (summaryResult.unmatched.length) {
    const lines = summaryResult.unmatched
      .slice(0, 15)
      .map((u) => `• ${u.name}${u.suggestion ? ` (có thể là "${u.suggestion}"?)` : ' (không tìm thấy tên gần đúng)'}`);
    embed.addFields({
      name: `⚠️ ${summaryResult.unmatched.length} tên chưa khớp với tab "Bang"`,
      value: `${lines.join('\n')}${summaryResult.unmatched.length > 15 ? '\n…' : ''}\nBấm nút "🔗 Xem & xác nhận tên chưa khớp" bên dưới nếu muốn gộp ngay, hoặc kiểm tra/sửa tay trong sheet Summary.`,
    });
  }

  return embed;
}

module.exports = {
  TAB_BUTTON_PREFIX,
  AUTO_BUTTON_ID,
  FINISH_BUTTON_ID,
  CANCEL_BUTTON_ID,
  DONE_TAB_BUTTON_ID,
  BACK_BUTTON_ID,
  MATCH_NEW_BUTTON_ID,
  MATCH_EDIT_BUTTON_ID,
  MATCH_BACK_BUTTON_ID,
  MATCH_EDIT_SELECT_ID,
  MATCH_MODAL_NEW_ID,
  MATCH_MODAL_EDIT_ID,
  MATCH_OPPONENT_FIELD_ID,
  MATCH_DATE_FIELD_ID,
  UPLOAD_BUTTON_PREFIX,
  UPLOAD_MODAL_PREFIX,
  UPLOAD_FILE_FIELD_ID,
  MAX_UPLOAD_FILES,
  UNMATCHED_REVIEW_BUTTON_ID,
  UNMATCHED_SELECT_ID,
  UNMATCHED_BULK_CONFIRM_BUTTON_ID,
  UNMATCHED_CANCEL_BUTTON_ID,
  buildMainMenuPayload,
  buildWaitingPayload,
  buildMatchPickerPayload,
  buildMatchLabelModal,
  buildMatchEditSelectPayload,
  buildImageUploadModal,
  buildResultEmbed,
  buildUnmatchedReviewButtonRow,
  buildUnmatchedReviewPayload,
  buildBulkMergeConfirmPayload,
};