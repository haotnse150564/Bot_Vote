// ===== pickRole — Pick Role bằng react, nhiều "bảng" (mỗi bảng = 1 tin trong kênh) =====
// Kênh PICK_ROLE_CHANNEL_ID có N tin do bot đăng, mỗi tin là 1 "bảng" với tiêu đề + MÃ hiển thị luôn trên tiêu đề,
// vd "🎭 Pick Role Săn Boss (boss)". Ai react đúng icon của role thì được cấp role, bỏ react thì gỡ role.
// Mặc định có sẵn 2 bảng: prhp (Pick Hệ Phái Của Bạn, đăng trước) và prhd (Pick Role Hoạt Động Bạn Muốn).
// CHỈ NPC/admin chỉnh sửa được (mọi lệnh đều ẩn, chỉ người gõ thấy):
//   /pickrole bang-moi  ma tieu_de [mot_role]   tạo bảng/tin mới (mot_role = mỗi người chỉ giữ 1 role của bảng)
//   /pickrole bang-xoa  ma                      xoá cả bảng + tin + danh sách role (KHÔNG tước role đã cấp)
//   /pickrole doi-tieu-de ma tieu_de            đổi tiêu đề
//   /pickrole them ma noidung                   noidung = "<role ID hoặc @role> ; <mô tả> ; <icon>"
//   /pickrole xoa ma muc                        muc = role ID / @role / icon (KHÔNG tước role đã cấp)
//   /pickrole ds                                liệt kê các bảng
//   (Lối tắt cũ /addprhd /addprhp /removeprhd /removeprhp đã GỠ ĐĂNG KÝ để tiết kiệm slot; dùng /pickrole them|xoa ma:prhd|prhp.)
// Gõ "ma" có gợi ý tự động. Dữ liệu: tab "Pick Role Bảng" + "Pick Role" (googleSheets/pickRoleSheet.js).
// Tin tự tìm lại qua footer "NM-PICKROLE:<mã>" sau mỗi lần deploy. Các hàm listBoards/createBoard/deleteBoard/
// renameBoard/listPickRoles/addPickRole/removePickRole tách riêng để sau này làm trang web gọi lại.
const { Events, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const client = require('../client');
const { isBotReady, replyNotReadyToInteraction } = require('../utils/readyGate');
const {
  PICK_ROLE_CHANNEL_ID, PICK_ROLE_MAX_PER_KIND, PICK_ROLE_DESC_MAX_LEN, PICK_ROLE_MAX_BOARDS, PICK_ROLE_TITLE_MAX_LEN,
  NPC_ROLE_ID, ADMIN_USER_ID, DISCORD_GUILD_ID,
} = require('../config');
const sheet = require('../googleSheets/pickRoleSheet');

const MARKER_PREFIX = 'NM-PICKROLE:';
const CODE_RE = /^[a-z0-9_]{2,20}$/;
const COLORS = [0x5865f2, 0x57f287, 0xfee75c, 0xeb459e, 0xed4245, 0xe67e22, 0x1abc9c, 0x9b59b6];
const DEFAULT_BOARDS = [
  { code: 'prhp', title: 'Pick Hệ Phái Của Bạn', exclusive: false },
  { code: 'prhd', title: 'Pick Role Hoạt Động Bạn Muốn', exclusive: false },
];

let boards = []; // [{ code, title, exclusive, userId, createdAt }] theo thứ tự đăng
const entries = new Map(); // code -> [{ kind(=code), roleId, desc, icon, userId, createdAt }]
const messageIds = new Map(); // code -> message id
let started = false;

// Mọi thao tác thêm/xoá/đồng bộ chạy tuần tự để 2 lệnh gõ cùng lúc không đè nhau.
let queue = Promise.resolve();
function enqueue(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

// ---------- emoji / role ----------
const CUSTOM_EMOJI_RE = /^<(a?):([A-Za-z0-9_]{2,32}):(\d{15,25})>$/;
function emojiKey(icon) {
  const m = CUSTOM_EMOJI_RE.exec(icon);
  return m ? m[3] : icon.replace(/️/g, '');
}
function reactionKey(emoji) {
  return emoji.id ? emoji.id : String(emoji.name || '').replace(/️/g, '');
}
function isUnicodeEmoji(text) {
  if (!text || text.length > 24 || /[A-Za-z]/.test(text.replace(/‍/g, ''))) return false;
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]️?⃣/u.test(text);
}
function parseRoleId(raw) {
  const t = String(raw || '').trim();
  const m = /^<@&(\d{15,25})>$/.exec(t) || /^(\d{15,25})$/.exec(t);
  return m ? m[1] : null;
}

// "<role> ; <mô tả> ; <icon>" — mô tả có thể chứa dấu ';' (lấy phần đầu làm role, phần cuối làm icon).
function parseEntryInput(text) {
  const parts = String(text || '').split(';').map((s) => s.trim());
  if (parts.length < 3) throw new Error('Sai cú pháp. Dùng: `<role ID hoặc @role> ; <mô tả> ; <icon>`');
  const roleId = parseRoleId(parts[0]);
  if (!roleId) throw new Error('Phần đầu phải là role ID hoặc @role.');
  const icon = parts[parts.length - 1];
  const desc = parts.slice(1, -1).join('; ').trim();
  if (!desc) throw new Error('Thiếu mô tả.');
  if (desc.length > PICK_ROLE_DESC_MAX_LEN) throw new Error(`Mô tả quá dài (tối đa ${PICK_ROLE_DESC_MAX_LEN} ký tự).`);
  if (!CUSTOM_EMOJI_RE.test(icon) && !isUnicodeEmoji(icon)) throw new Error('Phần cuối phải là 1 icon (emoji thường hoặc emoji server dạng `<:tên:id>`).');
  return { roleId, desc, icon };
}

function normalizeCode(raw) {
  const code = String(raw || '').trim().toLowerCase();
  if (!CODE_RE.test(code)) throw new Error('Mã bảng chỉ gồm chữ thường không dấu, số, `_` (2-20 ký tự), vd `boss`, `pvp_1`.');
  return code;
}
function getBoard(rawCode) {
  const code = String(rawCode || '').trim().toLowerCase();
  const board = boards.find((b) => b.code === code);
  if (!board) throw new Error(`Không có bảng mã \`${code}\`. Dùng \`/pickrole ds\` để xem các bảng.`);
  return board;
}
function cleanTitle(raw) {
  const title = String(raw || '').trim();
  if (!title) throw new Error('Tiêu đề không được để trống.');
  if (title.length > PICK_ROLE_TITLE_MAX_LEN) throw new Error(`Tiêu đề quá dài (tối đa ${PICK_ROLE_TITLE_MAX_LEN} ký tự).`);
  return title;
}

function getGuild() {
  return client.guilds.cache.get(DISCORD_GUILD_ID) || client.guilds.cache.first() || null;
}

// ---------- tin trong kênh ----------
function buildEmbed(board) {
  const list = entries.get(board.code) || [];
  const lines = list.length
    ? list.map((e) => `${e.icon} <@&${e.roleId}> — ${e.desc}`).join('\n')
    : `_Chưa có role nào — NPC dùng \`/pickrole them ${board.code}\` để thêm._`;
  const idx = Math.max(0, boards.findIndex((b) => b.code === board.code));
  const intro = board.exclusive
    ? 'React đúng icon bên dưới để nhận role (**mỗi người chỉ chọn 1**, chọn cái mới sẽ đổi), bỏ react để gỡ role.'
    : 'React đúng icon bên dưới để nhận role, bỏ react để gỡ role.';
  return new EmbedBuilder()
    .setColor(COLORS[idx % COLORS.length])
    // Tiêu đề viết IN HOA, kèm mã, dạng heading "# ..." — Discord chỉ hiện heading markdown trong description (không phải setTitle).
    .setDescription(`# 🎭 ${`${board.title} (${board.code})`.toUpperCase()}\n${intro}\n\n${lines}`.slice(0, 4000))
    .setFooter({ text: `${MARKER_PREFIX}${board.code}` });
}

async function getChannel() {
  if (!PICK_ROLE_CHANNEL_ID) return null;
  return client.channels.fetch(PICK_ROLE_CHANNEL_ID).catch(() => null);
}

// Tìm tin của bot theo footer; không có thì đăng mới.
async function ensureMessage(channel, board) {
  const known = messageIds.get(board.code);
  if (known) {
    const cur = await channel.messages.fetch(known).catch(() => null);
    if (cur) return cur;
    messageIds.delete(board.code);
  }
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const found = recent && recent.find((m) => m.author.id === client.user.id && m.embeds.some((e) => e.footer && e.footer.text === `${MARKER_PREFIX}${board.code}`));
  if (found) {
    messageIds.set(board.code, found.id);
    return found;
  }
  const sent = await channel.send({ embeds: [buildEmbed(board)], allowedMentions: { parse: [] } });
  messageIds.set(board.code, sent.id);
  return sent;
}

// Cập nhật nội dung tin + đảm bảo bot có đúng reaction cho từng mục, gỡ reaction thừa.
async function refreshBoard(board) {
  const channel = await getChannel();
  if (!channel) return;
  const message = await ensureMessage(channel, board);
  await message.edit({ embeds: [buildEmbed(board)], allowedMentions: { parse: [] } });

  const list = entries.get(board.code) || [];
  const wanted = new Set(list.map((e) => emojiKey(e.icon)));
  for (const reaction of message.reactions.cache.values()) {
    if (!wanted.has(reactionKey(reaction.emoji))) await reaction.remove().catch((err) => console.error('[pickRole] Không gỡ được reaction thừa:', err.message));
  }
  for (const e of list) {
    const existing = message.reactions.cache.find((r) => reactionKey(r.emoji) === emojiKey(e.icon));
    if (existing && existing.me) continue;
    await message.react(e.icon).catch((err) => console.error(`[pickRole] Bot không react được ${e.icon}:`, err.message));
  }
}

async function loadFromSheet() {
  boards = await sheet.readBoardRows();
  const rows = await sheet.readPickRoleRows();
  entries.clear();
  for (const b of boards) entries.set(b.code, rows.filter((r) => r.kind === b.code));
}

// ---------- API dùng chung (lệnh Discord + sau này là web) ----------
function listBoards() {
  return boards.map((b) => ({ ...b, count: (entries.get(b.code) || []).length }));
}
function listPickRoles(code) {
  return (entries.get(String(code).toLowerCase()) || []).map((e) => ({ ...e }));
}
function assertEnabled() {
  if (!PICK_ROLE_CHANNEL_ID) throw new Error('Chưa đặt PICK_ROLE_CHANNEL_ID nên tính năng Pick Role đang tắt.');
}

async function createBoard({ code, title, exclusive = false, userId }) {
  assertEnabled();
  return enqueue(async () => {
    const c = normalizeCode(code);
    const t = cleanTitle(title);
    if (boards.some((b) => b.code === c)) throw new Error(`Mã \`${c}\` đã có bảng rồi.`);
    if (boards.length >= PICK_ROLE_MAX_BOARDS) throw new Error(`Đã đủ ${PICK_ROLE_MAX_BOARDS} bảng.`);
    const board = { code: c, title: t, exclusive: Boolean(exclusive), userId: userId || '', createdAt: new Date().toISOString() };
    await sheet.appendBoardRow(board);
    boards.push(board);
    entries.set(c, []);
    await refreshBoard(board);
    return board;
  });
}

async function renameBoard(code, title) {
  return enqueue(async () => {
    const board = getBoard(code);
    const old = board.title;
    board.title = cleanTitle(title);
    try {
      await sheet.rewriteBoardRows(boards);
    } catch (error) {
      board.title = old;
      throw error;
    }
    await refreshBoard(board);
    return board;
  });
}

async function deleteBoard(code) {
  return enqueue(async () => {
    const board = getBoard(code);
    const idx = boards.findIndex((b) => b.code === board.code);
    boards.splice(idx, 1);
    try {
      await sheet.rewriteBoardRows(boards);
      await sheet.deletePickRoleRowsOfBoard(board.code);
    } catch (error) {
      boards.splice(idx, 0, board);
      throw error;
    }
    entries.delete(board.code);
    const channel = await getChannel();
    const msgId = messageIds.get(board.code);
    if (channel && msgId) await channel.messages.delete(msgId).catch(() => {});
    messageIds.delete(board.code);
    return board;
  });
}

async function addPickRole(code, { input, userId }) {
  assertEnabled();
  return enqueue(async () => {
    const board = getBoard(code);
    const { roleId, desc, icon } = parseEntryInput(input);
    const guild = getGuild();
    if (!guild) throw new Error('Bot chưa vào server.');
    const role = guild.roles.cache.get(roleId) || (await guild.roles.fetch(roleId).catch(() => null));
    if (!role) throw new Error(`Không tìm thấy role \`${roleId}\` trong server.`);
    if (role.id === guild.id) throw new Error('Không dùng được role @everyone.');
    if (role.managed) throw new Error('Role này do bot/tích hợp quản lý, không cấp bằng tay được.');
    const me = guild.members.me;
    if (!me || !me.permissions.has('ManageRoles')) throw new Error('Bot chưa có quyền **Manage Roles**.');
    if (me.roles.highest.comparePositionTo(role) <= 0) throw new Error(`Role ${role.name} đang cao hơn hoặc ngang role của bot — kéo role bot lên trên role đó trong Cài đặt server.`);

    const list = entries.get(board.code);
    if (list.length >= PICK_ROLE_MAX_PER_KIND) throw new Error(`Bảng \`${board.code}\` đã đủ ${PICK_ROLE_MAX_PER_KIND} role (giới hạn 20 reaction của Discord).`);
    if (list.some((e) => e.roleId === roleId)) throw new Error(`Role ${role.name} đã có trong bảng \`${board.code}\`.`);
    if (list.some((e) => emojiKey(e.icon) === emojiKey(icon))) throw new Error(`Icon ${icon} đã được dùng cho role khác trong bảng này.`);
    const custom = CUSTOM_EMOJI_RE.exec(icon);
    if (custom && !client.emojis.cache.has(custom[3])) throw new Error('Bot không dùng được emoji này (phải là emoji của server mà bot đang ở).');

    const entry = { kind: board.code, roleId, desc, icon, userId: userId || '', createdAt: new Date().toISOString() };
    await sheet.appendPickRoleRow(entry);
    list.push(entry);
    await refreshBoard(board);
    return { entry, role, board };
  });
}

// ref = role ID / @role / icon của mục cần xoá.
async function removePickRole(code, ref) {
  return enqueue(async () => {
    const board = getBoard(code);
    const text = String(ref || '').trim();
    const roleId = parseRoleId(text);
    const list = entries.get(board.code);
    const idx = list.findIndex((e) => (roleId && e.roleId === roleId) || emojiKey(e.icon) === emojiKey(text));
    if (idx === -1) throw new Error(`Không thấy mục nào khớp "${text}" trong bảng \`${board.code}\`.`);
    const [removed] = list.splice(idx, 1);
    try {
      await sheet.deletePickRoleRow(board.code, removed.roleId);
    } catch (error) {
      list.splice(idx, 0, removed); // ghi Sheet lỗi -> trả lại cache cho khớp
      throw error;
    }
    await refreshBoard(board);
    return removed;
  });
}

// ---------- react -> cấp/gỡ role ----------
function boardOfMessage(messageId) {
  for (const [code, id] of messageIds) if (id === messageId) return boards.find((b) => b.code === code) || null;
  return null;
}

async function handleReaction(reaction, user, adding) {
  if (user.bot || !isBotReady()) return;
  const board = boardOfMessage(reaction.message.id);
  if (!board) return;
  try {
    if (reaction.partial) await reaction.fetch();
    const list = entries.get(board.code) || [];
    const entry = list.find((e) => emojiKey(e.icon) === reactionKey(reaction.emoji));
    if (!entry) {
      if (adding) await reaction.users.remove(user.id).catch(() => {}); // icon lạ: dọn cho gọn tin
      return;
    }
    const guild = reaction.message.guild || getGuild();
    const member = await guild.members.fetch(user.id);
    if (adding) {
      if (board.exclusive) {
        // Bảng "một role": gỡ role + react của các mục khác trong cùng bảng.
        for (const other of list) {
          if (other.roleId === entry.roleId) continue;
          if (member.roles.cache.has(other.roleId)) await member.roles.remove(other.roleId, 'Pick Role (đổi lựa chọn)').catch(() => {});
          const r = reaction.message.reactions.cache.find((x) => reactionKey(x.emoji) === emojiKey(other.icon));
          if (r) await r.users.remove(user.id).catch(() => {});
        }
      }
      if (!member.roles.cache.has(entry.roleId)) await member.roles.add(entry.roleId, 'Pick Role (react)');
    } else if (member.roles.cache.has(entry.roleId)) {
      await member.roles.remove(entry.roleId, 'Pick Role (bỏ react)');
    }
  } catch (error) {
    console.error(`[pickRole] Lỗi ${adding ? 'cấp' : 'gỡ'} role cho ${user.id}:`, error.message);
  }
}

client.on(Events.MessageReactionAdd, (reaction, user) => { handleReaction(reaction, user, true); });
client.on(Events.MessageReactionRemove, (reaction, user) => { handleReaction(reaction, user, false); });

// Bot tắt/deploy lại thì mất sự kiện react: lúc khởi động cấp bù role cho người ĐÃ react mà chưa có role (không tước role ai).
async function catchUpRoles() {
  const guild = getGuild();
  const channel = await getChannel();
  if (!guild || !channel) return;
  for (const board of boards) {
    const id = messageIds.get(board.code);
    const message = id ? await channel.messages.fetch(id).catch(() => null) : null;
    if (!message) continue;
    for (const e of entries.get(board.code) || []) {
      const reaction = message.reactions.cache.find((r) => reactionKey(r.emoji) === emojiKey(e.icon));
      if (!reaction) continue;
      const users = await reaction.users.fetch({ limit: 100 }).catch(() => null);
      if (!users) continue;
      for (const u of users.values()) {
        if (u.bot) continue;
        const member = await guild.members.fetch(u.id).catch(() => null);
        if (member && !member.roles.cache.has(e.roleId)) await member.roles.add(e.roleId, 'Pick Role (bù sau khi bot khởi động)').catch(() => {});
      }
    }
  }
}

async function startPickRole() {
  if (started) return;
  started = true;
  if (!PICK_ROLE_CHANNEL_ID) {
    console.warn('[pickRole] Chưa đặt PICK_ROLE_CHANNEL_ID — tắt Pick Role.');
    return;
  }
  const { boardsCreated } = await sheet.ensurePickRoleSheetExists();
  // Lần đầu có tab bảng (nâng cấp từ bản 2 tin cố định): gieo sẵn prhp + prhd, role cũ ở tab "Pick Role" tự khớp theo mã.
  if (boardsCreated) {
    for (const b of DEFAULT_BOARDS) await sheet.appendBoardRow({ ...b, userId: '' });
  }
  await loadFromSheet();
  await enqueue(async () => {
    const channel = await getChannel();
    if (!channel) throw new Error('Không mở được kênh PICK_ROLE_CHANNEL_ID (sai ID hoặc bot thiếu quyền).');
    for (const board of boards) await refreshBoard(board); // theo thứ tự bảng
  });
  await catchUpRoles();
  console.log(`[pickRole] Bật: ${boards.map((b) => `${b.code}(${(entries.get(b.code) || []).length})`).join(', ') || 'chưa có bảng'}.`);
}

// ---------- slash commands ----------
const codeOption = (o) => o.setName('ma').setDescription('Mã bảng (gõ để gợi ý)').setRequired(true).setAutocomplete(true);
const PICKROLE_SLASH_COMMANDS = [
  new SlashCommandBuilder().setName('pickrole').setDescription('(NPC) Quản lý các bảng Pick Role')
    .addSubcommand((s) => s.setName('bang-moi').setDescription('Tạo bảng (tin) mới')
      .addStringOption((o) => o.setName('ma').setDescription('Mã bảng: chữ thường không dấu/số/_, vd boss').setRequired(true))
      .addStringOption((o) => o.setName('tieu_de').setDescription('Tiêu đề hiển thị, vd Pick Role Săn Boss').setRequired(true))
      .addBooleanOption((o) => o.setName('mot_role').setDescription('Mỗi người chỉ giữ 1 role của bảng này (mặc định: không)')))
    .addSubcommand((s) => s.setName('bang-xoa').setDescription('Xoá cả bảng + tin (không tước role đã cấp)').addStringOption(codeOption))
    .addSubcommand((s) => s.setName('doi-tieu-de').setDescription('Đổi tiêu đề bảng').addStringOption(codeOption)
      .addStringOption((o) => o.setName('tieu_de').setDescription('Tiêu đề mới').setRequired(true)))
    .addSubcommand((s) => s.setName('them').setDescription('Thêm role vào bảng').addStringOption(codeOption)
      .addStringOption((o) => o.setName('noidung').setDescription('<role ID hoặc @role> ; <mô tả> ; <icon>').setRequired(true)))
    .addSubcommand((s) => s.setName('xoa').setDescription('Xoá role khỏi bảng (không tước role đã cấp)').addStringOption(codeOption)
      .addStringOption((o) => o.setName('muc').setDescription('Role ID, @role hoặc icon của mục cần xoá').setRequired(true)))
    .addSubcommand((s) => s.setName('ds').setDescription('Liệt kê các bảng Pick Role')),
];

function isStaff(interaction) {
  return interaction.user.id === ADMIN_USER_ID || Boolean(interaction.member && interaction.member.roles && interaction.member.roles.cache.has(NPC_ROLE_ID));
}

async function runCommand(interaction) {
  const name = interaction.commandName;
  const short = /^(add|remove)(prhd|prhp)$/.exec(name); // nhánh cũ, không còn được Discord gửi tới (lệnh đã gỡ đăng ký) — để lại vô hại
  if (short) {
    const code = short[2];
    if (short[1] === 'add') {
      const { entry, role } = await addPickRole(code, { input: interaction.options.getString('noidung'), userId: interaction.user.id });
      return `✅ Đã thêm vào bảng \`${code}\`: ${entry.icon} **${role.name}** — ${entry.desc}`;
    }
    const removed = await removePickRole(code, interaction.options.getString('muc'));
    return `✅ Đã xoá khỏi bảng \`${code}\`: ${removed.icon} <@&${removed.roleId}>. (Người đã nhận role vẫn giữ role.)`;
  }
  const sub = interaction.options.getSubcommand();
  const ma = interaction.options.getString('ma');
  if (sub === 'bang-moi') {
    const b = await createBoard({ code: ma, title: interaction.options.getString('tieu_de'), exclusive: interaction.options.getBoolean('mot_role') || false, userId: interaction.user.id });
    return `✅ Đã tạo bảng **${b.title}** (\`${b.code}\`)${b.exclusive ? ' — mỗi người chỉ giữ 1 role' : ''}. Dùng \`/pickrole them ${b.code}\` để thêm role.`;
  }
  if (sub === 'bang-xoa') {
    const b = await deleteBoard(ma);
    return `✅ Đã xoá bảng **${b.title}** (\`${b.code}\`). Người đã nhận role vẫn giữ role.`;
  }
  if (sub === 'doi-tieu-de') {
    const b = await renameBoard(ma, interaction.options.getString('tieu_de'));
    return `✅ Đã đổi tiêu đề bảng \`${b.code}\` thành **${b.title}**.`;
  }
  if (sub === 'them') {
    const { entry, role, board } = await addPickRole(ma, { input: interaction.options.getString('noidung'), userId: interaction.user.id });
    return `✅ Đã thêm vào bảng **${board.title}** (\`${board.code}\`): ${entry.icon} **${role.name}** — ${entry.desc}`;
  }
  if (sub === 'xoa') {
    const removed = await removePickRole(ma, interaction.options.getString('muc'));
    return `✅ Đã xoá khỏi bảng \`${String(ma).toLowerCase()}\`: ${removed.icon} <@&${removed.roleId}>. (Người đã nhận role vẫn giữ role.)`;
  }
  const all = listBoards();
  if (!all.length) return 'Chưa có bảng nào. Tạo bằng `/pickrole bang-moi`.';
  return all.map((b) => `• **${b.title}** (\`${b.code}\`) — ${b.count} role${b.exclusive ? ', 1 role/người' : ''}`).join('\n');
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isAutocomplete() && interaction.commandName === 'pickrole') {
      const typed = String(interaction.options.getFocused() || '').toLowerCase();
      const choices = boards
        .filter((b) => b.code.includes(typed) || b.title.toLowerCase().includes(typed))
        .slice(0, 25)
        .map((b) => ({ name: `${b.title} (${b.code})`.slice(0, 100), value: b.code }));
      await interaction.respond(choices);
      return;
    }
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'pickrole' && !/^(add|remove)(prhd|prhp)$/.test(interaction.commandName)) return;
    if (!isBotReady()) return void (await replyNotReadyToInteraction(interaction));
    if (!isStaff(interaction)) return void (await interaction.reply({ content: '❌ Chỉ NPC mới chỉnh sửa được Pick Role.', ephemeral: true }));
    await interaction.deferReply({ ephemeral: true });
    try {
      await interaction.editReply({ content: await runCommand(interaction), allowedMentions: { parse: [] } });
    } catch (error) {
      await interaction.editReply(`❌ ${error.message}`);
    }
  } catch (error) {
    console.error('[pickRole] Lỗi lệnh:', error.message);
  }
});

module.exports = {
  startPickRole, PICKROLE_SLASH_COMMANDS,
  listBoards, createBoard, renameBoard, deleteBoard, listPickRoles, addPickRole, removePickRole, parseEntryInput,
};
