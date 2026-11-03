// ===== voiceStats — Thống kê voice Bang Chiến/Scrim + Lịch Bang =====
// - Theo dõi MỌI người ngồi trong các voice channel thuộc danh mục
//   VOICE_STATS_CATEGORY_ID (config/voiceStats.js). Mỗi khi 1 người rời kênh
//   (hoặc chuyển kênh trong danh mục) bot ghi 1 dòng vào tab "Voice Bang":
//   ngày, Discord ID, ingame, kênh, giờ vào/ra, số phút, loại (Bang Chiến /
//   Scrim / Khác — suy ra từ giờ Bang Chiến + 2 buổi scrim đang set).
// - /voice (nm!voice): ai đang ngồi voice ngay lúc này + tổng số người.
// - /voicestats (nm!voicestats [tuan|thang|tatca] [bc|scrim]): xếp hạng thời
//   gian ngồi + số buổi tham gia.
// - /lich (nm!lich): lịch Bang sắp tới (xem voiceStats/schedule.js).
// Module tự chứa (listener riêng), không đụng tới commands/*.js.
const { Events } = require('discord.js');
const client = require('../client');
const { isBotReady, replyNotReadyToMessage, replyNotReadyToInteraction } = require('../utils/readyGate');
const { scrimData } = require('../state');
const {
  DISCORD_GUILD_ID,
  VOICE_STATS_CATEGORY_ID,
  VOICE_STATS_MIN_SECONDS,
  VOICE_WINDOW_BEFORE_MINUTES,
  VOICE_WINDOW_BC_AFTER_MINUTES,
  VOICE_WINDOW_SCRIM_AFTER_MINUTES,
  BC_EVENT_DAY,
  BC_EVENT_HOUR,
  BC_EVENT_MINUTE,
} = require('../config');
const { appendVoiceRows, readVoiceRows, ensureVoiceStatsSheet } = require('../googleSheets/voiceStatsSheet');
const { getMemberInfoByDiscordId } = require('../googleSheets/memberSheet');
const { parseVnWeekday, parseScrimTime } = require('../utils/time');
const { VOICESTATS_SLASH_COMMANDS } = require('./format');
const { buildScheduleText } = require('./schedule');

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

// userId -> { since, channelId, channelName, displayName }
const activeSessions = new Map();
// Dòng chưa ghi được lên Sheet (lỗi mạng/quota) — thử lại ở lần ghi kế tiếp.
const pendingRows = [];

function pad(n) {
  return String(n).padStart(2, '0');
}
function vnParts(ms) {
  const d = new Date(ms + VN_OFFSET_MS);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
}
function dateKey(ms) {
  const p = vnParts(ms);
  return `${p.y}-${pad(p.mo + 1)}-${pad(p.d)}`;
}
function dateTimeStr(ms) {
  const p = vnParts(ms);
  return `${p.y}-${pad(p.mo + 1)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}`;
}

// Các cửa sổ sự kiện trong NGÀY (lịch VN) chứa mốc startMs.
function eventWindowsForDay(startMs) {
  const p = vnParts(startMs);
  const windows = [];
  const make = (hour, minute, afterMin, label) => {
    const eventMs = Date.UTC(p.y, p.mo, p.d, hour, minute) - VN_OFFSET_MS;
    windows.push({ label, from: eventMs - VOICE_WINDOW_BEFORE_MINUTES * MIN_MS, to: eventMs + afterMin * MIN_MS });
  };

  if (p.dow === BC_EVENT_DAY) make(BC_EVENT_HOUR, BC_EVENT_MINUTE, VOICE_WINDOW_BC_AFTER_MINUTES, 'Bang Chiến');
  [
    [scrimData.session1Day, scrimData.session1Time],
    [scrimData.session2Day, scrimData.session2Time],
  ].forEach(([day, time]) => {
    const weekday = parseVnWeekday(day);
    const t = parseScrimTime(time);
    if (weekday !== null && t && weekday === p.dow) make(t.hour, t.minute, VOICE_WINDOW_SCRIM_AFTER_MINUTES, 'Scrim');
  });
  return windows;
}

function classifySession(startMs, endMs) {
  let best = { label: 'Khác', overlap: 0 };
  for (const w of eventWindowsForDay(startMs)) {
    const overlap = Math.min(endMs, w.to) - Math.max(startMs, w.from);
    if (overlap > best.overlap) best = { label: w.label, overlap };
  }
  return best.label;
}

function isTrackedChannel(channel) {
  return Boolean(channel && channel.parentId === VOICE_STATS_CATEGORY_ID);
}

async function flushPending() {
  if (!pendingRows.length) return;
  const batch = pendingRows.splice(0, pendingRows.length);
  try {
    await appendVoiceRows(batch);
  } catch (error) {
    console.error('[voiceStats] Ghi Sheet thất bại, sẽ thử lại lần sau:', error.message);
    pendingRows.unshift(...batch);
  }
}

async function closeSession(userId, endMs = Date.now()) {
  const session = activeSessions.get(userId);
  if (!session) return;
  activeSessions.delete(userId);

  if ((endMs - session.since) / 1000 < VOICE_STATS_MIN_SECONDS) return;

  let ingame = session.displayName;
  try {
    const info = await getMemberInfoByDiscordId(userId);
    if (info && info.ingame) ingame = info.ingame;
  } catch (_) {
    // dùng tên hiển thị Discord
  }

  const minutes = Math.round(((endMs - session.since) / MIN_MS) * 10) / 10;
  pendingRows.push([
    dateKey(session.since),
    userId,
    ingame,
    session.channelName,
    dateTimeStr(session.since),
    dateTimeStr(endMs),
    minutes,
    classifySession(session.since, endMs),
  ]);
  await flushPending();
}

function openSession(member, channel, startMs = Date.now()) {
  if (!member || member.user.bot) return;
  activeSessions.set(member.id, {
    since: startMs,
    channelId: channel.id,
    channelName: channel.name,
    displayName: member.displayName || member.user.username,
  });
}

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  try {
    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;
    if (oldState.channelId === newState.channelId) return; // mute/deafen... không đổi kênh

    const wasIn = isTrackedChannel(oldState.channel);
    const isIn = isTrackedChannel(newState.channel);
    if (wasIn) await closeSession(member.id);
    if (isIn) openSession(member, newState.channel);
  } catch (error) {
    console.error('[voiceStats] Lỗi xử lý VoiceStateUpdate:', error.message);
  }
});

// Lúc bot vừa khởi động: nhận lại những người ĐANG ngồi trong danh mục (tính
// từ lúc này) để không bỏ sót người đã ngồi sẵn từ trước khi bot restart.
client.once(Events.ClientReady, async () => {
  try {
    const guild = await client.guilds.fetch(DISCORD_GUILD_ID);
    const channels = await guild.channels.fetch();
    channels.forEach((channel) => {
      if (!channel || !channel.isVoiceBased() || !isTrackedChannel(channel)) return;
      channel.members.forEach((member) => {
        if (!activeSessions.has(member.id)) openSession(member, channel);
      });
    });
    console.log(`[voiceStats] Đang theo dõi ${activeSessions.size} người ngồi voice sẵn.`);
  } catch (error) {
    console.error('[voiceStats] Không quét được voice lúc khởi động:', error.message);
  }
});

// Khi Railway tắt bot (SIGTERM): chốt các lượt đang ngồi rồi mới thoát,
// tránh mất dữ liệu mỗi lần deploy lại. Có tự thoát sau tối đa 8 giây.
let shuttingDown = false;
process.on('SIGTERM', async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  const timer = setTimeout(() => process.exit(0), 8000);
  try {
    const now = Date.now();
    for (const userId of [...activeSessions.keys()]) await closeSession(userId, now);
    await flushPending();
  } catch (error) {
    console.error('[voiceStats] Lỗi khi chốt voice lúc tắt bot:', error.message);
  } finally {
    clearTimeout(timer);
    process.exit(0);
  }
});

// ---------------------------------------------------------------- Lệnh xem

function formatMinutes(totalMinutes) {
  const m = Math.round(totalMinutes);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}g${pad(m % 60)}p` : `${m}p`;
}

// Dữ liệu THÔ cho cả lệnh Discord lẫn trang web (admin/routes/routesVoice.js).
async function getLiveVoiceData() {
  const guild = await client.guilds.fetch(DISCORD_GUILD_ID);
  const channels = await guild.channels.fetch();
  const voiceChannels = [...channels.values()]
    .filter((c) => c && c.isVoiceBased() && isTrackedChannel(c))
    .sort((a, b) => a.rawPosition - b.rawPosition);

  const result = [];
  let total = 0;
  for (const channel of voiceChannels) {
    const members = [...channel.members.values()].filter((m) => !m.user.bot);
    total += members.length;
    const people = await Promise.all(
      members.map(async (m) => {
        const info = await getMemberInfoByDiscordId(m.id).catch(() => null);
        const session = activeSessions.get(m.id);
        return {
          discordId: m.id,
          name: info && info.ingame ? info.ingame : m.displayName,
          className: info && info.className ? info.className : '',
          sinceMs: session ? session.since : null,
        };
      })
    );
    result.push({ channelId: channel.id, channelName: channel.name, count: members.length, members: people });
  }
  return { total, channels: result, fetchedAt: Date.now() };
}

async function buildLiveVoiceText() {
  const data = await getLiveVoiceData();
  if (!data.total) return '🔇 Hiện chưa có ai ngồi voice Bang Chiến/Scrim.';
  const lines = data.channels
    .filter((c) => c.count > 0)
    .map((c) => `🔊 **${c.channelName}** (${c.count}): ${c.members.map((m) => m.name).join(', ')}`);
  return `👥 **Đang ngồi voice: ${data.total} người**\n${lines.join('\n')}`;
}

// range: 'tuan' | 'thang' | 'tatca'; type: 'bc' | 'scrim' | 'tatca'.
async function getVoiceStatsData(range = 'tuan', type = 'tatca') {
  const now = Date.now();
  const sinceMs = range === 'thang' ? now - 30 * 86400000 : range === 'tatca' ? 0 : now - 7 * 86400000;
  const rows = await readVoiceRows(sinceMs ? dateKey(sinceMs) : '');
  const typeLabel = type === 'bc' ? 'Bang Chiến' : type === 'scrim' ? 'Scrim' : null;
  const filtered = typeLabel ? rows.filter((r) => r.type === typeLabel) : rows;

  const byUser = new Map();
  for (const r of filtered) {
    const u = byUser.get(r.discordId) || { discordId: r.discordId, name: r.ingame, minutes: 0, days: new Set() };
    u.name = r.ingame || u.name;
    u.minutes += r.minutes;
    u.days.add(`${r.date}|${r.type}`);
    byUser.set(r.discordId, u);
  }
  const players = [...byUser.values()]
    .sort((a, b) => b.minutes - a.minutes)
    .map((u) => ({ discordId: u.discordId, name: u.name, minutes: Math.round(u.minutes), sessions: u.days.size }));
  return {
    range,
    type,
    typeLabel,
    playerCount: players.length,
    totalMinutes: players.reduce((sum, u) => sum + u.minutes, 0),
    players,
  };
}

async function buildStatsText(range = 'tuan', type = 'tatca') {
  const data = await getVoiceStatsData(range, type);
  const rangeLabel = range === 'thang' ? '30 ngày qua' : range === 'tatca' ? 'tất cả' : '7 ngày qua';
  const title = `📊 **Thống kê voice${data.typeLabel ? ` — ${data.typeLabel}` : ''} (${rangeLabel})**`;
  if (!data.playerCount) return `${title}\nChưa có dữ liệu.`;
  const top = data.players
    .slice(0, 15)
    .map((u, i) => `${i + 1}. **${u.name || '?'}** — ${formatMinutes(u.minutes)} · ${u.sessions} buổi`);
  return `${title}\n👥 ${data.playerCount} người · tổng ${formatMinutes(data.totalMinutes)}\n\n${top.join('\n')}`;
}

function parseRange(word) {
  const w = String(word || '').toLowerCase();
  if (['thang', 'tháng', '30'].includes(w)) return 'thang';
  if (['tatca', 'all', 'tất', 'tatca'].includes(w)) return 'tatca';
  return 'tuan';
}
function parseType(word) {
  const w = String(word || '').toLowerCase();
  if (['bc', 'bangchien'].includes(w)) return 'bc';
  if (w === 'scrim') return 'scrim';
  return 'tatca';
}

// ---- Slash
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;
    if (!['voice', 'voicestats', 'lich'].includes(interaction.commandName)) return;
    if (!isBotReady()) {
      await replyNotReadyToInteraction(interaction);
      return;
    }
    await interaction.deferReply();
    let text;
    if (interaction.commandName === 'voice') text = await buildLiveVoiceText();
    else if (interaction.commandName === 'lich') text = buildScheduleText();
    else {
      text = await buildStatsText(
        interaction.options.getString('khoang') || 'tuan',
        interaction.options.getString('loai') || 'tatca'
      );
    }
    await interaction.editReply({ content: text.slice(0, 1990), allowedMentions: { parse: [] } });
  } catch (error) {
    console.error('[voiceStats] Lỗi slash command:', error.message);
    const msg = `❌ Có lỗi khi xử lý lệnh: ${error.message}`;
    if (interaction.deferred || interaction.replied) await interaction.editReply(msg).catch(() => {});
    else await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
  }
});

// ---- Prefix: nm!voice | nm!voicestats [tuan|thang|tatca] [bc|scrim] | nm!lich
client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot || !message.content) return;
    const parts = message.content.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    if (!['nm!voice', 'nm!voicestats', 'nm!lich'].includes(cmd)) return;
    if (!isBotReady()) {
      await replyNotReadyToMessage(message);
      return;
    }
    let text;
    if (cmd === 'nm!voice') text = await buildLiveVoiceText();
    else if (cmd === 'nm!lich') text = buildScheduleText();
    else text = await buildStatsText(parseRange(parts[1]), parseType(parts[2] || parts[1]));
    await message.reply({ content: text.slice(0, 1990), allowedMentions: { parse: [], repliedUser: false } });
  } catch (error) {
    console.error('[voiceStats] Lỗi lệnh nm!:', error.message);
    await message.reply(`❌ Có lỗi khi xử lý lệnh: ${error.message}`).catch(() => {});
  }
});

module.exports = { VOICESTATS_SLASH_COMMANDS, ensureVoiceStatsSheet, getLiveVoiceData, getVoiceStatsData };
