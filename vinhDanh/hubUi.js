// ===== Sảnh Vinh Danh Bang Chiến: nút + popup cập nhật mở từ menu Hub =====
// Tách khỏi index.js.

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, LabelBuilder, FileUploadBuilder } = require('discord.js');
const { isAdmin } = require('./logic');
const { processVinhDanhImages } = require('./imagePipeline');

const VINHDANH_HUB_UPDATE_BUTTON_ID = 'vinhdanh_hub_update';
const VINHDANH_HUB_MODAL_ID = 'vinhdanh_hub_update_modal';
const VINHDANH_HUB_FILE_FIELD_ID = 'vinhdanh_hub_images';

// Payload (KHÔNG kèm ephemeral — hub/index.js tự thêm): chỉ nút mở popup chọn
// 1-2 ảnh cập nhật (không show Sảnh Vinh Danh). Role NPC đã được hub/index.js check
// trước khi gọi; nút + popup bên dưới CHECK LẠI role lần nữa (isAdmin) để
// không ai lách được bằng cách lấy lại customId.
async function buildVinhDanhMenuReply() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(VINHDANH_HUB_UPDATE_BUTTON_ID)
      .setLabel('Cập nhật Vinh Danh')
      .setEmoji('📤')
      .setStyle(ButtonStyle.Primary)
  );
  return {
    content: 'Bấm nút bên dưới rồi chọn 1-2 ảnh khung "Danh hiệu vinh quang" để cập nhật Sảnh Vinh Danh Bang Chiến.',
    components: [row],
  };
}

function buildVinhDanhUpdateModal() {
  const fileUpload = new FileUploadBuilder()
    .setCustomId(VINHDANH_HUB_FILE_FIELD_ID)
    .setRequired(true)
    .setMinValues(1)
    .setMaxValues(2);

  const label = new LabelBuilder()
    .setLabel('Ảnh khung "Danh hiệu vinh quang"')
    .setDescription('Tuần 1 trận: chọn 1 ảnh. Tuần 2 trận: chọn 2 ảnh theo thứ tự Trận 1, Trận 2.')
    .setFileUploadComponent(fileUpload);

  return new ModalBuilder()
    .setCustomId(VINHDANH_HUB_MODAL_ID)
    .setTitle('Cập nhật Vinh Danh Bang Chiến')
    .addLabelComponents(label);
}

async function handleVinhDanhHubButton(interaction) {
  if (!isAdmin(interaction.member)) {
    await interaction.reply({ content: '❌ Chỉ NPC mới được cập nhật Sảnh Vinh Danh Bang Chiến.', ephemeral: true });
    return;
  }
  try {
    await interaction.showModal(buildVinhDanhUpdateModal());
  } catch (error) {
    console.error('Không mở được popup Cập nhật Vinh Danh (kiểm tra discord.js >=14.24):', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Không mở được form cập nhật (lỗi hệ thống), vui lòng thử lại.', ephemeral: true }).catch(() => {});
    }
  }
}

async function handleVinhDanhHubModalSubmit(interaction) {
  if (!isAdmin(interaction.member)) {
    await interaction.reply({ content: '❌ Chỉ NPC mới được cập nhật Sảnh Vinh Danh Bang Chiến.', ephemeral: true });
    return;
  }

  const files = interaction.fields.getUploadedFiles(VINHDANH_HUB_FILE_FIELD_ID);
  const attachments = files ? [...files.values()] : [];
  if (!attachments.length) {
    await interaction.reply({ content: '❌ Bạn chưa chọn ảnh nào, vui lòng bấm nút và thử lại.', ephemeral: true });
    return;
  }
  if (attachments.length > 2) {
    await interaction.reply({ content: '❌ 1 lần cập nhật chỉ nhận tối đa 2 ảnh (1 tuần tối đa 2 trận).', ephemeral: true });
    return;
  }
  if (attachments.some((a) => !(a.contentType || '').startsWith('image/'))) {
    await interaction.reply({ content: '❌ File đính kèm phải là ảnh.', ephemeral: true });
    return;
  }

  // Gemini Vision + ghi sheet mất hơn 3 giây -> defer ngay.
  await interaction.deferReply({ ephemeral: true });
  let resultText;
  try {
    resultText = (await processVinhDanhImages(attachments)).message;
  } catch (error) {
    console.error('Lỗi xử lý ảnh Vinh Danh Bang Chiến (popup Hub):', error.message);
    resultText = '❌ Có lỗi xảy ra khi xử lý ảnh, vui lòng thử lại sau.';
  }
  await interaction.editReply({ content: resultText });
}

module.exports = {
  VINHDANH_HUB_UPDATE_BUTTON_ID,
  VINHDANH_HUB_MODAL_ID,
  buildVinhDanhMenuReply,
  handleVinhDanhHubButton,
  handleVinhDanhHubModalSubmit,
};
