// ===== Thí Kiếm: 2 cách gửi ảnh cập nhật điểm (nút -> modal / dán ảnh vào kênh) =====
// Tách khỏi index.js.

const client = require('../client');
const { HUB_CHANNEL_ID, THIKIEM_BOARD_CHANNEL_ID } = require('../config');
const { isBotReady } = require('../utils/readyGate');
const { THIKIEM_UPDATE_FILE_FIELD_ID, buildScoreUpdateModal } = require('./format');
const { processingUsers, markRankAwaiting, isRankAwaiting } = require('./sharedState');
const { claimMessage } = require('../hub/messageGuard');
const { processThiKiemImage } = require('./scoreImage');

// Bấm nút -> mở popup thật luôn (showModal PHẢI là phản hồi đầu tiên cho
// tương tác nút, không được defer/reply trước) — người dùng chọn ảnh &
// Submit ngay trong đó, xem handleThiKiemUpdateModalSubmit bên dưới.
async function handleThiKiemUpdateButton(interaction) {
  const discordId = interaction.user.id;

  if (processingUsers.has(discordId)) {
    await interaction.reply({
      content: '⏳ Bạn đang có 1 yêu cầu cập nhật đang được xử lý, vui lòng đợi kết quả trước khi bấm lại.',
      ephemeral: true,
    });
    return;
  }

  // Mở phiên chờ ảnh ở kênh Hub: nếu dán ảnh vào popup mà nó "lọt" ra ô chat
  // (lỗi Discord đã nêu ở trên) thì ảnh vẫn được nhận thay vì bị gác cổng xoá.
  if (HUB_CHANNEL_ID && interaction.channelId === HUB_CHANNEL_ID) markRankAwaiting(discordId);

  try {
    await interaction.showModal(buildScoreUpdateModal());
  } catch (error) {
    // Lỗi phổ biến nhất ở đây: server CHƯA `npm install` lại sau khi
    // package.json đổi discord.js -> vẫn chạy bản cũ không có
    // LabelBuilder/FileUploadBuilder (yêu cầu discord.js >=14.24), nên
    // buildScoreUpdateModal() ném lỗi TRƯỚC KHI showModal kịp gọi -> Discord
    // không nhận được phản hồi nào trong 3 giây -> hiện lỗi "không phản hồi
    // kịp thời" chung chung phía người dùng. Log rõ + trả lời luôn (còn kịp
    // vì lỗi này xảy ra ngay trước khi gọi API, chưa tốn thời gian mạng)
    // thay vì để Discord tự hiện lỗi im lặng.
    console.error(
      'Không mở được popup Cập nhật điểm Thí Kiếm — kiểm tra lại phiên bản discord.js đã cài (cần >=14.24, package.json khai ^14.27.0 — thử `npm install` lại nếu chưa):',
      error
    );
    if (!interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({
          content: '❌ Không mở được form cập nhật điểm (lỗi hệ thống), vui lòng báo NPC kiểm tra lại bot.',
          ephemeral: true,
        });
      } catch (replyError) {
        console.error('Không gửi được thông báo lỗi cho người bấm nút Thí Kiếm:', replyError.message);
      }
    }
  }
}

async function handleThiKiemUpdateModalSubmit(interaction) {
  const discordId = interaction.user.id;

  if (processingUsers.has(discordId)) {
    await interaction.reply({
      content: '⏳ Bạn đang có 1 yêu cầu cập nhật đang được xử lý, vui lòng đợi kết quả trước khi thử lại.',
      ephemeral: true,
    });
    return;
  }

  // FileUploadBuilder đã setRequired(true) nên Discord tự chặn submit rỗng,
  // nhưng vẫn kiểm tra lại cho chắc trước khi tải ảnh.
  const files = interaction.fields.getUploadedFiles(THIKIEM_UPDATE_FILE_FIELD_ID);
  const attachment = files ? files.first() : null;
  if (!attachment) {
    await interaction.reply({ content: '❌ Bạn chưa chọn ảnh nào, vui lòng bấm nút và thử lại.', ephemeral: true });
    return;
  }

  processingUsers.add(discordId);
  // Gemini Vision + ghi sheet mất hơn 3 giây -> phải defer ngay để không bị
  // Discord coi là timeout tương tác.
  await interaction.deferReply({ ephemeral: true });

  let resultText;
  try {
    resultText = await processThiKiemImage(discordId, attachment);
  } catch (error) {
    console.error('Lỗi xử lý ảnh Đua Rank Thí Kiếm:', error.message);
    resultText = '❌ Có lỗi xảy ra khi xử lý ảnh, vui lòng thử lại sau.';
  } finally {
    processingUsers.delete(discordId);
  }

  await interaction.editReply({ content: resultText });
}

// ===== Cách 2: dán/gửi ảnh trực tiếp vào kênh (không qua nút/modal) =====
// Bù cho hạn chế hiện tại của Discord: Ctrl+V dán ảnh vào Ô UPLOAD FILE
// trong modal bị lỗi (dán lọt ra ô chat phía sau modal thay vì vào field),
// nhưng dán ảnh vào Ô CHAT bình thường của kênh thì vẫn hoạt động tốt. Nên
// giữ song song 2 đường: bấm nút (modal, có nút chọn file) HOẶC gửi thẳng
// ảnh vào kênh (dán Ctrl+V rồi Enter) — không cần bấm nút/chờ gì trước, ai
// gửi ảnh vào kênh cũng được xử lý luôn. Sau khi xử lý xong LUÔN xoá tin ảnh
// gốc để giữ đúng quy tắc kênh chỉ có 2 tin cố định (bảng xếp hạng + nút).
// Tin nhắn KHÔNG phải ảnh (text...) bị xoá ngay ở nhánh `if (!attachment)`
// phía trên, không tới được đoạn xử lý này.
async function sendThiKiemDirectResult(originalMessage, discordId, resultText) {
  // Ưu tiên DM (giữ tinh thần riêng tư như ephemeral bên modal) — nếu người
  // dùng chặn DM từ thành viên server thì fallback gửi tạm trong kênh rồi tự
  // xoá sau ít giây, tránh để lại rác trong kênh.
  try {
    const user = await client.users.fetch(discordId);
    await user.send(resultText);
    return;
  } catch (error) {
    // Rơi xuống fallback bên dưới.
  }

  try {
    const notice = await originalMessage.channel.send({
      content: `<@${discordId}> ${resultText}`,
      allowedMentions: { users: [discordId] },
    });
    setTimeout(() => {
      notice.delete().catch(() => {});
    }, 10_000);
  } catch (error) {
    console.error('Không gửi được kết quả cập nhật điểm Thí Kiếm (gửi ảnh trực tiếp):', error.message);
  }
}

async function handleBoardChannelMessage(message) {
  try {
    if (message.author.bot) return;

    // 2 nơi nhận ảnh: (1) kênh Đua Rank riêng (THIKIEM_BOARD_CHANNEL_ID) — ai gửi
    // ảnh cũng được; (2) kênh HUB — CHỈ người vừa mở mục "Đua Rank Thí Kiếm"/nút
    // "Cập nhật điểm" (còn hạn, xem sharedState.js), vì Hub dùng chung với Check
    // Gear/bcstat nên không thể coi mọi ảnh là ảnh rank.
    const inBoardChannel = Boolean(THIKIEM_BOARD_CHANNEL_ID)
      && THIKIEM_BOARD_CHANNEL_ID !== HUB_CHANNEL_ID
      && message.channelId === THIKIEM_BOARD_CHANNEL_ID;
    const inHubAwaiting = Boolean(HUB_CHANNEL_ID)
      && message.channelId === HUB_CHANNEL_ID
      && isRankAwaiting(message.author.id);
    if (!inBoardChannel && !inHubAwaiting) return;

    if (inHubAwaiting) {
      // Tin chữ/không có ảnh: để lớp gác cổng Hub tự xoá (tránh xoá 2 lần).
      const hasImage = message.attachments.some((a) => (a.contentType || '').startsWith('image/'));
      if (!hasImage) return;
      // ĐỒNG BỘ, trước mọi await: báo gác cổng "tin này đang được xử lý".
      claimMessage(message.id);
    }

    // Kênh này giờ DÙNG CHUNG với Sảnh Vinh Danh Bang Chiến (xem
    // VINHDANH_CHANNEL_ID trong config.js) — tin bắt đầu bằng `nm!vinhdanh`
    // (kèm ảnh) là lệnh cập nhật Vinh Danh, KHÔNG phải ảnh cập nhật điểm
    // Thí Kiếm. Bỏ qua hoàn toàn ở đây (không xử lý, không xoá) để
    // vinhDanh/index.js là nơi DUY NHẤT xử lý tin này.
    if (/^nm!vinhdanh(\s|$)/i.test((message.content || '').trim())) return;

    if (!isBotReady()) {
      await sendThiKiemDirectResult(message, message.author.id, '⏳ Bot đang nạp thông tin, vui lòng thử lại sau.');
      try {
        await message.delete();
      } catch (error) {
        console.error('Không xoá được ảnh gửi lúc bot chưa nạp xong dữ liệu (kênh Thí Kiếm):', error.message);
      }
      return;
    }

    const attachment = message.attachments.find((a) => (a.contentType || '').startsWith('image/'));
    if (!attachment) {
      // Kênh Đua Rank CHỈ cho phép bấm nút hoặc gửi ảnh — kể cả nm!rank
      // cũng KHÔNG được gõ ở đây nữa (muốn tra rank thì bấm nút "🔍 Xem
      // Rank" ngay trong kênh này, hoặc gõ nm!rank/`/rank` ở kênh khác).
      // Tự động xoá NGAY, KHÔNG cần báo/nhắc gì cả (giữ kênh sạch, tránh
      // spam thông báo lỗi lặp lại nếu ai đó chưa quen).
      try {
        await message.delete();
      } catch (error) {
        console.error('Không xoá được tin nhắn không hợp lệ (không phải ảnh) trong kênh Thí Kiếm:', error.message);
      }
      return;
    }

    const discordId = message.author.id;

    if (processingUsers.has(discordId)) {
      await sendThiKiemDirectResult(
        message,
        discordId,
        '⏳ Bạn đang có 1 yêu cầu cập nhật đang được xử lý, vui lòng đợi kết quả trước khi gửi ảnh tiếp.'
      );
      try {
        await message.delete();
      } catch (error) {
        console.error('Không xoá được ảnh gửi trùng lúc đang xử lý (kênh Thí Kiếm):', error.message);
      }
      return;
    }

    processingUsers.add(discordId);
    // Phản hồi NGAY để người gửi biết bot đã nhận ảnh (gửi ảnh vào chat không có
    // dòng "đang xử lý" như popup/modal nên trước đây trông như bị treo cho tới
    // khi có kết quả). Không await — lỗi react (thiếu quyền...) không ảnh hưởng.
    message.react('⏳').catch(() => {});

    let resultText;
    try {
      resultText = await processThiKiemImage(discordId, attachment);
    } catch (error) {
      console.error('Lỗi xử lý ảnh Đua Rank Thí Kiếm (gửi trực tiếp trong kênh):', error.message);
      resultText = '❌ Có lỗi xảy ra khi xử lý ảnh, vui lòng thử lại sau.';
    } finally {
      processingUsers.delete(discordId);
    }

    // Xoá ảnh gốc để giữ kênh sạch (chỉ còn đúng 2 tin cố định) — chạy SONG
    // SONG với việc trả kết quả (trước đây phải chờ xoá xong mới gửi kết quả,
    // xoá bị rate limit thì kết quả cũng bị trễ theo).
    const deletion = message.delete().catch((error) => {
      console.error('Không xoá được ảnh gốc trong kênh Đua Rank Thí Kiếm:', error.message);
    });

    // Ở Hub: gia hạn phiên chờ để người dùng gửi tiếp ảnh (vd gửi lại khi lỗi).
    if (inHubAwaiting) markRankAwaiting(discordId);

    await sendThiKiemDirectResult(message, discordId, resultText);
    await deletion;
  } catch (error) {
    console.error('Lỗi xử lý tin nhắn ảnh gửi trực tiếp (Đua Rank Thí Kiếm):', error.message);
  }
}

module.exports = {
  handleThiKiemUpdateButton,
  handleThiKiemUpdateModalSubmit,
  handleBoardChannelMessage,
};
