// ===== /bcstat: đọc ảnh (Gemini Vision) — gửi trong kênh HOẶC chọn qua modal =====
// Tách khỏi index.js.

const { TAB_NAMES, TAB_CATEGORY_KEYS, normalizeName } = require('../googleSheets/bcStatSheet');
const { analyzeBcStatScreenshot, analyzeBcStatScreenshotAuto } = require('./geminiVision');
const { AUTO_BUTTON_ID, UPLOAD_FILE_FIELD_ID, buildWaitingPayload } = require('./format');
const {
  LABEL_BY_KEY,
  CATEGORY_LABELS_BY_TAB,
  sessions,
  runQueued,
  clearAwaitingTimeout,
  scheduleAwaitTimeout,
} = require('./sessionState');

// Xử lý 1 ảnh: gọi Gemini Vision theo đúng cột của tab đang chờ, merge kết
// quả vào session.tabs[tab] (khoá theo tên đã chuẩn hoá — mục 8 spec: ghép
// theo tên, không theo vị trí dòng, vì thứ hạng hiển thị khác nhau giữa các
// ảnh/tab). Trả về { ok, count } hoặc { ok:false, reason }.
async function processImage(session, tab, attachment) {
  let buffer;
  const mimeType = attachment.contentType || 'image/png';
  try {
    const response = await fetch(attachment.url);
    buffer = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    console.error('Không tải được ảnh /bcstat từ Discord:', error.message);
    return { ok: false, reason: 'download' };
  }

  let result;
  let resolvedTab = tab;
  if (tab === AUTO_BUTTON_ID) {
    // Chế độ tự nhận diện — chưa biết tab, để Gemini tự đọc rồi trả về
    // kèm tab_name; validate + gán categoryKeys theo ĐÚNG tab đọc được.
    result = await analyzeBcStatScreenshotAuto(buffer, mimeType, CATEGORY_LABELS_BY_TAB);
    if (!result.ok) return result;
    const data = result.data || {};
    if (!data.is_valid_screenshot || !TAB_NAMES.includes(data.tab_name)) {
      return { ok: false, reason: 'invalid' };
    }
    resolvedTab = data.tab_name;
  } else {
    const categoryKeys = TAB_CATEGORY_KEYS[tab];
    const categoryLabels = categoryKeys.map((k) => LABEL_BY_KEY[k]);
    result = await analyzeBcStatScreenshot(buffer, mimeType, tab, categoryLabels);
    if (!result.ok) return result;
  }

  const data = result.data || {};
  if (!data.is_valid_screenshot || !Array.isArray(data.players) || !data.players.length) {
    return { ok: false, reason: 'invalid' };
  }

  const categoryKeys = TAB_CATEGORY_KEYS[resolvedTab];
  if (!session.tabs[resolvedTab]) session.tabs[resolvedTab] = new Map();
  const map = session.tabs[resolvedTab];

  data.players.forEach((p) => {
    const name = (p.name || '').trim();
    if (!name) return;
    const key = normalizeName(name);
    const values = {};
    categoryKeys.forEach((catKey, idx) => {
      values[catKey] = Number.isFinite(p.values[idx]) ? p.values[idx] : 0;
    });
    map.set(key, { displayName: name, values });
  });

  return { ok: true, count: data.players.length, resolvedTab };
}

// Submit modal "📤 Chọn ảnh" -> xử lý TỪNG file đã chọn (giống hệt luồng xử
// lý nhiều ảnh gửi liên tiếp trong kênh ở MessageCreate bên dưới), rồi cập
// nhật lại màn hình chờ (controlInteraction) để người dùng thấy ngay số
// người vừa đọc được. Có thể bấm lại nút "📤 Chọn ảnh" nhiều lần (mở modal
// lại) để bổ sung thêm ảnh cho cùng 1 tab trước khi bấm "Xong tab này".
async function handleUploadModalSubmit(interaction, tab) {
  const userId = interaction.user.id;
  const session = sessions.get(userId);
  if (!session) {
    await interaction.reply({ content: '❌ Phiên đã hết hạn — hãy chạy lại `/bcstat`.', ephemeral: true });
    return;
  }

  // FileUploadBuilder đã setRequired(true)+setMinValues(1) nên Discord tự
  // chặn submit rỗng, nhưng vẫn kiểm tra lại cho chắc.
  const files = interaction.fields.getUploadedFiles(UPLOAD_FILE_FIELD_ID);
  const attachments = files ? [...files.values()] : [];
  if (!attachments.length) {
    await interaction.reply({ content: '❌ Bạn chưa chọn ảnh nào, vui lòng bấm nút và thử lại.', ephemeral: true });
    return;
  }

  // Đọc nhiều ảnh bằng Gemini Vision mất hơn 3 giây -> defer ngay LUÔN, kể
  // cả khi phải xếp hàng chờ batch trước xử lý xong — token phản hồi của
  // modal vẫn dùng editReply được trong ~15 phút sau defer, đủ thời gian
  // chờ hàng đợi (xem sessionState.js::runQueued()).
  await interaction.deferReply({ ephemeral: true });

  const job = async () => {
    let totalOk = 0;
    let failCount = 0;
    const batchCounts = {};
    for (const attachment of attachments) {
      const result = await processImage(session, tab, attachment);
      if (result.ok) {
        totalOk += result.count;
        const t = result.resolvedTab || tab;
        batchCounts[t] = (batchCounts[t] || 0) + result.count;
      } else {
        failCount += 1;
      }
    }

    const tabSummary = Object.entries(batchCounts)
      .map(([t, c]) => `${t}: +${c} người`)
      .join(' | ');
    const confirmLines = [
      tabSummary
        ? `✅ Đã đọc xong ${attachments.length} ảnh vừa chọn — ${tabSummary}`
        : '❌ Không đọc được người chơi nào từ các ảnh vừa chọn',
    ];
    let note = '';
    if (failCount) {
      note = totalOk
        ? '⚠️ Có ảnh không đọc được (không hợp lệ hoặc lỗi hệ thống) — các ảnh đọc được vẫn đã ghi nhận.'
        : '❌ Không đọc được ảnh vừa chọn (không hợp lệ hoặc lỗi hệ thống), vui lòng thử chọn lại ảnh rõ hơn.';
      confirmLines.push(`⚠️ ${failCount}/${attachments.length} ảnh không đọc được (bỏ qua).`);
    }

    try {
      await interaction.editReply({ content: confirmLines.join('\n') });
    } catch (error) {
      console.error('Không gửi được xác nhận sau khi đọc ảnh (modal) /bcstat:', error.message);
    }

    // Đặt lại đồng hồ chờ ảnh + cập nhật lại màn hình chờ gốc, giống hệt
    // luồng gửi ảnh trực tiếp trong kênh ở MessageCreate bên dưới. Đọc lại
    // session MỚI NHẤT vì job này có thể đã nằm chờ trong hàng đợi 1 lúc.
    const latestSession = sessions.get(userId);
    if (latestSession && latestSession.awaiting && latestSession.awaiting.tab === tab) {
      clearAwaitingTimeout(latestSession);
      latestSession.awaiting.timeoutHandle = scheduleAwaitTimeout(userId);
      try {
        await latestSession.awaiting.controlInteraction.editReply(buildWaitingPayload(latestSession, tab, note));
      } catch (error) {
        console.error('Không cập nhật được màn hình chờ ảnh sau khi chọn ảnh (modal) /bcstat:', error.message);
      }
    }
  };

  const { queued } = await runQueued(userId, job);
  if (queued) {
    // Chỉ báo trạng thái xếp hàng — kết quả đọc ảnh thật sự sẽ được
    // editReply LẠI đúng interaction này (vẫn dùng được vì đã defer ở
    // trên) ngay khi tới lượt xử lý, không cần người dùng làm gì thêm.
    try {
      await interaction.editReply({
        content: `⏳ Bot đang bận đọc 1 loạt ảnh khác của bạn — đã xếp hàng ${attachments.length} ảnh vừa chọn, sẽ tự xử lý ngay khi xong, không cần gửi lại.`,
      });
    } catch (error) {
      console.error('Không báo được trạng thái xếp hàng (modal) /bcstat:', error.message);
    }
  }
}

async function handleImageMessage(message) {
  try {
    if (message.author.bot) return;
    const session = sessions.get(message.author.id);
    if (!session || !session.awaiting) return;
    if (message.channelId !== session.awaiting.channelId) return;

    const images = [...message.attachments.values()].filter((a) => (a.contentType || '').startsWith('image/'));
    if (!images.length) return; // không đụng vào chat bình thường (không phải ảnh)

    const userId = message.author.id;
    // Chụp nhanh tab/controlInteraction NGAY LÚC ảnh được gửi (không đọc lại
    // lúc job thực sự chạy) — nếu batch này phải xếp hàng chờ vì bot đang
    // bận đọc batch trước, vẫn xử lý ĐÚNG theo tab đang chờ lúc gửi, kể cả
    // khi giữa lúc chờ người dùng đã bấm "Xong tab này" đổi màn hình khác.
    const { tab, controlInteraction } = session.awaiting;

    const job = async () => {
      let note = '';
      const batchCounts = {};
      let failCount = 0;
      let totalOk = 0;
      let anyFail = false;

      for (const attachment of images) {
        const result = await processImage(session, tab, attachment);
        if (result.ok) {
          totalOk += result.count;
          const t = result.resolvedTab || tab;
          batchCounts[t] = (batchCounts[t] || 0) + result.count;
        } else {
          anyFail = true;
          failCount += 1;
        }
      }

      try {
        await message.react(anyFail && !totalOk ? '❌' : totalOk ? '✅' : '❌');
      } catch (error) {
        // bỏ qua nếu không react được
      }

      if (anyFail) {
        note = totalOk
          ? '⚠️ Có ảnh không đọc được (không hợp lệ hoặc lỗi hệ thống) — các ảnh đọc được vẫn đã ghi nhận.'
          : '❌ Không đọc được ảnh vừa gửi (không hợp lệ hoặc lỗi hệ thống), vui lòng thử gửi lại ảnh rõ hơn.';
      }

      // Đặt lại đồng hồ chờ ảnh — chỉ khi vẫn còn đang chờ ĐÚNG tab này (có
      // thể đã đổi màn hình trong lúc batch này nằm chờ trong hàng đợi).
      // Đọc lại session MỚI NHẤT vì job này có thể vừa nằm chờ 1 lúc.
      const latestSession = sessions.get(userId);
      if (latestSession && latestSession.awaiting && latestSession.awaiting.tab === tab) {
        clearAwaitingTimeout(latestSession);
        latestSession.awaiting.timeoutHandle = scheduleAwaitTimeout(userId);
      }

      // Gửi 1 tin nhắn MỚI ngay dưới ảnh vừa gửi để xác nhận đã đọc xong —
      // tránh việc phải kéo lên tin ephemeral gốc (ở tít trên đầu, chỗ gõ
      // `/bcstat`) mỗi lần muốn biết bot đã đọc đến đâu, nhất là khi gửi
      // nhiều tin/nhiều ảnh liên tiếp (mục người dùng yêu cầu).
      try {
        const tabSummary = Object.entries(batchCounts)
          .map(([t, c]) => `${t}: +${c} người`)
          .join(' | ');
        const confirmLines = [
          tabSummary ? `✅ Đã đọc xong batch này — ${tabSummary}` : '❌ Không đọc được người chơi nào từ batch này',
        ];
        if (failCount) confirmLines.push(`⚠️ ${failCount} ảnh không đọc được (bỏ qua).`);
        await message.reply({ content: confirmLines.join('\n'), allowedMentions: { repliedUser: false } });
      } catch (error) {
        console.error('Không gửi được tin nhắn xác nhận đọc ảnh /bcstat:', error.message);
      }

      try {
        await controlInteraction.editReply(buildWaitingPayload(latestSession || session, tab, note));
      } catch (error) {
        console.error('Không cập nhật được màn hình chờ ảnh /bcstat:', error.message);
      }
    };

    const { queued } = await runQueued(userId, job);
    if (queued) {
      // Chỉ đánh dấu "đã nhận, đang xếp hàng" — batch này sẽ tự được xử lý
      // ngay khi bot đọc xong batch trước, không cần gửi lại ảnh.
      try {
        await message.react('⏳');
      } catch (error) {
        // bỏ qua nếu không react được
      }
    }
  } catch (error) {
    console.error('Lỗi xử lý ảnh /bcstat:', error.message);
  }
}

module.exports = { processImage, handleUploadModalSubmit, handleImageMessage };
