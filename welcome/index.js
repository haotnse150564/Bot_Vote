// ===== welcome/index.js — Thành viên MỚI vào server: tự gán role + gửi ảnh chào =====
//   1) Gán WELCOME_ROLE_ID (config/welcome.js) cho người vừa vào — chỉ trong server WELCOME_GUILD_ID, bỏ qua bot.
//   2) Vẽ ảnh chào (welcome/card.js) và gửi kèm lời chào, tag người mới.
// Hai bước độc lập: gán role lỗi (thiếu quyền / role bot thấp hơn) vẫn gửi lời chào, vẽ ảnh lỗi thì gửi tin chữ.
// Cần: intent GuildMembers (đã bật ở client.js + Developer Portal), quyền Manage Roles và role của bot nằm TRÊN role được gán.
// Người RỜI server (tự out / bị kick / bị ban) cũng được gửi 1 ảnh tạm biệt + lời nhắn vào cùng kênh.
// Khác events/roleGreet.js (chào khi được gắn role "member bang" bằng lệnh /hi) — file này chạy ngay lúc VÀO server.
const { Events, AttachmentBuilder } = require('discord.js');
const client = require('../client');
const { WELCOME_GUILD_ID, WELCOME_ROLE_ID, WELCOME_CHANNEL_ID, WELCOME_ENABLED, FEEDBACK_CHANNEL_ID, WELCOME_NAME_WAIT_MS, WELCOME_NAME_MAX_CHECKS, PICK_ROLE_CHANNEL_ID } = require('../config');
const { runRenderQueue } = require('../utils/renderQueue');
const { renderWelcomeCard, FAREWELL_QUIPS } = require('./card');

// Lời chào gửi kèm ảnh .
function buildWelcomeText(userId) {
  return `Chào mừng <@${userId}> đến với Nhất Mộng.\nPick role tại: <#${PICK_ROLE_CHANNEL_ID}>`;
}

async function assignWelcomeRole(member) {
  if (member.roles.cache.has(WELCOME_ROLE_ID)) return;
  try {
    await member.roles.add(WELCOME_ROLE_ID, 'Tự gán role khi thành viên vào server');
    console.log(`[welcome] Đã gán role ${WELCOME_ROLE_ID} cho ${member.user.tag} (${member.id}).`);
  } catch (error) {
    // 50013 = thiếu quyền (Manage Roles hoặc role của bot đang thấp hơn role cần gán); 10011 = role không tồn tại.
    const hint = error.code === 50013 ? ' — kiểm tra bot có quyền Manage Roles và role của bot nằm TRÊN role này' : error.code === 10011 ? ' — role không tồn tại trong server' : '';
    console.error(`[welcome] Không gán được role ${WELCOME_ROLE_ID} cho ${member.id}: ${error.message}${hint}`);
  }
}

async function resolveWelcomeChannel(guild) {
  const ids = [WELCOME_CHANNEL_ID, guild.systemChannelId, FEEDBACK_CHANNEL_ID].filter(Boolean);
  for (const id of ids) {
    try {
      const channel = guild.channels.cache.get(id) || (await guild.channels.fetch(id));
      if (channel && typeof channel.isTextBased === 'function' && channel.isTextBased() && !channel.isVoiceBased()) return channel;
    } catch (_) {
      /* thử kênh kế tiếp */
    }
  }
  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Tên đúng như Discord hiện ở lời tag: biệt danh server > tên hiển thị > username.
function nameOf(member) {
  return member.nickname || (member.user && (member.user.globalName || member.user.username)) || member.displayName || '';
}

// Dữ liệu member trong sự kiện "vào server" có thể CŨ (chưa có biệt danh). Tải lại từ Discord, chờ biệt danh xuất hiện.
async function fetchSettledMember(member) {
  let current = member;
  for (let i = 0; i < WELCOME_NAME_MAX_CHECKS; i++) {
    if (current.nickname) break;
    await sleep(WELCOME_NAME_WAIT_MS);
    try {
      current = await member.guild.members.fetch({ user: member.id, force: true });
    } catch (_) {
      break; // người đã rời / không tải được -> dùng dữ liệu đang có
    }
  }
  return current;
}

async function sendWelcome(joined) {
  const member = await fetchSettledMember(joined);
  const channel = await resolveWelcomeChannel(member.guild);
  if (!channel) {
    console.error('[welcome] Không tìm được kênh để gửi lời chào (WELCOME_CHANNEL_ID / kênh hệ thống / FEEDBACK_CHANNEL_ID).');
    return;
  }

  const content = buildWelcomeText(member.id);
  const allowedMentions = { users: [member.id] };

  let files = [];
  try {
    const png = await runRenderQueue(() =>
      renderWelcomeCard({
        displayName: nameOf(member),
        avatarUrl: member.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true }),
      })
    );
    files = [new AttachmentBuilder(png, { name: 'chao-mung.png' })];
  } catch (error) {
    console.error('[welcome] Vẽ ảnh chào lỗi, gửi tin chữ thay thế:', error.message);
  }

  await channel.send({ content, files, allowedMentions });
}

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    if (!WELCOME_ENABLED) return;
    if (!member.guild || member.guild.id !== WELCOME_GUILD_ID) return;
    if (member.user.bot) return;

    await assignWelcomeRole(member); // lỗi đã tự bắt bên trong, không chặn lời chào
    await sendWelcome(member);
  } catch (error) {
    console.error('[welcome] Lỗi xử lý thành viên mới:', error.message);
  }
});

// Tạm biệt khi có người rời/bị đá khỏi server: 1 ảnh (welcome/card.js, mode 'farewell') + 1 dòng chữ, cùng kênh với lời chào.
function buildFarewellText(displayName, quip) {
  const safe = String(displayName || '').replace(/[*_`~|>@#]/g, '').slice(0, 60).trim() || 'Một huynh đệ';
  const tail = quip || FAREWELL_QUIPS[Math.floor(Math.random() * FAREWELL_QUIPS.length)];
  return `👋 **${safe}** đã rời Nhất Mộng. ${tail}`;
}

client.on(Events.GuildMemberRemove, async (member) => {
  try {
    if (!WELCOME_ENABLED) return;
    if (!member.guild || member.guild.id !== WELCOME_GUILD_ID) return;
    if (member.user && member.user.bot) return;

    const channel = await resolveWelcomeChannel(member.guild);
    if (!channel) return;
    const name = nameOf(member);
    const quip = FAREWELL_QUIPS[Math.floor(Math.random() * FAREWELL_QUIPS.length)];

    let files = [];
    let content = buildFarewellText(name, quip);
    try {
      const png = await runRenderQueue(() =>
        renderWelcomeCard({
          mode: 'farewell',
          displayName: name,
          quip,
          avatarUrl: member.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true }),
        })
      );
      files = [new AttachmentBuilder(png, { name: 'tam-biet.png' })];
      content = `👋 **${String(name).replace(/[*_`~|>@#]/g, '').slice(0, 60).trim() || 'Một huynh đệ'}** đã rời Nhất Mộng.`; // ảnh đã có câu chúc
    } catch (error) {
      console.error('[welcome] Vẽ ảnh tạm biệt lỗi, gửi tin chữ thay thế:', error.message);
    }
    await channel.send({ content, files, allowedMentions: { parse: [] } });
  } catch (error) {
    console.error('[welcome] Lỗi gửi lời tạm biệt:', error.message);
  }
});

module.exports = { buildWelcomeText, buildFarewellText };
