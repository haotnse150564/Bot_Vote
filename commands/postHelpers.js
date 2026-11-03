// Logic dùng chung cho /postscrim1 /postscrim2 /postbc (+ nm! tương ứng) và
// /rpostscrim1 /rpostscrim2 /rpostbc (+ nm! tương ứng).
//
// Gộp 2 việc trước đây phải chạy 2 lệnh riêng (nm!uploadscrim1/2/BC để gửi
// ảnh, nm!wherescrim1/2/BC để gửi nút xem vị trí) thành 1 tin nhắn duy nhất:
// caption + ảnh đính kèm + embed/nút "Xem Vị Trí Của Bạn".
//
// Dùng chung giữa commands/slashCommands.js và commands/messageCommands.js
// để không lặp code, tránh 2 nơi lệch nhau khi sửa logic sau này.
const client = require('../client');
const { scrimData, srcImageData } = require('../state');
const { saveState } = require('../googleSheets/stateSheet');
const { getStagedImage } = require('../uploadImage/stagedImages');
const { SRC_IMAGE_LABELS, formatSrcImageMessage } = require('../uploadImage/format');
const { buildWhereActionRow, buildWhereEmbed, getWhereDayLabel } = require('../where/ui');
const { AttachmentBuilder } = require('discord.js');

// key: 'scrim1' | 'scrim2' | 'bc' — dựng lại TOÀN BỘ payload (ảnh mới nhất +
// caption + embed/nút where) từ dữ liệu hiện tại. mentionRoleId (tùy chọn):
// Discord Role ID cần mention đầu tin — có thì chèn <@&roleId>, không có
// thì bỏ qua. customCaption (tùy chọn): nếu người dùng đã sửa tay nội dung
// tin ở khung xem trước bên web (ô textarea "Nội dung tin nhắn") thì dùng
// ĐÚNG nội dung đó thay vì tự sinh lại bằng formatSrcImageMessage() — xem
// POST /admin/srcimage/post và /admin/srcimage/update (admin/api.js).
async function buildPostPayload(key, mentionRoleId, customCaption) {
  // Ảnh lấy từ bản PNG NPC vừa xuất bên trang Đội hình (nút "Xuất PNG" trên
  // team.html) và gửi lên qua POST /admin/srcimage/stage — KHÔNG còn tự
  // chụp lại Google Sheet như trước (NMTeam không còn dùng Sheet để xếp đội
  // hình nữa). Xem uploadImage/stagedImages.js.
  const staged = getStagedImage(key);
  if (!staged) {
    const label = SRC_IMAGE_LABELS[key] || key;
    throw new Error(`Chưa có ảnh nào được xuất cho ${label} — vào trang Đội hình, chọn đúng đội hình rồi bấm "Xuất PNG" trước khi đăng.`);
  }
  const pngBuffer = staged.buffer;
  const attachment = new AttachmentBuilder(pngBuffer, { name: `${key}.png` });
  const label = SRC_IMAGE_LABELS[key] || key;
  const dayLabel = getWhereDayLabel(key, scrimData);
  const mentionPrefix = mentionRoleId ? `<@&${mentionRoleId}>\n` : '';
  // customCaption có thể là chuỗi rỗng (người dùng xoá hết chữ trong ô sửa)
  // — vẫn phải tôn trọng, nên kiểm tra `!= null` (undefined/null mới rơi về
  // tự sinh) thay vì kiểm tra falsy.
  const bodyText = customCaption != null ? customCaption : formatSrcImageMessage(key);

  return {
    content: `${mentionPrefix}${bodyText}`,
    files: [attachment],
    embeds: [buildWhereEmbed(label, dayLabel)],
    components: [buildWhereActionRow(key)],
  };
}

// Gửi 1 tin MỚI (caption + ảnh + nút where) vào `channel`, lưu lại
// messageId/channelId vào srcImageData[key] để lệnh rpost sau này biết tin
// nào cần sửa. mentionRoleId (tùy chọn) — xem buildPostPayload. Trả về
// Message vừa gửi.
async function sendPost(channel, key, mentionRoleId, customCaption) {
  const payload = await buildPostPayload(key, mentionRoleId, customCaption);
  const sentMessage = await channel.send(payload);

  srcImageData[key].messageId = sentMessage.id;
  srcImageData[key].channelId = sentMessage.channelId;
  // Lưu lại role đã tag (nếu có) để updatePost() bên dưới dùng lại đúng tag
  // này mỗi lần sửa tin, thay vì làm mất tag khi cập nhật.
  srcImageData[key].mentionRoleId = mentionRoleId || null;
  await saveState();

  return sentMessage;
}

// Lấy lại ĐÚNG nội dung tin (caption) VÀ link ảnh đang thật sự nằm trên
// Discord của key này — dùng cho khung xem trước lúc bấm "Cập nhật ảnh"
// HOẶC "Cập nhật nội dung" bên web (xem POST /admin/srcimage/preview và
// /admin/srcimage/caption-preview ở admin/api.js), để không làm mất caption
// đã lỡ sửa tay ở lần cập nhật trước (trước đây khung xem trước luôn tự
// sinh lại bằng formatSrcImageMessage(), đè mất phần sửa tay).
// Trả về:
//   { caption, imageUrl } — caption đã bỏ phần "<@&roleId>\n" mention ở đầu
//             (vì mentionPrefix được buildPostPayload() tự chèn lại riêng),
//             imageUrl là link ảnh đính kèm hiện có trên tin (null nếu tin
//             không có ảnh đính kèm nào, hiếm khi xảy ra).
//   null    — chưa từng đăng tin nào (state rỗng) HOẶC fetch tin cũ thất
//             bại (đã bị xoá, sai kênh...) — gọi nơi dùng hàm này tự rơi
//             về formatSrcImageMessage() như cũ (hoặc báo lỗi, xem
//             /admin/srcimage/caption-preview).
async function getPostedMessageInfo(key) {
  const state = srcImageData[key];
  if (!state || !state.messageId || !state.channelId) return null;

  try {
    const channel = await client.channels.fetch(state.channelId);
    const oldMessage = await channel.messages.fetch(state.messageId);
    let content = oldMessage.content || '';
    const mentionPrefix = state.mentionRoleId ? `<@&${state.mentionRoleId}>\n` : '';
    if (mentionPrefix && content.startsWith(mentionPrefix)) {
      content = content.slice(mentionPrefix.length);
    }
    const imageUrl = oldMessage.attachments.size ? oldMessage.attachments.first().url : null;
    return { caption: content, imageUrl };
  } catch (error) {
    return null;
  }
}

// Giữ lại tên hàm cũ (chỉ lấy caption) cho những chỗ đã dùng từ trước —
// tương đương getPostedMessageInfo(key).caption.
async function getPostedCaption(key) {
  const info = await getPostedMessageInfo(key);
  return info ? info.caption : null;
}

// Sửa lại ĐÚNG tin đã gửi bằng post/nm!post trước đó (tra theo
// srcImageData[key]) — làm mới ảnh + caption + embed/nút where trên tin cũ
// thay vì gửi tin mới. Tự dùng lại ĐÚNG mentionRoleId đã lưu lúc đăng tin
// (nếu lúc đăng có tick tag role) để tag không bị mất khi edit — Discord
// không gửi lại thông báo ping khi sửa tin cũ nên việc giữ tag ở đây an
// toàn, không gây spam ping ai thêm lần nữa. Trả về:
//   { ok: true, message }                     — thành công
//   { ok: false, reason: 'not_found' }         — chưa từng post lần nào
//   { ok: false, reason: 'fetch_failed', error } — tin cũ không fetch được
//                                                  nữa (đã bị xóa, sai kênh...)
async function updatePost(key, customCaption) {
  const state = srcImageData[key];

  if (!state.messageId || !state.channelId) {
    return { ok: false, reason: 'not_found' };
  }

  let oldMessage;
  try {
    const channel = await client.channels.fetch(state.channelId);
    oldMessage = await channel.messages.fetch(state.messageId);
  } catch (error) {
    return { ok: false, reason: 'fetch_failed', error };
  }

  const payload = await buildPostPayload(key, state.mentionRoleId || null, customCaption);
  // `attachments: []` xóa hết ảnh CŨ trước khi đính ảnh mới vào — thiếu dòng
  // này Discord sẽ GIỮ ảnh cũ và cộng dồn thêm ảnh mới thay vì thay thế.
  const editedMessage = await oldMessage.edit({ ...payload, attachments: [] });

  // messageId/channelId không đổi (edit tin cũ, không phải gửi mới) nhưng
  // vẫn saveState() để đồng bộ giờ lỡ có gì khác thay đổi trong srcImageData.
  await saveState();

  return { ok: true, message: editedMessage };
}

// Sửa CHỈ nội dung tin (caption) — GIỮ NGUYÊN ảnh/embed/nút where đang có,
// KHÔNG chụp lại bảng, KHÔNG cần ảnh đã stage. Dùng cho nút "Cập nhật nội
// dung" bên web (tách riêng khỏi "Cập nhật ảnh" — xem
// POST /admin/srcimage/update-caption ở admin/api.js), cho các trường hợp
// chỉ cần sửa chữ (vd gõ nhầm) mà không muốn/không cần chụp lại ảnh mới,
// và KHÔNG kéo theo việc đồng bộ Vị Trí/báo DM đổi vị trí (vì nội dung tin
// không phản ánh trạng thái bảng, không có gì để so sánh đổi chỗ).
// Trả về cùng dạng với updatePost() ở trên (ok/not_found/fetch_failed).
async function updateCaptionOnly(key, customCaption) {
  const state = srcImageData[key];

  if (!state.messageId || !state.channelId) {
    return { ok: false, reason: 'not_found' };
  }

  let oldMessage;
  try {
    const channel = await client.channels.fetch(state.channelId);
    oldMessage = await channel.messages.fetch(state.messageId);
  } catch (error) {
    return { ok: false, reason: 'fetch_failed', error };
  }

  const mentionPrefix = state.mentionRoleId ? `<@&${state.mentionRoleId}>\n` : '';
  const bodyText = customCaption != null ? customCaption : formatSrcImageMessage(key);
  // CHỈ truyền `content` — KHÔNG kèm `files`/`attachments`/`embeds`/
  // `components` nên Discord tự giữ nguyên ảnh/embed/nút where cũ, khác
  // hẳn updatePost() ở trên (luôn dựng lại toàn bộ payload + xoá/đính lại
  // ảnh mới).
  const editedMessage = await oldMessage.edit({ content: `${mentionPrefix}${bodyText}` });

  return { ok: true, message: editedMessage };
}

module.exports = { buildPostPayload, sendPost, updatePost, updateCaptionOnly, getPostedCaption, getPostedMessageInfo };