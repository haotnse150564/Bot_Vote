// Hub — dựng UI tin menu cố định (embed + 3 nút) trong kênh HUB_CHANNEL_ID.
// Logic xử lý nằm ở hub/index.js.

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// customId của các nút tính năng — hub/index.js xử lý theo đúng các giá trị này.
const HUB_BUTTON_RANK = 'hub:rank';
const HUB_BUTTON_VINH_DANH = 'hub:vinh_danh';
const HUB_BUTTON_BCSTAT = 'hub:bcstat';
const HUB_BUTTON_IDS = [HUB_BUTTON_RANK, HUB_BUTTON_VINH_DANH, HUB_BUTTON_BCSTAT];

function buildHubMessage() {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🏯 Menu Tính Năng Bang')
    .setDescription(
      'Bấm nút tính năng bạn cần — bot trả lời **riêng tư** ngay tại đây (chỉ mình bạn thấy).\n\n' +
        '⚔️ **Đua Rank Thí Kiếm** — gửi ảnh Dữ Liệu Mùa Giải để cập nhật điểm, hoặc xem rank của bạn\n' +
        '🏆 **Vinh Danh Bang Chiến** — chọn ảnh cập nhật Sảnh Vinh Danh *(chỉ NPC)*\n' +
        '📊 **BC Stat** — tổng hợp chỉ số Bang Chiến từ ảnh *(chỉ NPC)*'
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(HUB_BUTTON_RANK).setLabel('Đua Rank Thí Kiếm').setEmoji('⚔️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(HUB_BUTTON_VINH_DANH).setLabel('Vinh Danh Bang Chiến').setEmoji('🏆').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(HUB_BUTTON_BCSTAT).setLabel('BC Stat').setEmoji('📊').setStyle(ButtonStyle.Primary)
  );

  return { embeds: [embed], components: [row] };
}

module.exports = {
  HUB_BUTTON_IDS,
  HUB_BUTTON_RANK,
  HUB_BUTTON_VINH_DANH,
  HUB_BUTTON_BCSTAT,
  buildHubMessage,
};
