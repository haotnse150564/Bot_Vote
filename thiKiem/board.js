// ===== Thí Kiếm: Bảng Xếp Hạng (tin cố định #1 + #2, menu Hub, chuyển tab) =====
// Tách khỏi index.js.

const { MessageFlags } = require('discord.js');
const client = require('../client');
const {
  HUB_CHANNEL_ID,
  THIKIEM_BOARD_CHANNEL_ID,
  THIKIEM_BOARD_SHOW_BUTTONS,
} = require('../config');
const {
  getSeasonConfig,
  setSeasonConfigValues,
  recomputeRanksAndGetLeaderboard,
} = require('../googleSheets/thiKiemSheet');
const { retryOnQuotaExceeded } = require('../utils/retry');
const { createCoalescedRunner } = require('../utils/coalesce');
const { getVnNow } = require('../utils/time');
const {
  VIEW_TONG,
  RECENT_UPDATES_MAX_LINES,
  formatLeaderboardEmbed,
  buildViewButtons,
  decodeViewFromCustomId,
  buildButtonMessage,
  buildActionRow,
  buildRecentUpdatesPayload,
} = require('./format');

// Trả về { embeds, components } cho tin #1 (Bảng Xếp Hạng) — dùng chung cho
// cả lúc đăng tin lần đầu (ensureThiKiemMessagesPosted) lẫn lúc edit lại
// (refreshLeaderboardMessage/handleThiKiemViewButton) để 2 chỗ luôn hiện
// đúng cùng 1 format + đúng hàng nút chuyển tab Tổng/Class.
function buildBoardMessagePayload(config, entries, view, { withActions = false } = {}) {
  // withActions: bản hiện RIÊNG TƯ mở từ menu Hub — kèm luôn hàng nút "Cập nhật
  // điểm"/"Xem Rank" ngay dưới các nút chuyển tab (Discord tối đa 5 hàng nên
  // chỉ lấy tối đa 4 hàng tab).
  const tabRows = buildViewButtons(entries, view);
  return {
    embeds: [formatLeaderboardEmbed(config, entries, view)],
    components: withActions ? [...tabRows.slice(0, 4), buildActionRow()] : tabRows,
  };
}

// ===== Menu Hub: chọn "Đua Rank Thí Kiếm" =====
// Trả payload (KHÔNG kèm ephemeral — hub/index.js tự thêm) chỉ gồm nút "Cập nhật
// điểm"/"Xem Rank". Các nút dùng lại handler sẵn có nên hoạt động y như tin cố định cũ.
async function buildRankMenuReply() {
  // Chỉ hiện NÚT thao tác (không show bảng xếp hạng — xem bảng ở web hoặc /xem-bang-xep-hang-thi-kiem).
  const boardChannelHint =
    THIKIEM_BOARD_CHANNEL_ID && THIKIEM_BOARD_CHANNEL_ID !== HUB_CHANNEL_ID
      ? `\nHoặc gửi ảnh thẳng vào <#${THIKIEM_BOARD_CHANNEL_ID}> — không cần bấm gì.`
      : '';
  return {
    components: [buildActionRow()],
    content:
      '📸 **Gửi ảnh chụp full màn hình mục Dữ Liệu Mùa Giải** (Thí Kiếm Thiên Hạ) ngay vào kênh này trong 5 phút — ' +
      'bot tự cập nhật điểm rồi báo kết quả cho bạn qua tin nhắn riêng. Hoặc bấm **📤 Cập nhật điểm** để chọn file.' +
      `${boardChannelHint}\n` +
      '🔍 **Xem Rank** để xem thông tin của bạn. Web: https://nhatmongnth.vercel.app/rank',
  };
}

// Đọc tab đang được chọn từ Config Mùa Giải — "" (hoặc thiếu key, sheet cũ
// từ trước khi có tính năng tab) đều coi là Tổng.
function getCurrentBoardView(config) {
  return config.board_view || VIEW_TONG;
}

// Đăng LẠI TỪ ĐẦU 2 tin cố định trong kênh — gọi 1 lần lúc ClientReady, SAU
// khi resetFixedBoardChannels() (utils/channelReset.js) đã dọn sạch kênh.
// LUÔN gửi tin mới (không thử fetch lại ID cũ nữa) vì kênh vừa được dọn
// sạch mỗi lần deploy theo yêu cầu mới — tin cũ (bảng điểm rank Tổng lẫn
// nút "Cập nhật điểm" / "Xem Rank") chắc chắn không còn tồn tại để tìm lại.
async function ensureThiKiemMessagesPosted() {
  if (!THIKIEM_BOARD_CHANNEL_ID || THIKIEM_BOARD_CHANNEL_ID === HUB_CHANNEL_ID) return; // kênh Hub chỉ có tin menu

  try {
    const channel = await client.channels.fetch(THIKIEM_BOARD_CHANNEL_ID);

    // Tin #1 — Bảng xếp hạng (điểm rank Tổng, giữ nguyên tab đang chọn nếu
    // có — xem getCurrentBoardView). Đọc/ghi sheet TÁCH RIÊNG khỏi bước
    // channel.send() và tự thử lại nếu dính quota (xem utils/retry.js) —
    // để nếu phải thử lại thì KHÔNG gửi trùng thêm tin Discord mới.
    const entries = await retryOnQuotaExceeded(() => recomputeRanksAndGetLeaderboard(), {
      label: 'Tính lại Bảng Xếp Hạng Thí Kiếm',
    });
    const freshConfig = await retryOnQuotaExceeded(() => getSeasonConfig(), {
      label: 'Đọc Config Mùa Giải Thí Kiếm',
    });
    const boardMessage = await channel.send(buildBoardMessagePayload(freshConfig, entries, getCurrentBoardView(freshConfig)));
    await retryOnQuotaExceeded(() => setSeasonConfigValues({ board_message_id: boardMessage.id }), {
      label: 'Lưu ID tin Bảng Xếp Hạng Thí Kiếm',
    });

    // Tin #2 (TUỲ CHỌN, mặc định TẮT) — Nút "📤 Cập nhật điểm" + "🔍 Xem Rank" (nội
    // dung tĩnh). Mặc định kênh bảng chỉ hiện bảng xếp hạng, nút cập nhật điểm nằm ở
    // menu Hub — bật bằng ENV THIKIEM_BOARD_SHOW_BUTTONS=true nếu muốn có nút ở đây.
    if (THIKIEM_BOARD_SHOW_BUTTONS) {
      const buttonMessage = await channel.send(buildButtonMessage());
      await retryOnQuotaExceeded(() => setSeasonConfigValues({ button_message_id: buttonMessage.id }), {
        label: 'Lưu ID tin nút Cập Nhật/Xem Rank',
      });
    }

    // Tin #3 (LUÔN đăng) — Nhật Ký Cập Nhật (tối đa 5 dòng gần nhất, xem
    // format.js -> buildRecentUpdatesPayload). Kênh vừa dọn sạch nên nhật
    // ký cũ (nếu có từ trước khi deploy) không còn ý nghĩa — reset về rỗng
    // luôn ở đây thay vì giữ log cũ.
    const recentMessage = await channel.send(buildRecentUpdatesPayload([]));
    await retryOnQuotaExceeded(
      () => setSeasonConfigValues({ recent_updates_message_id: recentMessage.id, recent_updates_log: '' }),
      { label: 'Lưu ID tin Nhật Ký Cập Nhật Thí Kiếm' }
    );

    console.log(
      THIKIEM_BOARD_SHOW_BUTTONS
        ? 'Đã đăng lại 2 tin cố định (Bảng Xếp Hạng + nút Cập Nhật/Xem Rank) của Đua Rank Thí Kiếm (dọn kênh mỗi lần deploy).'
        : 'Đã đăng lại tin Bảng Xếp Hạng Đua Rank Thí Kiếm (dọn kênh mỗi lần deploy).'
    );
  } catch (error) {
    console.error('Không thể đăng lại 2 tin cố định của Đua Rank Thí Kiếm:', error.message);
  }
}

// Tính lại hạng toàn bộ sheet rồi edit lại đúng tin #1 đã lưu ID, GIỮ
// NGUYÊN tab đang được chọn (config.board_view — xem getCurrentBoardView)
// thay vì tự nhảy về Tổng mỗi khi có người cập nhật điểm. Nếu tin cũ đã bị
// XOÁ TAY (hoặc chưa từng đăng) thì TỰ ĐĂNG LẠI tin mới ngay tại đây (thay
// vì chỉ cảnh báo rồi bỏ qua như trước) — để NPC gọi `/xem-bang-xep-hang-thi-kiem`
// hoặc gửi điểm mới là bảng xếp hạng tự hiện lại, không cần restart bot.
async function refreshLeaderboardMessageNow() {
  const entries = await recomputeRanksAndGetLeaderboard();
  const config = await getSeasonConfig();

  if (!THIKIEM_BOARD_CHANNEL_ID || THIKIEM_BOARD_CHANNEL_ID === HUB_CHANNEL_ID) return entries; // kênh Hub chỉ có tin menu

  try {
    const channel = await client.channels.fetch(THIKIEM_BOARD_CHANNEL_ID);
    const payload = buildBoardMessagePayload(config, entries, getCurrentBoardView(config));

    let message = null;
    if (config.board_message_id) {
      try {
        message = await channel.messages.fetch(config.board_message_id);
      } catch (error) {
        message = null; // tin cũ đã bị xoá tay / không còn tồn tại
      }
    }

    if (message) {
      await message.edit(payload);
    } else {
      message = await channel.send(payload);
      await setSeasonConfigValues({ board_message_id: message.id });
      console.log('Tin Bảng Xếp Hạng Thí Kiếm cũ không còn tồn tại — đã đăng lại tin mới.');
    }
  } catch (error) {
    console.error('Không edit/đăng lại được tin Bảng Xếp Hạng Thí Kiếm:', error.message);
  }

  return entries;
}

// Bản dùng chung cho MỌI nơi gọi (cập nhật điểm, /set-mua-giai, /xoa-diem..., web
// admin): nhiều người cập nhật cùng lúc thì các lời gọi trong lúc 1 lượt đang chạy
// được GỘP thành đúng 1 lượt kế tiếp (chạy ngay khi lượt hiện tại xong) — không dồn
// dập Google Sheets, và không bao giờ để bản tính CŨ ghi đè bản MỚI lên tin bảng.
// Mỗi người gọi luôn nhận kết quả của lượt bắt đầu SAU khi điểm của họ đã ghi xong.
const refreshLeaderboardMessage = createCoalescedRunner(refreshLeaderboardMessageNow);

// Bấm nút "Tổng" hoặc tên 1 Class -> chuyển tab bảng xếp hạng cho TẤT CẢ
// mọi người đang xem (đây là tin nhắn dùng chung, không phải ephemeral) —
// lưu lại tab vừa chọn vào Config Mùa Giải rồi edit thẳng luôn tin #1.
// QUAN TRỌNG: Discord chỉ cho 3 giây để "ack" 1 interaction. 3 lệnh gọi
// Google Sheets bên dưới (setSeasonConfigValues -> recomputeRanks... ->
// getSeasonConfig) cộng lại rất dễ vượt quá 3 giây, nên PHẢI
// deferUpdate() NGAY DÒNG ĐẦU TIÊN để ack trước (Discord cho thêm tới 15
// phút sau khi đã defer), rồi mới làm phần chậm và editReply() kết quả —
// đây chính là nguyên nhân gây lỗi "đã không phản hồi kịp thời" trước đây
// (dùng interaction.update() sau khi đã chờ xong cả 3 lệnh Sheets).
async function handleThiKiemViewButton(interaction) {
  const view = decodeViewFromCustomId(interaction.customId);

  try {
    await interaction.deferUpdate();
    await setSeasonConfigValues({ board_view: view === VIEW_TONG ? '' : view });
    const entries = await recomputeRanksAndGetLeaderboard();
    const config = await getSeasonConfig();
    // Tin hiện riêng tư từ menu Hub (ephemeral) cần giữ hàng nút Cập nhật/Xem Rank.
    const isEphemeralMenu = Boolean(interaction.message && interaction.message.flags && interaction.message.flags.has(MessageFlags.Ephemeral));
    await interaction.editReply(buildBoardMessagePayload(config, entries, view, { withActions: isEphemeralMenu }));
  } catch (error) {
    console.error('Không chuyển được tab Bảng Xếp Hạng Thí Kiếm:', error.message);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ Không chuyển được tab, vui lòng thử lại.', ephemeral: true });
      } else {
        await interaction.followUp({ content: '❌ Không chuyển được tab, vui lòng thử lại.', ephemeral: true });
      }
    } catch (replyError) {
      console.error('Không gửi được thông báo lỗi chuyển tab Thí Kiếm:', replyError.message);
    }
  }
}

// Ghi thêm 1 dòng "<ingame> đã cập nhật điểm rank lúc <giờ>" vào tin Nhật Ký
// Cập Nhật (tin cố định #3) — GIỮ TỐI ĐA RECENT_UPDATES_MAX_LINES dòng gần
// nhất (dòng mới nhất luôn ở trên, dòng cũ nhất rơi ra ngoài khi vượt quá),
// EDIT lại đúng 1 tin thay vì gửi tin mới mỗi lần (giữ kênh sạch, đúng tinh
// thần các tin cố định khác — xem buildRecentUpdatesPayload trong format.js).
// Log được lưu bền trong Config Mùa Giải (key recent_updates_log, dạng
// JSON) — nếu tin đã lưu ID bị xoá tay / không tìm thấy thì TỰ ĐĂNG LẠI tin
// mới, giống tinh thần refreshLeaderboardMessageNow ở trên. Gọi từ
// thiKiem/scoreImage.js NGAY SAU khi ghi điểm thành công. KHÔNG throw ra
// ngoài — lỗi ở đây (thiếu quyền, quota Sheets...) chỉ nên log lại, không
// được làm hỏng luồng cập nhật điểm chính (đã có kết quả trả về người dùng
// từ bước ghi sheet rồi).
async function appendRecentUpdateLine(ingame) {
  if (!THIKIEM_BOARD_CHANNEL_ID || THIKIEM_BOARD_CHANNEL_ID === HUB_CHANNEL_ID) return; // kênh Hub chỉ có tin menu

  try {
    const config = await getSeasonConfig();
    let lines = [];
    if (config.recent_updates_log) {
      try {
        const parsed = JSON.parse(config.recent_updates_log);
        if (Array.isArray(parsed)) lines = parsed;
      } catch (error) {
        lines = []; // log cũ lỗi định dạng (vd sửa tay trong sheet) -> bỏ qua, bắt đầu lại
      }
    }

    const now = getVnNow();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const line = `**${ingame}** đã cập nhật điểm rank lúc ${hh}:${mm}`;
    lines = [line, ...lines].slice(0, RECENT_UPDATES_MAX_LINES);

    const channel = await client.channels.fetch(THIKIEM_BOARD_CHANNEL_ID);
    const payload = buildRecentUpdatesPayload(lines);

    let message = null;
    if (config.recent_updates_message_id) {
      try {
        message = await channel.messages.fetch(config.recent_updates_message_id);
      } catch (error) {
        message = null; // tin cũ đã bị xoá tay / không còn tồn tại
      }
    }

    if (message) {
      await message.edit(payload);
    } else {
      message = await channel.send(payload);
    }

    await setSeasonConfigValues({
      recent_updates_message_id: message.id,
      recent_updates_log: JSON.stringify(lines),
    });
  } catch (error) {
    console.error('Không ghi được dòng Nhật Ký Cập Nhật Thí Kiếm:', error.message);
  }
}

// Tự động XOÁ SẠCH Nhật Ký Cập Nhật (tin cố định #3) mỗi
// THIKIEM_RECENT_UPDATES_CLEAR_INTERVAL_MS (mặc định 30 phút, xem
// index.js -> setInterval) — về lại trạng thái rỗng
// ("_Chưa có lượt cập nhật điểm nào gần đây._") thay vì để nhật ký hiển thị
// mãi các dòng cũ đã hết ý nghĩa theo thời gian. CHỈ xoá khi log đang thật sự
// có dòng (tránh edit tin vô ích + tốn quota Sheets khi chẳng có gì để xoá).
async function clearRecentUpdatesLog() {
  if (!THIKIEM_BOARD_CHANNEL_ID || THIKIEM_BOARD_CHANNEL_ID === HUB_CHANNEL_ID) return; // kênh Hub chỉ có tin menu

  try {
    const config = await getSeasonConfig();
    if (!config.recent_updates_log) return; // đã rỗng sẵn, khỏi cần làm gì

    const channel = await client.channels.fetch(THIKIEM_BOARD_CHANNEL_ID);
    const payload = buildRecentUpdatesPayload([]);

    let message = null;
    if (config.recent_updates_message_id) {
      try {
        message = await channel.messages.fetch(config.recent_updates_message_id);
      } catch (error) {
        message = null; // tin cũ đã bị xoá tay / không còn tồn tại
      }
    }

    if (message) {
      await message.edit(payload);
    } else {
      message = await channel.send(payload);
    }

    await setSeasonConfigValues({ recent_updates_message_id: message.id, recent_updates_log: '' });
    console.log('Đã tự xoá Nhật Ký Cập Nhật Thí Kiếm (đến hạn 30 phút).');
  } catch (error) {
    console.error('Không thể tự xoá Nhật Ký Cập Nhật Thí Kiếm:', error.message);
  }
}

module.exports = {
  buildBoardMessagePayload,
  buildRankMenuReply,
  getCurrentBoardView,
  ensureThiKiemMessagesPosted,
  refreshLeaderboardMessage,
  handleThiKiemViewButton,
  appendRecentUpdateLine,
  clearRecentUpdatesLog,
};
