// ===== Thí Kiếm: lệnh slash dành cho NPC (set mùa giải / xoá điểm / đăng lại bảng) =====
// Tách khỏi index.js.

const { setSeasonConfigValues, deleteRankRow } = require('../googleSheets/thiKiemSheet');
const { rankSheetMutex, isAdmin } = require('./sharedState');
const { refreshLeaderboardMessage } = require('./board');

async function handleSetMuaGiai(interaction) {
  if (!isAdmin(interaction.member)) {
    await interaction.reply({ content: '❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.', ephemeral: true });
    return;
  }

  const ten = interaction.options.getString('ten');
  const ngayBatDau = interaction.options.getString('ngay-bat-dau');
  const ngayKetThuc = interaction.options.getString('ngay-ket-thuc');

  const updates = {};
  if (ten) updates.ten_mua_giai = ten;
  if (ngayBatDau) updates.ngay_bat_dau = ngayBatDau;
  if (ngayKetThuc) updates.ngay_ket_thuc = ngayKetThuc;

  if (!Object.keys(updates).length) {
    await interaction.reply({ content: '❌ Cần điền ít nhất 1 trong 3 field: ten / ngay-bat-dau / ngay-ket-thuc.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  await setSeasonConfigValues(updates);
  await refreshLeaderboardMessage();
  await interaction.editReply({ content: '✅ Đã cập nhật cấu hình Mùa Giải Thí Kiếm.' });
}

async function handleXoaDiem(interaction) {
  if (!isAdmin(interaction.member)) {
    await interaction.reply({ content: '❌ Bạn không có quyền sử dụng lệnh này. Cần role NPC.', ephemeral: true });
    return;
  }

  const discordId = interaction.options.getString('discord-id', true).trim();
  await interaction.deferReply({ ephemeral: true });
  const removed = await rankSheetMutex.runExclusive(() => deleteRankRow(discordId));
  if (!removed) {
    await interaction.editReply({ content: `⚠️ Không tìm thấy dữ liệu điểm của ID \`${discordId}\`.` });
    return;
  }
  await refreshLeaderboardMessage();
  await interaction.editReply({ content: `✅ Đã xoá dữ liệu điểm của ID \`${discordId}\`.` });
}

async function handleXemBangXepHang(interaction) {
  await interaction.deferReply({ ephemeral: true });
  await refreshLeaderboardMessage();
  await interaction.editReply({ content: '✅ Đã đăng lại bảng xếp hạng mới nhất.' });
}

module.exports = { handleSetMuaGiai, handleXoaDiem, handleXemBangXepHang };
