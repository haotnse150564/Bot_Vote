// ===== Sảnh Vinh Danh Bang Chiến: xử lý 1-2 ảnh gửi lên =====
// Tách khỏi index.js.

const { appendVinhDanhBatch } = require('../googleSheets/vinhDanhSheet');
const { getAllBangMembers } = require('../googleSheets/memberSheet');
const { analyzeVinhDanhScreenshot } = require('./geminiVision');
const { getVnNow } = require('../utils/time');
const { findDiscordIdByIngame, dedupeEntries, syncQuanLongChiChuRole, getMostRecentSaturdayStr } = require('./logic');
const { refreshVinhDanhBoard } = require('./board');

// Xử lý TOÀN BỘ luồng cho 1-2 ảnh gửi cùng lúc (1 tuần 1 hoặc 2 trận). Trả
// về 1 chuỗi kết quả (thành công/lỗi) để phản hồi lại cho NPC.
async function processVinhDanhImages(attachments) {
  const members = await getAllBangMembers();
  const flatEntries = [];
  const errors = [];

  for (let i = 0; i < attachments.length; i += 1) {
    const attachment = attachments[i];
    const tran = attachments.length > 1 ? String(i + 1) : '';

    let buffer;
    try {
      const response = await fetch(attachment.url);
      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } catch (error) {
      errors.push(`❌ Không tải được ảnh ${i + 1}, vui lòng thử lại.`);
      continue;
    }

    const mimeType = attachment.contentType || 'image/png';
    const result = await analyzeVinhDanhScreenshot(buffer, mimeType);

    if (!result.ok) {
      errors.push(
        result.reason === 'quota'
          ? `⚠️ Ảnh ${i + 1}: hệ thống đọc ảnh đang tạm hết quota, thử lại sau ít phút.`
          : `❌ Ảnh ${i + 1}: không đọc được ảnh (lỗi hệ thống), vui lòng gửi lại ảnh rõ hơn.`
      );
      continue;
    }

    const data = result.data || {};
    if (!data.is_valid_screenshot || !Array.isArray(data.entries) || !data.entries.length) {
      errors.push(`❌ Ảnh ${i + 1} không hợp lệ. Vui lòng gửi ảnh có khung "Danh hiệu vinh quang".`);
      continue;
    }

    data.entries.forEach((entry) => {
      const danhHieu = (entry.danh_hieu || '').trim();
      const ingame = entry.ingame ? String(entry.ingame).trim() : '';
      if (!danhHieu) return;
      flatEntries.push({
        danhHieu,
        ingame,
        discordId: findDiscordIdByIngame(members, ingame),
        tran,
      });
    });
  }

  if (!flatEntries.length) {
    return { ok: false, message: errors.length ? errors.join('\n') : '❌ Không đọc được dữ liệu nào từ ảnh.' };
  }

  const deduped = dedupeEntries(flatEntries);
  const ngayVinhDanh = getMostRecentSaturdayStr(getVnNow());

  await appendVinhDanhBatch(ngayVinhDanh, deduped);
  await refreshVinhDanhBoard();

  try {
    await syncQuanLongChiChuRole(deduped);
  } catch (error) {
    console.error('Lỗi đồng bộ role Quần Long Chi Chủ:', error.message);
  }

  const warningSuffix = errors.length ? `\n\n${errors.join('\n')}` : '';
  return {
    ok: true,
    message: `✅ Đã cập nhật Sảnh Vinh Danh Bang Chiến cho tuần ${ngayVinhDanh} (${deduped.length} danh hiệu).${warningSuffix}`,
  };
}

// Gửi kết quả tạm trong kênh rồi tự xoá sau ít giây (giữ tinh thần "kênh
// sạch" như Thí Kiếm) — không DM vì đây là thao tác của NPC ngay trong kênh
// quản lý, không cần riêng tư.
async function sendTemporaryResult(channel, discordId, text) {
  try {
    const notice = await channel.send({ content: `<@${discordId}> ${text}`, allowedMentions: { users: [discordId] } });
    setTimeout(() => {
      notice.delete().catch(() => {});
    }, 15_000);
  } catch (error) {
    console.error('Không gửi được kết quả xử lý ảnh Vinh Danh Bang Chiến:', error.message);
  }
}

// Xoá tin lệnh `nm!vinhdanh` gốc RỒI MỚI trả kết quả — áp dụng cho MỌI
// nhánh (thành công lẫn lỗi) để giữ kênh sạch đúng tinh thần "kênh chỉ có
// tin cố định" của Thí Kiếm (kênh dùng chung). Xoá trước khi trả kết quả
// giống hệt thứ tự thiKiem/index.js đang làm.
async function deleteThenReply(message, text) {
  try {
    await message.delete();
  } catch (error) {
    console.error('Không xoá được tin nhắn nm!vinhdanh gốc:', error.message);
  }
  await sendTemporaryResult(message.channel, message.author.id, text);
}

module.exports = { processVinhDanhImages, sendTemporaryResult, deleteThenReply };
