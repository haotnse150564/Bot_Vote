const { SlashCommandBuilder } = require('discord.js');

const VOICESTATS_SLASH_COMMANDS = [
  new SlashCommandBuilder()
    .setName('voice')
    .setDescription('Xem ai đang ngồi voice Bang Chiến/Scrim và đếm số người'),
  new SlashCommandBuilder()
    .setName('voicestats')
    .setDescription('Thống kê thời gian ngồi voice Bang Chiến/Scrim')
    .addStringOption((opt) =>
      opt
        .setName('khoang')
        .setDescription('Khoảng thời gian (mặc định: 7 ngày)')
        .setRequired(false)
        .addChoices(
          { name: '7 ngày qua', value: 'tuan' },
          { name: '30 ngày qua', value: 'thang' },
          { name: 'Tất cả', value: 'tatca' }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName('loai')
        .setDescription('Lọc theo loại (mặc định: tất cả)')
        .setRequired(false)
        .addChoices(
          { name: 'Bang Chiến', value: 'bc' },
          { name: 'Scrim', value: 'scrim' },
          { name: 'Tất cả', value: 'tatca' }
        )
    ),
  new SlashCommandBuilder().setName('lich').setDescription('Xem lịch Bang sắp tới (Bang Chiến, Scrim, GCMN, Thứ 5, Box)'),
];

module.exports = { VOICESTATS_SLASH_COMMANDS };
