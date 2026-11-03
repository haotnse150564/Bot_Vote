// ===== Hub — "gác cổng" tin nhắn của kênh menu =====
// Kênh HUB_CHANNEL_ID (config.js) chỉ nên có ĐÚNG 1 tin menu của bot. Người dùng
// chỉ được nhắn vào đây khi ĐANG CÓ 1 PHIÊN CHỜ GỬI (đã bấm nút của 1 tính năng
// cần gửi ảnh và bot đang đợi họ gửi — vd Check Gear, /bcstat). Mọi tin khác
// (nhắn nhầm, spam, tin không kèm file...) bị xoá. Đây là phần THÊM VÀO — không
// sửa luồng xử lý của các tính năng, chỉ "đứng ngoài" quyết định giữ hay xoá.
//
// Gồm 2 lớp:
//   1. XOÁ NGAY: mỗi tin người dùng mới vào kênh Hub -> nếu không thuộc phiên chờ
//      nào thì xếp vào hàng đợi xoá (xử lý CHẬM, GOM LÔ, xem "Hàng đợi xoá").
//   2. DỌN ĐỊNH KỲ: cứ mỗi HUB_AUTO_CLEAR_MINUTES phút quét lại kênh, xoá tin sót
//      (bot restart làm mất sự kiện, xoá lỗi tạm thời, thông báo tạm của bot mà
//      timer xoá đã mất...). Tin menu + tin ghim + tin vote scrim/bang chiến được
//      BẢO VỆ, và nếu tin menu bị xoá tay thì tự đăng lại.
//
// CÁCH 1 TÍNH NĂNG BÁO "TÔI ĐANG CHỜ NGƯỜI NÀY GỬI":
//   registerAwaitProvider('ten', (userId, channelId) => boolean)
// Trả về trạng thái THẬT tại thời điểm hỏi (đọc thẳng Map phiên của tính năng
// đó) nên không bao giờ lệch nhau, cũng không cần nhớ "đóng phiên" ở nhiều chỗ.
// Provider ném lỗi -> coi như ĐANG CHỜ (thà giữ nhầm 1 tin còn hơn xoá mất ảnh
// người dùng đang gửi).
//
// CLAIM: 1 tính năng nhận tin của người đang chờ có thể XOÁ phiên chờ ngay khi
// bắt đầu xử lý (bcstat làm vậy). Để lớp "xoá ngay" không hiểu nhầm đó là tin
// rác rồi xoá mất ảnh gốc TRƯỚC khi tính năng kia kịp tải, tính năng phải gọi
// claimMessage(message.id) ĐỒNG BỘ ngay lúc nhận tin.
//
// Quyền bot cần ở kênh Hub: View Channel, Read Message History, Manage Messages.

const { Events, SnowflakeUtil } = require('discord.js');
const client = require('../client');
const { HUB_CHANNEL_ID, HUB_GUARD_ENABLED, HUB_AUTO_CLEAR_MINUTES, HUB_SWEEP_MIN_AGE_MS } = require('../config');
const { scrimData, bcData } = require('../state');
const { isBotReady } = require('../utils/readyGate');
const { HUB_BUTTON_IDS } = require('./format');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- Phiên chờ gửi (do từng tính năng đăng ký) ----------
const awaitProviders = new Map(); // tên -> (userId, channelId) => boolean

function registerAwaitProvider(name, fn) {
  awaitProviders.set(name, fn);
}

function isUserAwaiting(userId, channelId) {
  for (const [name, fn] of awaitProviders) {
    try {
      if (fn(userId, channelId)) return true;
    } catch (error) {
      console.error(`[HubGuard] Provider "${name}" lỗi (coi như đang chờ để giữ tin):`, error.message);
      return true;
    }
  }
  return false;
}

// ---------- Claim: tin đang được 1 tính năng xử lý ----------
const CLAIM_TTL_MS = 10 * 60 * 1000;
const claimedMessages = new Map(); // messageId -> hết hạn lúc (ms)

function claimMessage(messageId) {
  if (!messageId) return;
  if (claimedMessages.size > 500) {
    const now = Date.now();
    for (const [id, expiresAt] of claimedMessages) {
      if (expiresAt < now) claimedMessages.delete(id);
    }
  }
  claimedMessages.set(messageId, Date.now() + CLAIM_TTL_MS);
}

function isClaimed(messageId) {
  const expiresAt = claimedMessages.get(messageId);
  if (!expiresAt) return false;
  if (expiresAt < Date.now()) {
    claimedMessages.delete(messageId);
    return false;
  }
  return true;
}

// ---------- Tin menu (được bảo vệ) ----------
let menuMessageId = null;

function setMenuMessageId(messageId) {
  menuMessageId = messageId || null;
}

function getMenuMessageId() {
  return menuMessageId;
}

// ---------- Luật giữ / xoá ----------
// Tin của NGƯỜI DÙNG: giữ khi (a) đang được 1 tính năng xử lý (claim) hoặc (b)
// người gửi đang có phiên chờ VÀ tin có đính kèm file. Tin chỉ có chữ của người
// đang chờ vẫn bị xoá — mọi tính năng ở Hub chỉ chờ ẢNH, không chờ chữ.
function shouldKeepUserMessage(message) {
  if (isClaimed(message.id)) return true;
  const hasFile = message.attachments && message.attachments.size > 0;
  return Boolean(hasFile && message.author && isUserAwaiting(message.author.id, message.channelId));
}

function hasHubMenuButtons(message) {
  const rows = Array.isArray(message.components) ? message.components : [];
  return rows.some((row) => (row.components || []).some((component) => HUB_BUTTON_IDS.includes(component.customId)));
}

// Tin KHÔNG BAO GIỜ bị dọn định kỳ (dù là của bot hay người).
function isProtectedMessage(message) {
  if (message.pinned) return true;
  if (menuMessageId && message.id === menuMessageId) return true;
  if (scrimData && scrimData.messageId && message.id === scrimData.messageId) return true;
  if (bcData && bcData.messageId && message.id === bcData.messageId) return true;
  if (client.user && message.author && message.author.id === client.user.id && hasHubMenuButtons(message)) return true;
  return false;
}

function shouldSweepMessage(message, now) {
  if (isProtectedMessage(message)) return false;
  if (now - message.createdTimestamp < HUB_SWEEP_MIN_AGE_MS) return false; // còn "non": đang xử lý / thông báo tạm
  if (message.author && message.author.bot) return true; // tin bot còn sót ngoài danh sách bảo vệ
  return !shouldKeepUserMessage(message);
}

// ---------- Hàng đợi xoá: CHẬM mà CHẮC ----------
// - 1 worker duy nhất, không bao giờ xoá song song -> không dồn dập request.
// - Chờ DELETE_SETTLE_MS để gom các tin vào cùng lúc (burst spam) thành 1 lô, lô
//   >= 2 tin dùng bulkDelete (1 request/tối đa 100 tin) thay vì xoá từng tin.
// - Giữa 2 lô nghỉ DELETE_PASS_GAP_MS. Rate limit 429 do discord.js REST tự xếp hàng.
// - Trùng ID chỉ xếp 1 lần. Hàng đầy (DELETE_MAX_QUEUE) thì bỏ qua tin mới — lần
//   dọn định kỳ sẽ xoá bù, không có gì bị bỏ sót vĩnh viễn.
// - Lỗi tạm thời (mạng/5xx) thử lại 3 lần với độ trễ tăng dần; "Unknown Message"
//   (đã bị xoá rồi) coi như xong; thiếu quyền -> dừng lô + cảnh báo (không lặp spam log).
const DELETE_SETTLE_MS = 400;
const DELETE_PASS_GAP_MS = 1000;
const DELETE_BATCH_SIZE = 100;
const DELETE_MAX_QUEUE = 2000;
const DELETE_RETRY_DELAYS_MS = [1000, 3000, 8000];
const BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000; // chừa 1 tiếng an toàn

const deleteQueue = [];
const queuedIds = new Set();
let drainTimer = null;
let draining = false;
let lastPermissionWarnAt = 0;

function isPermissionError(error) {
  return Boolean(error && (error.code === 50013 || error.code === 50001 || error.status === 403));
}

function isUnknownMessageError(error) {
  return Boolean(error && (error.code === 10008 || error.status === 404));
}

function warnPermissionOnce(error) {
  const now = Date.now();
  if (now - lastPermissionWarnAt < 60 * 1000) return;
  lastPermissionWarnAt = now;
  console.error(
    `[HubGuard] Bot thiếu quyền ở kênh Hub ${HUB_CHANNEL_ID} (cần Manage Messages + Read Message History): ${error.message}`
  );
}

function isBulkDeletable(messageId) {
  try {
    return Date.now() - SnowflakeUtil.timestampFrom(messageId) < BULK_DELETE_MAX_AGE_MS;
  } catch (error) {
    return false;
  }
}

async function getHubChannel() {
  try {
    return client.channels.cache.get(HUB_CHANNEL_ID) || (await client.channels.fetch(HUB_CHANNEL_ID));
  } catch (error) {
    console.error('[HubGuard] Không lấy được kênh Hub:', error.message);
    return null;
  }
}

function enqueueDelete(messageId) {
  if (!messageId || queuedIds.has(messageId)) return false;
  if (deleteQueue.length >= DELETE_MAX_QUEUE) return false;
  queuedIds.add(messageId);
  deleteQueue.push(messageId);
  scheduleDrain(DELETE_SETTLE_MS);
  return true;
}

function scheduleDrain(delayMs) {
  if (drainTimer || draining) return;
  drainTimer = setTimeout(() => {
    drainTimer = null;
    drainDeleteQueue().catch((error) => console.error('[HubGuard] Lỗi hàng đợi xoá:', error.message));
  }, delayMs);
}

// 1 lượt xoá cho `ids`: trả về danh sách ID CÒN LẠI (xoá lỗi tạm thời, cần thử lại).
async function deleteOnce(channel, ids) {
  let rest = ids;

  if (ids.length >= 2) {
    const bulkable = ids.filter(isBulkDeletable);
    if (bulkable.length >= 2) {
      try {
        const deleted = await channel.bulkDelete(bulkable, true);
        const done = new Set([...deleted.keys()]);
        rest = ids.filter((id) => !done.has(id));
      } catch (error) {
        if (isPermissionError(error)) throw error;
        // Lỗi khác (mạng/429...) -> rơi xuống xoá từng tin bên dưới.
      }
    }
  }

  const failed = [];
  for (const id of rest) {
    try {
      await channel.messages.delete(id);
    } catch (error) {
      if (isUnknownMessageError(error)) continue; // đã bị xoá rồi
      if (isPermissionError(error)) throw error;
      failed.push(id);
    }
  }
  return failed;
}

async function deleteBatch(channel, ids) {
  let remaining = ids;
  for (let attempt = 0; attempt <= DELETE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      remaining = await deleteOnce(channel, remaining);
    } catch (error) {
      if (isPermissionError(error)) warnPermissionOnce(error);
      else console.error('[HubGuard] Lỗi xoá lô tin nhắn Hub:', error.message);
      return; // hết cách — lần dọn định kỳ sau sẽ thử lại
    }
    if (!remaining.length) return;
    if (attempt === DELETE_RETRY_DELAYS_MS.length) {
      console.error(`[HubGuard] Bỏ qua ${remaining.length} tin xoá lỗi sau khi thử lại (sẽ dọn ở lượt định kỳ).`);
      return;
    }
    await sleep(DELETE_RETRY_DELAYS_MS[attempt]);
  }
}

async function drainDeleteQueue() {
  if (draining) return;
  draining = true;
  try {
    const channel = await getHubChannel();
    if (!channel) {
      deleteQueue.length = 0;
      queuedIds.clear();
      return;
    }
    while (deleteQueue.length) {
      const batch = deleteQueue.splice(0, DELETE_BATCH_SIZE);
      batch.forEach((id) => queuedIds.delete(id));
      // eslint-disable-next-line no-await-in-loop -- CỐ Ý tuần tự từng lô.
      await deleteBatch(channel, batch);
      // eslint-disable-next-line no-await-in-loop
      if (deleteQueue.length) await sleep(DELETE_PASS_GAP_MS);
    }
  } finally {
    draining = false;
    if (deleteQueue.length) scheduleDrain(DELETE_PASS_GAP_MS);
  }
}

// ---------- Lớp 1: xoá NGAY tin không thuộc phiên chờ nào ----------
client.on(Events.MessageCreate, (message) => {
  try {
    if (!HUB_GUARD_ENABLED || !HUB_CHANNEL_ID) return;
    if (message.channelId !== HUB_CHANNEL_ID) return;
    if (message.author && message.author.bot) return; // tin của bot: để tính năng tự xoá / lớp dọn định kỳ lo
    if (shouldKeepUserMessage(message)) return;
    enqueueDelete(message.id);
  } catch (error) {
    console.error('[HubGuard] Lỗi xử lý tin nhắn mới trong kênh Hub:', error.message);
  }
});

// ---------- Lớp 2: dọn định kỳ ----------
const SWEEP_PAGE_LIMIT = 100;
const SWEEP_MAX_PAGES = 10; // tối đa 1000 tin/lượt — quá thì lượt sau dọn tiếp
const SWEEP_PAGE_GAP_MS = 1500;
let sweeping = false;

async function sweepHubChannel({ ensureMenu } = {}) {
  if (!HUB_GUARD_ENABLED || !HUB_CHANNEL_ID) return;
  if (sweeping) return; // không chạy chồng 2 lượt dọn
  sweeping = true;
  try {
    if (!isBotReady()) return;
    const channel = await getHubChannel();
    if (!channel) return;

    // Tin menu bị xoá tay -> đăng lại (chỉ khi CHẮC là "Unknown Message", xem hub/index.js).
    if (ensureMenu) {
      try {
        await ensureMenu();
      } catch (error) {
        console.error('[HubGuard] Không kiểm tra/đăng lại được tin menu Hub:', error.message);
      }
    }

    let before = null;
    let scanned = 0;
    let queued = 0;
    for (let page = 0; page < SWEEP_MAX_PAGES; page += 1) {
      // eslint-disable-next-line no-await-in-loop
      const messages = await channel.messages.fetch(before ? { limit: SWEEP_PAGE_LIMIT, before } : { limit: SWEEP_PAGE_LIMIT });
      if (!messages.size) break;

      const now = Date.now();
      let oldestId = null;
      for (const message of messages.values()) {
        scanned += 1;
        if (!oldestId || BigInt(message.id) < BigInt(oldestId)) oldestId = message.id;
        if (shouldSweepMessage(message, now) && enqueueDelete(message.id)) queued += 1;
      }

      before = oldestId;
      if (messages.size < SWEEP_PAGE_LIMIT) break;
      // eslint-disable-next-line no-await-in-loop
      await sleep(SWEEP_PAGE_GAP_MS);
    }

    if (queued) console.log(`[HubGuard] Dọn định kỳ kênh Hub: quét ${scanned} tin, xếp xoá ${queued} tin.`);
  } catch (error) {
    console.error('[HubGuard] Lỗi dọn định kỳ kênh Hub:', error.message);
  } finally {
    sweeping = false;
  }
}

function startHubSweeper({ ensureMenu } = {}) {
  if (!HUB_GUARD_ENABLED || !HUB_CHANNEL_ID) {
    console.log('[HubGuard] Đang TẮT (HUB_GUARD_ENABLED=false hoặc chưa có HUB_CHANNEL_ID).');
    return;
  }
  if (!(HUB_AUTO_CLEAR_MINUTES > 0)) {
    console.log('[HubGuard] Dọn định kỳ đang tắt (HUB_AUTO_CLEAR_MINUTES=0) — vẫn xoá ngay tin không thuộc phiên chờ.');
    return;
  }
  setInterval(() => {
    sweepHubChannel({ ensureMenu }).catch((error) => console.error('[HubGuard] Lỗi lượt dọn định kỳ:', error.message));
  }, HUB_AUTO_CLEAR_MINUTES * 60 * 1000);
  console.log(`[HubGuard] Đã bật: xoá ngay tin không thuộc phiên chờ + dọn định kỳ mỗi ${HUB_AUTO_CLEAR_MINUTES} phút.`);
}

module.exports = {
  registerAwaitProvider,
  claimMessage,
  setMenuMessageId,
  getMenuMessageId,
  startHubSweeper,
  sweepHubChannel,
};
