// ===== Lệnh nm!: ảnh Đội Hình / bài đăng / where =====
// nm!uploadscrim1-2, nm!uploadbc, nm!usi1-2, nm!ubci, nm!postscrim1-2, nm!postbc,
// nm!rpostscrim1-2, nm!rpostbc và nm!wherebc / wherescrim1 / wherescrim2.

const { AttachmentBuilder } = require('discord.js');
const { scrimData, srcImageData } = require('../state');
const { NPC_ROLE_ID, WHERE_LOCATION_LABELS } = require('../config');
const { saveState } = require('../googleSheets/stateSheet');
const { sendPost, updatePost } = require('./postHelpers');
const { getStagedImage } = require('../uploadImage/stagedImages');
const { SRC_IMAGE_LABELS, formatSrcImageMessage } = require('../uploadImage/format');
const { buildWhereActionRow, buildWhereEmbed, getWhereDayLabel } = require('../where/ui');
const { extractPostText } = require('./messageHelpers');

async function sendNewSrcImage(message, key) {
  if (!message.member || !message.member.roles.cache.has(NPC_ROLE_ID)) {
    message.reply('❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.');
    return;
  }

  const label = SRC_IMAGE_LABELS[key] || key;

  // Ảnh lấy từ bản PNG NPC đã xuất bên trang Đội hình ("Xuất PNG" trên
  // team.html) — KHÔNG còn tự chụp lại Google Sheet như trước. Xem
  // uploadImage/stagedImages.js.
  const staged = getStagedImage(key);
  if (!staged) {
    message.reply(`❌ Chưa có ảnh nào được xuất cho ${label} — vào trang Đội hình, chọn đúng đội hình rồi bấm "Xuất PNG" trước.`);
    return;
  }

  try {
    const attachment = new AttachmentBuilder(staged.buffer, { name: `${key}.png` });
    const textContent = formatSrcImageMessage(key);

    const sentMessage = await message.channel.send({ content: textContent, files: [attachment] });
    srcImageData[key].messageId = sentMessage.id;
    srcImageData[key].channelId = sentMessage.channelId;
    await saveState();
  } catch (error) {
    console.error(`Failed to send src image (${key}):`, error.message);
    message.reply(`❌ Lỗi khi lấy ảnh ${label}: ${error.message}`).catch(() => {});
  }
}

// key: 'scrim1' | 'scrim2' | 'bc' — dùng cho nm!postscrim1 / nm!postscrim2 / nm!postbc
// Cú pháp: "nm!postscrim1 <nội dung>" (có thể kèm 1 role mention ở bất kỳ vị
// trí nào trong câu, vd "nm!postscrim1 @Scrim Đội hình tối nay") — role mention
// (nếu có) được tách riêng để @ đầu tin, còn lại là caption. `text`: phần nội
// dung do NGƯỜI DÙNG tự nhập ngay sau lệnh — BẮT BUỘC, không còn tự động lấy
// từ formatSrcImageMessage() nữa (giống hệt tinh thần slash command).
async function sendPostMessage(message, key, text) {
  if (!message.member || !message.member.roles.cache.has(NPC_ROLE_ID)) {
    message.reply('❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.');
    return;
  }

  if (!text) {
    message.reply(`❌ Thiếu nội dung. Dùng: \`nm!post${key} <nội dung>\` (có thể kèm @role bất kỳ vị trí nào).`);
    return;
  }

  const label = SRC_IMAGE_LABELS[key] || key;
  const mentionRole = message.mentions.roles.first();
  const loadingMsg = await message.channel.send(`⏳ Đang đăng tin ${label}...`);

  try {
    await sendPost(message.channel, key, mentionRole ? mentionRole.id : null, text);
    await loadingMsg.delete().catch(() => {});
  } catch (error) {
    console.error(`Failed to post ${key}:`, error.message);
    await loadingMsg.edit(`❌ Lỗi khi đăng tin ${label}: ${error.message}`).catch(() => {});
  }
}

// key: 'scrim1' | 'scrim2' | 'bc' — dùng cho nm!rpostscrim1 / nm!rpostscrim2 / nm!rpostbc
// Cú pháp: "nm!rpostscrim1 <nội dung mới>". `text`: nội dung caption MỚI do
// người dùng tự nhập lại mỗi lần rpost — BẮT BUỘC (không tự dựng lại caption
// cũ nữa).
async function updatePostMessage(message, key, text) {
  if (!message.member || !message.member.roles.cache.has(NPC_ROLE_ID)) {
    message.reply('❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.');
    return;
  }

  if (!text) {
    message.reply(`❌ Thiếu nội dung. Dùng: \`nm!rpost${key} <nội dung mới>\`.`);
    return;
  }

  const label = SRC_IMAGE_LABELS[key] || key;
  const loadingMsg = await message.channel.send(`⏳ Đang cập nhật tin ${label}...`);

  const result = await updatePost(key, text).catch((error) => ({ ok: false, reason: 'error', error }));

  if (result.ok) {
    await loadingMsg.edit(`✅ Đã cập nhật lại tin ${label}.`).catch(() => {});
    setTimeout(() => loadingMsg.delete().catch(() => {}), 5000);
    return;
  }

  if (result.reason === 'not_found') {
    await loadingMsg.edit(`❌ Chưa có tin ${label} nào được đăng bằng \`nm!post${key}\`. Hãy đăng trước rồi mới rpost.`).catch(() => {});
    return;
  }

  console.error(`Failed to rpost ${key}:`, result.error?.message);
  await loadingMsg.edit(`❌ Không tìm thấy tin ${label} cũ để sửa (có thể đã bị xóa). Hãy chạy \`nm!post${key}\` lại.`).catch(() => {});
}
// Trả về true nếu tin nhắn đã được xử lý ở nhóm lệnh này (tương ứng `return;` trong listener gốc).
async function handleSrcImageMessageCommands(message, content) {
  if (content.toLowerCase() === 'nm!uploadscrim1') {
    await sendNewSrcImage(message, 'scrim1');
    return true;
  }

  if (content.toLowerCase() === 'nm!uploadscrim2') {
    await sendNewSrcImage(message, 'scrim2');
    return true;
  }

  if (content.toLowerCase() === 'nm!uploadbc') {
    await sendNewSrcImage(message, 'bc');
    return true;
  }

  if (content.toLowerCase() === 'nm!usi1') {
    await sendNewSrcImage(message, 'scrim1');
    return true;
  }

  if (content.toLowerCase() === 'nm!usi2') {
    await sendNewSrcImage(message, 'scrim2');
    return true;
  }

  if (content.toLowerCase() === 'nm!ubci') {
    await sendNewSrcImage(message, 'bc');
    return true;
  }

  if (content.toLowerCase().startsWith('nm!postscrim1')) {
    await sendPostMessage(message, 'scrim1', extractPostText(content, 'nm!postscrim1'));
    return true;
  }

  if (content.toLowerCase().startsWith('nm!postscrim2')) {
    await sendPostMessage(message, 'scrim2', extractPostText(content, 'nm!postscrim2'));
    return true;
  }

  if (content.toLowerCase().startsWith('nm!postbc')) {
    await sendPostMessage(message, 'bc', extractPostText(content, 'nm!postbc'));
    return true;
  }

  if (content.toLowerCase().startsWith('nm!rpostscrim1')) {
    await updatePostMessage(message, 'scrim1', extractPostText(content, 'nm!rpostscrim1'));
    return true;
  }

  if (content.toLowerCase().startsWith('nm!rpostscrim2')) {
    await updatePostMessage(message, 'scrim2', extractPostText(content, 'nm!rpostscrim2'));
    return true;
  }

  if (content.toLowerCase().startsWith('nm!rpostbc')) {
    await updatePostMessage(message, 'bc', extractPostText(content, 'nm!rpostbc'));
    return true;
  }

  if (
    content.toLowerCase() === 'nm!wherebc' ||
    content.toLowerCase() === 'nm!wherescrim1' ||
    content.toLowerCase() === 'nm!wherescrim2'
  ) {
    if (!message.member || !message.member.roles.cache.has(NPC_ROLE_ID)) {
      message.reply('❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.');
      return true;
    }

    const key = content.toLowerCase().replace('nm!where', ''); // 'bc' | 'scrim1' | 'scrim2'
    const label = WHERE_LOCATION_LABELS[key] || key;
    const dayLabel = getWhereDayLabel(key, scrimData);

    await message.channel.send({
      embeds: [buildWhereEmbed(label, dayLabel)],
      components: [buildWhereActionRow(key)],
    });

    await message.delete().catch(err => console.error('Failed to delete command message:', err.message));
    return true;
  }

  return false;
}

module.exports = {
  handleSrcImageMessageCommands,
};
