// ===== Thí Kiếm: định nghĩa slash command =====
// Tách khỏi index.js.

const { SlashCommandBuilder } = require('discord.js');

const THIKIEM_SLASH_COMMANDS = [
  new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Xem rank Thí Kiếm Thiên Hạ của bạn hoặc người khác')
    .addUserOption((opt) => opt.setName('user').setDescription('Người cần xem (bỏ trống = xem của bạn)').setRequired(false)),
  new SlashCommandBuilder()
    .setName('set-mua-giai')
    .setDescription('[NPC] Cập nhật cấu hình Mùa Giải Đua Rank Thí Kiếm')
    .addStringOption((opt) => opt.setName('ten').setDescription('Tên mùa giải (nhớ gõ kèm S1/S2... vì có thể trùng tên chính khác Session)').setRequired(false))
    .addStringOption((opt) => opt.setName('ngay-bat-dau').setDescription('Ngày bắt đầu (DD/MM/YYYY)').setRequired(false))
    .addStringOption((opt) => opt.setName('ngay-ket-thuc').setDescription('Ngày kết thúc (DD/MM/YYYY)').setRequired(false)),
  new SlashCommandBuilder()
    .setName('xoa-diem-thi-kiem')
    .setDescription('[NPC] Xoá dữ liệu điểm Thí Kiếm của 1 Discord ID')
    .addStringOption((opt) => opt.setName('discord-id').setDescription('Discord ID cần xoá').setRequired(true)),
  new SlashCommandBuilder()
    .setName('xem-bang-xep-hang-thi-kiem')
    .setDescription('Đăng lại bảng xếp hạng Đua Rank Thí Kiếm mới nhất (không cần đợi có update mới)'),
].map((cmd) => cmd.toJSON());

module.exports = { THIKIEM_SLASH_COMMANDS };
