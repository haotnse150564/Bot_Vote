// ===== Slash: ảnh Đội Hình / bài đăng =====
// /uploadscrim1-2, /uploadbc, /usi1-2, /ubci, /postscrim1-2, /postbc, /rpostscrim1-2, /rpostbc.

const { AttachmentBuilder } = require('discord.js');
const { srcImageData } = require('../state');
const { NPC_ROLE_ID } = require('../config');
const { saveState } = require('../googleSheets/stateSheet');
const { sendPost, updatePost } = require('./postHelpers');
const { getStagedImage } = require('../uploadImage/stagedImages');
const { SRC_IMAGE_LABELS, formatSrcImageMessage } = require('../uploadImage/format');

async function sendNewSrcImageSlash(interaction, key) {
  if (!interaction.member.roles.cache.has(NPC_ROLE_ID)) {
    await interaction.reply({ content: '❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.', ephemeral: true });
    return;
  }

  const label = SRC_IMAGE_LABELS[key] || key;
  await interaction.deferReply({ ephemeral: true });

  try {
    // Ảnh lấy từ bản PNG NPC đã xuất bên trang Đội hình ("Xuất PNG" trên
    // team.html) — KHÔNG còn tự chụp lại Google Sheet như trước. Xem
    // uploadImage/stagedImages.js.
    const staged = getStagedImage(key);
    if (!staged) {
      await interaction.editReply(`❌ Chưa có ảnh nào được xuất cho ${label} — vào trang Đội hình, chọn đúng đội hình rồi bấm "Xuất PNG" trước.`);
      return;
    }
    const attachment = new AttachmentBuilder(staged.buffer, { name: `${key}.png` });
    const textContent = formatSrcImageMessage(key);

    const sentMessage = await interaction.channel.send({ content: textContent, files: [attachment] });
    srcImageData[key].messageId = sentMessage.id;
    srcImageData[key].channelId = sentMessage.channelId;
    await saveState();

    await interaction.editReply(`✅ Đã tải ảnh mới cho ${label}.`);
  } catch (error) {
    console.error(`Failed to send src image (${key}) via slash command:`, error.message);
    await interaction.editReply(`❌ Lỗi khi lấy ảnh ${label}: ${error.message}`);
  }
}

// commandName dạng 'postscrim1' | 'postscrim2' | 'postbc' -> key 'scrim1' | 'scrim2' | 'bc'
async function sendPostSlash(interaction, key) {
  if (!interaction.member.roles.cache.has(NPC_ROLE_ID)) {
    await interaction.reply({ content: '❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.', ephemeral: true });
    return;
  }

  const label = SRC_IMAGE_LABELS[key] || key;
  // Ô nhập "mention" là tùy chọn — có chọn role thì mention role đó kèm
  // tin đăng, không chọn thì bỏ qua như bình thường.
  const mentionRole = interaction.options.getRole('mention');
  await interaction.deferReply({ ephemeral: true });

  try {
    await sendPost(interaction.channel, key, mentionRole ? mentionRole.id : null);
    await interaction.editReply(`✅ Đã đăng tin ${label} (ảnh + nút xem vị trí).`);
  } catch (error) {
    console.error(`Failed to post ${key} via slash command:`, error.message);
    await interaction.editReply(`❌ Lỗi khi đăng tin ${label}: ${error.message}`);
  }
}

// commandName dạng 'rpostscrim1' | 'rpostscrim2' | 'rpostbc' -> key 'scrim1' | 'scrim2' | 'bc'
async function updatePostSlash(interaction, key) {
  if (!interaction.member.roles.cache.has(NPC_ROLE_ID)) {
    await interaction.reply({ content: '❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.', ephemeral: true });
    return;
  }

  const label = SRC_IMAGE_LABELS[key] || key;
  await interaction.deferReply({ ephemeral: true });

  const result = await updatePost(key).catch((error) => ({ ok: false, reason: 'error', error }));

  if (result.ok) {
    await interaction.editReply(`✅ Đã cập nhật lại tin ${label} (ảnh + nội dung mới nhất).`);
    return;
  }

  if (result.reason === 'not_found') {
    await interaction.editReply(`❌ Chưa có tin ${label} nào được đăng bằng \`/post${key}\`. Hãy đăng trước rồi mới rpost.`);
    return;
  }

  console.error(`Failed to rpost ${key} via slash command:`, result.error?.message);
  await interaction.editReply(`❌ Không tìm thấy tin ${label} cũ để sửa (có thể đã bị xóa). Hãy chạy \`/post${key}\` lại.`);
}
// Trả về true nếu interaction đã được xử lý ở nhóm lệnh này (tương ứng `return;` trong listener gốc).
async function handleSrcImageSlashCommands(interaction, commandName) {
    if (commandName === 'uploadscrim1') {
      await sendNewSrcImageSlash(interaction, 'scrim1');
      return true;
    }

    if (commandName === 'uploadscrim2') {
      await sendNewSrcImageSlash(interaction, 'scrim2');
      return true;
    }

    if (commandName === 'uploadbc') {
      await sendNewSrcImageSlash(interaction, 'bc');
      return true;
    }

    if (commandName === 'usi1') {
      await sendNewSrcImageSlash(interaction, 'scrim1');
      return true;
    }

    if (commandName === 'usi2') {
      await sendNewSrcImageSlash(interaction, 'scrim2');
      return true;
    }

    if (commandName === 'ubci') {
      await sendNewSrcImageSlash(interaction, 'bc');
      return true;
    }

    if (commandName === 'postscrim1') {
      await sendPostSlash(interaction, 'scrim1');
      return true;
    }

    if (commandName === 'postscrim2') {
      await sendPostSlash(interaction, 'scrim2');
      return true;
    }

    if (commandName === 'postbc') {
      await sendPostSlash(interaction, 'bc');
      return true;
    }

    if (commandName === 'rpostscrim1') {
      await updatePostSlash(interaction, 'scrim1');
      return true;
    }

    if (commandName === 'rpostscrim2') {
      await updatePostSlash(interaction, 'scrim2');
      return true;
    }

    if (commandName === 'rpostbc') {
      await updatePostSlash(interaction, 'bc');
      return true;
    }

  return false;
}

module.exports = {
  handleSrcImageSlashCommands,
};
