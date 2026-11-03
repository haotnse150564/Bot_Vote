process.env.FONTCONFIG_PATH = require('path').join(__dirname, 'assets', 'fonts');

// Cân bằng tốc độ và RAM: cache libvips nhỏ để vẽ lại thẻ/bảng ảnh nhanh hơn, 2 luồng cho mỗi lần vẽ (sharp + font CJK).
{
  const sharp = require('sharp');
  sharp.cache({ memory: 50, items: 20 });
  sharp.concurrency(2);
}

// Chốt chặn cuối cho request bị treo hẳn: hủy sau 5 phút (đủ dài cho Gemini đọc ảnh, upload ảnh, Sheet/Drive chậm).
{
  const FETCH_TIMEOUT_MS = 5 * 60 * 1000;
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    if (init && init.signal) return nativeFetch(input, init);
    return nativeFetch(input, { ...(init || {}), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  };
}
const { Events } = require('discord.js');
const http = require('http');

const client = require('./client');
const { SPREADSHEET_ID, DISCORD_GUILD_ID, ADMIN_USER_ID } = require('./config');

const { getGoogleAuthClient } = require('./googleSheets/auth');
const { retryOnQuotaExceeded } = require('./utils/retry');
const { ensureVoteSheetExists, ensureAutoVoteSheetExists, syncAutoVoteSheetWithRole, resyncVoteSheetFromReactions } = require('./googleSheets/voteSheet');
const { ensureResultSheet } = require('./googleSheets/resultSheet');
const { ensureBcSheetExists } = require('./googleSheets/bcSheet');
const { ensureStateSheetExists, loadState } = require('./googleSheets/stateSheet');
const { loadAccessIds } = require('./googleSheets/accessIdSheet');
const { ensureVoteHistorySheetExists } = require('./googleSheets/voteHistorySheet');
const { ensureLichBangSheetExists, loadCustomScheduleEvents } = require('./googleSheets/lichBangSheet');
const { checkReminders } = require('./reminders/scheduler');
const { startPickRole, PICKROLE_SLASH_COMMANDS } = require('./pickRole');
const { SLASH_COMMANDS } = require('./commands/help');
const { scrimData, bcData } = require('./state');
const { ensureThiKiemSheetsExist, ensureThiKiemMessagesPosted, clearRecentUpdatesLog, THIKIEM_SLASH_COMMANDS } = require('./thiKiem');
const { ensureVinhDanhSheetsExist, ensureVinhDanhMessagesPosted, VINHDANH_SLASH_COMMANDS } = require('./vinhDanh');
const { ensureBcStatSheetsExist, BCSTAT_SLASH_COMMANDS } = require('./bcstat');
const { ensureVoiceStatsSheet, VOICESTATS_SLASH_COMMANDS } = require('./voiceStats');
const { ensureHubMessagePosted, startHubMaintenance } = require('./hub');
const { setBotReady } = require('./utils/readyGate');
const { resetFixedBoardChannels } = require('./utils/channelReset');

// Đăng ký các event handler theo từng tính năng (side-effect requires).
require('./commands/messageCommands'); // lệnh nm!: scrim/vote/bang chiến/ảnh vị trí
require('./commands/slashCommands'); // slash: scrim/vote/bang chiến/ảnh vị trí + /ping /help
require('./events/reactionEvents'); // react vote scrim / ✅ auto-vote / offline bang chiến
require('./events/roleGreet'); // chào khi được gắn role member bang
require('./events/autoVoteRoleEvents'); // đồng bộ role auto-vote khi bị gắn/gỡ bằng cách khác
require('./welcome'); // người MỚI vào server: tự gán role + gửi ảnh chào
require('./voiceStats'); // đếm người ngồi voice Bang Chiến/Scrim + /voice /voicestats /lich
require('./pickRole'); // Pick Role bằng react + /pickrole
require('./hub'); // menu Đua Rank / Vinh Danh / BC Stat
require('./thiKiem'); // Đua Rank Thí Kiếm Thiên Hạ
require('./vinhDanh'); // Sảnh Vinh Danh Bang Chiến
require('./bcstat'); // /bcstat

client.on('error', (error) => {
  console.error('❌ Discord client error:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled promise rejection:', reason);
});

// Lỗi ném đồng bộ trong listener/setInterval mà không ai catch sẽ làm Node thoát ngay -> chỉ log, giữ tiến trình sống.
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error);
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);

  // ===== KHỞI ĐỘNG CHIA 2 GIAI ĐOẠN — TRÁNH LỖI "Quota exceeded" CỦA GOOGLE SHEETS =====
  //   - GIAI ĐOẠN 1: tối thiểu dữ liệu để bot trả lời lệnh. Chạy XONG mới setBotReady(true).
  //   - GIAI ĐOẠN 2: dữ liệu phụ, chạy NGẦM, rải cách nhau vài giây, mỗi bước tự retry + try/catch riêng.
  async function safeStep(label, fn) {
    try {
      return await retryOnQuotaExceeded(fn, { label });
    } catch (error) {
      console.error(`❌ [Khởi động] Bước "${label}" thất bại (đã thử lại vẫn lỗi):`, error.message);
      return null;
    }
  }
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const DEFERRED_STEP_DELAY_MS = 4000;

  // ===== GIAI ĐOẠN 1: DỮ LIỆU CẦN DÙNG NGAY =====
  const authClient = await safeStep('getGoogleAuthClient', () => getGoogleAuthClient());
  if (authClient && SPREADSHEET_ID) {
    await safeStep('ensureStateSheetExists', () => ensureStateSheetExists(authClient));
    await safeStep('ensureVinhDanhSheetsExist', () => ensureVinhDanhSheetsExist());
    await safeStep('ensureThiKiemSheetsExist', () => ensureThiKiemSheetsExist());
    console.log('Ensured State/VinhDanh/ThiKiem sheets exist (Giai đoạn 1).');
  }

  // Khôi phục scrimData/bcData (lịch scrim, messageId đang active...) đã lưu từ lần chạy trước.
  await safeStep('loadState', () => loadState());
  await safeStep('loadAccessIds', () => loadAccessIds());

  // MỖI LẦN DEPLOY: dọn sạch kênh Hub (+ kênh Vinh Danh / Thí Kiếm nếu khác Hub) rồi đăng lại các tin cố định.
  await safeStep('resetFixedBoardChannels', () => resetFixedBoardChannels());
  await safeStep('ensureHubMessagePosted', () => ensureHubMessagePosted());
  await safeStep('ensureVinhDanhMessagesPosted', () => ensureVinhDanhMessagesPosted());
  await safeStep('ensureThiKiemMessagesPosted', () => ensureThiKiemMessagesPosted());
  startHubMaintenance();

  // Fetch lại message vote scrim / bang chiến cũ vào cache NGAY LÚC KHỞI ĐỘNG (API Discord, không tốn quota Sheets).
  try {
    if (scrimData.channelId && scrimData.messageId) {
      const scrimChannel = await client.channels.fetch(scrimData.channelId);
      await scrimChannel.messages.fetch(scrimData.messageId);
      console.log('Đã nạp lại message vote scrim cũ vào cache.');
    }
  } catch (error) {
    console.error('Không thể nạp lại message vote scrim cũ vào cache:', error.message);
  }

  try {
    if (bcData.channelId && bcData.messageId) {
      const bcChannel = await client.channels.fetch(bcData.channelId);
      await bcChannel.messages.fetch(bcData.messageId);
      console.log('Đã nạp lại message bang chiến cũ vào cache.');
    }
  } catch (error) {
    console.error('Không thể nạp lại message bang chiến cũ vào cache:', error.message);
  }

  let guild = null;
  try {
    // Slash command CHỈ đăng ký cho ĐÚNG 1 server (DISCORD_GUILD_ID).
    guild = await client.guilds.fetch(DISCORD_GUILD_ID);
    const allSlashCommands = [
      ...SLASH_COMMANDS,
      ...THIKIEM_SLASH_COMMANDS,
      ...VINHDANH_SLASH_COMMANDS,
      ...BCSTAT_SLASH_COMMANDS,
      ...VOICESTATS_SLASH_COMMANDS,
      ...PICKROLE_SLASH_COMMANDS,
    ];
    // Discord chỉ cho TỐI ĐA 100 slash command/server; vượt là TOÀN BỘ lần đăng ký bị từ chối.
    if (allSlashCommands.length > 100) console.error(`[slash] ${allSlashCommands.length} lệnh > 100 — Discord sẽ từ chối.`);
    await guild.commands.set(allSlashCommands);
    console.log(`Registered ${allSlashCommands.length} slash commands for guild ${DISCORD_GUILD_ID}.`);

    // Dọn global command còn sót (nếu có) để Discord không hiện lệnh double.
    await client.application.commands.set([]);
    console.log('Đã dọn sạch global slash commands cũ (nếu có).');
  } catch (error) {
    console.error('Failed to register slash commands:', error.message);
  }

  setInterval(checkReminders, 60 * 1000);
  console.log('Started reminder scheduler (checks every minute).');

  // ĐÁNH DẤU BOT ĐÃ SẴN SÀNG NGAY SAU GIAI ĐOẠN 1 (xem utils/readyGate.js).
  setBotReady(true);
  console.log('✅ Bot đã nạp xong dữ liệu cần dùng ngay (Giai đoạn 1), sẵn sàng phản hồi người dùng.');

  if (ADMIN_USER_ID) {
    try {
      const admin = await client.users.fetch(ADMIN_USER_ID);
      await admin.send('✅ Bot vừa deploy lại xong, các tính năng chính đã sẵn sàng. Đang nạp thêm dữ liệu phụ ở nền.');
    } catch (error) {
      console.error('Không gửi được DM báo admin bot đã sẵn sàng sau deploy:', error.message);
    }
  }

  // ===== GIAI ĐOẠN 2: DỮ LIỆU KHÔNG CẦN DÙNG NGAY (chạy NGẦM) =====
  (async function runDeferredStartup() {
    const failedSteps = [];
    async function deferredStep(label, fn) {
      await wait(DEFERRED_STEP_DELAY_MS);
      const result = await safeStep(label, fn);
      if (result === null) failedSteps.push(label);
      return result;
    }

    if (authClient && SPREADSHEET_ID) {
      await deferredStep('ensureVoteSheetExists', () => ensureVoteSheetExists(authClient));
      await deferredStep('ensureResultSheet', () => ensureResultSheet(authClient));
      await deferredStep('ensureBcSheetExists', () => ensureBcSheetExists(authClient));
      await deferredStep('ensureAutoVoteSheetExists', () => ensureAutoVoteSheetExists(authClient));
      await deferredStep('ensureVoteHistorySheetExists', () => ensureVoteHistorySheetExists(authClient));
      await deferredStep('ensureBcStatSheetsExist', () => ensureBcStatSheetsExist());
      await deferredStep('ensureVoiceStatsSheet', () => ensureVoiceStatsSheet());

      // Pick Role bằng react (hệ phái + hoạt động): nạp tab "Pick Role", đăng/đồng bộ các tin trong PICK_ROLE_CHANNEL_ID.
      await deferredStep('startPickRole', () => startPickRole());

      // Lịch Bang tuỳ chỉnh — chỉ để hiển thị /lich.
      await deferredStep('ensureLichBangSheetExists', () => ensureLichBangSheetExists(authClient));
      await deferredStep('loadCustomScheduleEvents', () => loadCustomScheduleEvents());

      // Nhật Ký Cập Nhật Đua Rank Thí Kiếm — tự xoá sạch mỗi 30 phút.
      setInterval(clearRecentUpdatesLog, 30 * 60 * 1000);
      console.log('Started Đua Rank Thí Kiếm recent-updates cleanup scheduler (clears every 30 minutes).');
    }

    // Làm mới sheet RoleAutoVote từ role thực tế trên Discord.
    if (guild) {
      await deferredStep('syncAutoVoteSheetWithRole', () => syncAutoVoteSheetWithRole(guild));
    }

    // Đồng bộ lại BotVote từ react thực tế trên tin vote đang mở (react lúc bot tắt không được ghi nhận).
    if (guild && authClient && SPREADSHEET_ID && scrimData.messageId && scrimData.channelId) {
      await deferredStep('resyncVoteSheetFromReactions', () => resyncVoteSheetFromReactions());
    }

    if (failedSteps.length) {
      console.warn(`⚠️ Giai đoạn 2: ${failedSteps.length} bước lỗi sau khi đã thử lại: ${failedSteps.join(', ')}.`);
    } else {
      console.log('✅ Bot đã nạp xong toàn bộ dữ liệu phụ (Giai đoạn 2).');
    }
  })().catch((error) => {
    console.error('❌ Lỗi không mong muốn trong luồng nạp dữ liệu nền (Giai đoạn 2):', error);
  });
});

const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error('❌ ERROR: DISCORD_TOKEN is not set. Please set the DISCORD_TOKEN environment variable.');
  process.exit(1);
}

// HTTP server tối giản (Railway healthcheck tuỳ chọn).
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'Bot Bang + Role is running!' }));
}).listen(PORT, () => {
  console.log(`✅ HTTP server listening on port ${PORT}`);
});

client.login(token);
