// ===== commands/slashMerged.js — 5 lệnh slash đã GỘP (tiết kiệm slot: Discord tối đa 100 lệnh/server) =====
// Trước đây mỗi lệnh có 3 bản (scrim1 / scrim2 / bc) = 15 slot; nay gộp còn 5 lệnh, chọn bản bằng option `loai`.
//   /upload loai:<scrim1|scrim2|bc>        = /uploadscrim1 | /uploadscrim2 | /uploadbc
//   /usi    loai:<scrim1|scrim2|bc>        = /usi1 | /usi2 | /ubci
//   /post   loai:<...> [mention:@role]     = /postscrim1 | /postscrim2 | /postbc
//   /rpost  loai:<...>                     = /rpostscrim1 | /rpostscrim2 | /rpostbc
//   /where  loai:<...>                     = /wherescrim1 | /wherescrim2 | /wherebc
// CÁCH HOẠT ĐỘNG: handler cũ (slashSrcImage.js, slashScrim.js) KHÔNG đổi — chúng vẫn so khớp theo tên lệnh cũ.
// commands/slashCommands.js gọi resolveMergedCommandName() để dịch (tên gộp + loai) -> tên lệnh cũ trước khi điều phối.
// Bản nm! (nm!uploadscrim1, nm!postbc, ...) và các route web /admin/* KHÔNG đi qua file này nên không bị ảnh hưởng.

const MERGED_SLASH_ALIASES = {
  upload: { scrim1: 'uploadscrim1', scrim2: 'uploadscrim2', bc: 'uploadbc' },
  usi: { scrim1: 'usi1', scrim2: 'usi2', bc: 'ubci' },
  post: { scrim1: 'postscrim1', scrim2: 'postscrim2', bc: 'postbc' },
  rpost: { scrim1: 'rpostscrim1', scrim2: 'rpostscrim2', bc: 'rpostbc' },
  where: { scrim1: 'wherescrim1', scrim2: 'wherescrim2', bc: 'wherebc' },
};

const LOAI_CHOICES = [
  { name: 'Scrim 1', value: 'scrim1' },
  { name: 'Scrim 2', value: 'scrim2' },
  { name: 'Bang Chiến', value: 'bc' },
];

// Trả về tên lệnh "cũ" tương ứng; lệnh không thuộc nhóm gộp thì trả nguyên interaction.commandName.
function resolveMergedCommandName(interaction) {
  const map = MERGED_SLASH_ALIASES[interaction.commandName];
  if (!map) return interaction.commandName;
  const loai = interaction.options && interaction.options.getString ? interaction.options.getString('loai') : null;
  return map[loai] || interaction.commandName;
}

function buildMergedSlashCommands(SlashCommandBuilder) {
  const withLoai = (builder) => builder.addStringOption((o) => o.setName('loai').setDescription('Chọn Scrim 1 / Scrim 2 / Bang Chiến').setRequired(true).addChoices(...LOAI_CHOICES));
  return [
    withLoai(new SlashCommandBuilder().setName('upload').setDescription('[NPC] Chụp ảnh vùng Scrim 1 / Scrim 2 / Bảng Chiến từ Google Sheet nguồn')),
    withLoai(new SlashCommandBuilder().setName('usi').setDescription('Gửi tin nhắn ảnh mới cho Scrim 1 / Scrim 2 / Bảng Chiến')),
    withLoai(new SlashCommandBuilder().setName('post').setDescription('[NPC] Đăng tin Scrim 1 / Scrim 2 / Bang Chiến: ảnh mới nhất + nút Xem Vị Trí Của Bạn'))
      .addRoleOption((opt) => opt.setName('mention').setDescription('Mention role kèm tin đăng (tùy chọn)').setRequired(false)),
    withLoai(new SlashCommandBuilder().setName('rpost').setDescription('[NPC] Cập nhật lại tin đã đăng bằng /post (ảnh + nội dung mới)')),
    withLoai(new SlashCommandBuilder().setName('where').setDescription('[NPC] Tạo nút Xem Vị Trí/Phân Công/Ghi Chú của Scrim 1 / Scrim 2 / Bang Chiến')),
  ];
}

module.exports = { MERGED_SLASH_ALIASES, LOAI_CHOICES, resolveMergedCommandName, buildMergedSlashCommands };
