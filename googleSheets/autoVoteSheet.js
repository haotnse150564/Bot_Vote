// ===== RoleAutoVote sheet: log/backup của role auto-vote + thao tác kèm theo =====
// Tách khỏi voteSheet.js.

const { google } = require('./googleClient');
const client = require('../client');
const { getGoogleAuthClient } = require('./auth');
const { refreshResultSheet } = require('./resultSheet');
const {
  SPREADSHEET_ID,
  AUTOVOTE_SHEET_NAME,
  AUTOVOTE_ROLE_ID,
} = require('../config');
const { ensureVoteSheetExists, ensureSheetHeaders } = require('./voteSheetSetup');
const { runExclusive } = require('./voteLock');
const {
  readVoteRows,
  splitUserEntries,
  deleteVoteRows,
  buildAutoRows,
  appendVoteRows,
  missingAutoDays,
} = require('./voteRows');

// ---- Đọc danh sách người có role auto-vote ----
// TRƯỚC ĐÂY: guild.members.fetch() (gateway, tải TOÀN BỘ member) bọc trong
// try/catch trả về [] khi lỗi. Gateway rất hay timeout/bị rate-limit
// ("Members didn't arrive in time") -> hàm trả [] như thể role KHÔNG có ai ->
// (1) không tự vote cho ai cả, (2) syncAutoVoteSheetWithRole() clear sheet
// rồi ghi danh sách rỗng => sheet RoleAutoVote "mất hết". Không phân biệt
// được "role rỗng thật" với "đọc lỗi".
// GIỜ: hàm đọc NÉM LỖI khi thất bại (không còn trả [] giả), thử lần lượt
// cache đủ -> REST phân trang (guild.members.list, không qua gateway) ->
// gateway; nơi gọi tự quyết định fallback, và sheet KHÔNG bị ghi đè khi đọc lỗi.
const AUTOVOTE_FETCH_TTL_MS = 15 * 1000; // gộp các lần gọi dồn dập (vd vừa tạo tin vote vừa sync sheet)
const MEMBERS_REST_PAGE_SIZE = 1000; // tối đa của Discord cho GET /guilds/{id}/members
const MEMBERS_REST_MAX_PAGES = 200;

let lastKnownRoleMemberIds = null; // lần đọc Discord THÀNH CÔNG gần nhất
let lastFetchAt = 0;
let inflightFetch = null;

async function ensureAutoVoteSheetExists(authClient) {
  if (!SPREADSHEET_ID) {
    return;
  }

  const sheets = google.sheets({ version: 'v4', auth: authClient });
  const response = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existingSheets = response.data.sheets || [];
  const exists = existingSheets.some((sheet) => sheet.properties.title === AUTOVOTE_SHEET_NAME);

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: {
        requests: [
          {
            addSheet: {
              properties: {
                title: AUTOVOTE_SHEET_NAME,
              },
            },
          },
        ],
      },
    });
  }
}

// NOTE: the RoleAutoVote sheet's header/rows are fully rewritten by
// syncAutoVoteSheetWithRole() below each time it runs, since role membership
// is the source of truth and the sheet is only a log/backup mirror of it.

// Role 1539139333205008534 is the SOURCE OF TRUTH for who is auto-voting.
// Requires the GuildMembers privileged intent (see client intents in client.js).

// Duyệt REST GET /guilds/{id}/members theo trang 1000 người (không qua
// gateway nên không bị timeout/rate-limit kiểu opcode 8) và lọc theo role.
async function listRoleMemberIdsViaRest(guild) {
  const ids = [];
  let after = '0';

  for (let page = 0; page < MEMBERS_REST_MAX_PAGES; page += 1) {
    const batch = await guild.members.list({ limit: MEMBERS_REST_PAGE_SIZE, after });

    if (!batch.size) break;

    let maxId = after;

    for (const [id, member] of batch) {
      if (member.roles.cache.has(AUTOVOTE_ROLE_ID)) {
        ids.push(id);
      }
      if (BigInt(id) > BigInt(maxId)) {
        maxId = id;
      }
    }

    if (batch.size < MEMBERS_REST_PAGE_SIZE) break;
    after = maxId;
  }

  return ids;
}

// Đọc thẳng từ Discord. NÉM LỖI nếu không đọc được (kể cả không tìm thấy role).
async function readRoleMemberIdsFromDiscord(guild) {
  const role = guild.roles.cache.get(AUTOVOTE_ROLE_ID) || await guild.roles.fetch(AUTOVOTE_ROLE_ID);

  if (!role) {
    throw new Error(`Không tìm thấy role auto-vote ${AUTOVOTE_ROLE_ID} trong guild ${guild.id}.`);
  }

  // 1) Cache member đã đầy đủ (intent GuildMembers giữ cache luôn cập nhật)
  //    -> khỏi gọi mạng.
  if (guild.memberCount && guild.members.cache.size >= guild.memberCount) {
    return [...role.members.keys()];
  }

  // 2) REST phân trang — đường chính khi cache chưa đủ.
  let restError;

  try {
    return await listRoleMemberIdsViaRest(guild);
  } catch (error) {
    restError = error;
    console.warn(`[auto-vote] Đọc member qua REST lỗi (${error.message}), thử gateway...`);
  }

  // 3) Gateway (cách cũ) — phương án cuối.
  try {
    await guild.members.fetch({ time: 60 * 1000 });
    return [...role.members.keys()];
  } catch (gatewayError) {
    throw new Error(`REST: ${restError.message} | Gateway: ${gatewayError.message}`);
  }
}

// Có TTL ngắn + gộp request đang chạy để tránh gọi trùng. force=true bỏ qua
// TTL (dùng ngay sau khi vừa thêm/gỡ role, hoặc khi bấm "Đồng bộ vote" trên web).
async function fetchAutoVoteRoleMemberIds(guild, { force = false } = {}) {
  if (!guild) {
    throw new Error('Không có guild để đọc role auto-vote.');
  }

  if (!force) {
    if (lastKnownRoleMemberIds && Date.now() - lastFetchAt < AUTOVOTE_FETCH_TTL_MS) {
      return lastKnownRoleMemberIds;
    }
    if (inflightFetch) {
      return inflightFetch;
    }
  }

  const run = (async () => {
    const ids = await readRoleMemberIdsFromDiscord(guild);
    lastKnownRoleMemberIds = ids;
    lastFetchAt = Date.now();
    return ids;
  })();

  inflightFetch = run;
  const clear = () => {
    if (inflightFetch === run) inflightFetch = null;
  };
  run.then(clear, clear);

  return run;
}

// Đọc lại danh sách userId đã lưu ở sheet RoleAutoVote (chỉ dùng làm phương
// án dự phòng khi Discord không đọc được). Trả về null nếu không đọc được.
async function readAutoVoteIdsFromSheet() {
  if (!SPREADSHEET_ID) return null;

  try {
    const authClient = await getGoogleAuthClient();
    if (!authClient) return null;

    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${AUTOVOTE_SHEET_NAME}!A2:A`,
    });

    return (response.data.values || [])
      .map((row) => (row[0] !== undefined && row[0] !== null ? String(row[0]).trim() : ''))
      .filter(Boolean);
  } catch (error) {
    console.error('[auto-vote] Không đọc được sheet RoleAutoVote để dự phòng:', error.message);
    return null;
  }
}

// Trả về { ids, source, error }:
//   source = 'discord' (đọc mới thành công) | 'memory' (Discord lỗi, dùng lần
//   đọc thành công gần nhất) | 'sheet' (dùng sheet RoleAutoVote) | 'none'.
// Nơi gọi dùng source để biết dữ liệu có "tươi" không (web hiển thị cảnh báo).
async function getAutoVoteRoleMembers(guild, { force = false } = {}) {
  try {
    const ids = await fetchAutoVoteRoleMemberIds(guild, { force });
    return { ids: [...ids], source: 'discord', error: null };
  } catch (error) {
    console.error('❌ [auto-vote] Không đọc được danh sách người có role auto-vote từ Discord:', error.message);

    if (lastKnownRoleMemberIds) {
      return { ids: [...lastKnownRoleMemberIds], source: 'memory', error: error.message };
    }

    const sheetIds = await readAutoVoteIdsFromSheet();

    if (sheetIds) {
      return { ids: sheetIds, source: 'sheet', error: error.message };
    }

    return { ids: [], source: 'none', error: error.message };
  }
}

// Giữ tên cũ cho code gọi cũ — chỉ trả mảng userId (đã có fallback ở trên).
async function getAutoVoteRoleMemberIds(guild, options) {
  const { ids } = await getAutoVoteRoleMembers(guild, options);
  return ids;
}

// Lấy username để ghi vào BotVote — ưu tiên cache (member/user) để không phải
// gọi REST từng người (trước đây N người auto-vote = N request tuần tự, làm
// chậm nút "Đồng bộ vote" trên web).
async function resolveUsername(guild, userId) {
  const cachedMember = guild && guild.members && guild.members.cache.get(userId);

  if (cachedMember && cachedMember.user) {
    return cachedMember.user.username || userId;
  }

  const cachedUser = client.users.cache.get(userId);

  if (cachedUser) {
    return cachedUser.username || cachedUser.tag || userId;
  }

  try {
    const userObj = await client.users.fetch(userId);
    return userObj.username || userObj.tag || userId;
  } catch (fetchError) {
    return userId; // fallback: dùng userId làm username
  }
}

// Mirrors current role membership into the RoleAutoVote sheet as a log/backup.
// The sheet is NOT the source of truth — it's just a readable record of who
// currently holds the auto-vote role, refreshed whenever this is called.
// Trả về mảng userId đã ghi, hoặc null nếu KHÔNG đọc được role từ Discord —
// khi đó sheet được GIỮ NGUYÊN (không còn bị xoá trắng như trước).
async function syncAutoVoteSheetWithRole(guild, { force = false } = {}) {
  if (!SPREADSHEET_ID || !guild) {
    return null;
  }

  let memberIds;

  try {
    memberIds = await fetchAutoVoteRoleMemberIds(guild, { force });
  } catch (error) {
    console.error('❌ [auto-vote] Bỏ qua sync sheet RoleAutoVote (không đọc được role, giữ nguyên sheet):', error.message);
    return null;
  }

  const authClient = await getGoogleAuthClient();

  if (!authClient) {
    return null;
  }

  try {
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    await ensureAutoVoteSheetExists(authClient);

    const rows = [['userId'], ...memberIds.map((id) => [id])];

    // Ghi dữ liệu mới TRƯỚC rồi mới xoá phần thừa bên dưới — nếu bước ghi lỗi
    // thì dữ liệu cũ vẫn còn (trước đây clear trước, ghi lỗi là mất sạch).
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${AUTOVOTE_SHEET_NAME}!A1:A${rows.length}`,
      valueInputOption: 'RAW',
      resource: {
        values: rows,
      },
    });

    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `${AUTOVOTE_SHEET_NAME}!A${rows.length + 1}:Z`,
    });

    console.log(`Synced RoleAutoVote sheet (log/backup) with role membership: ${memberIds.length} user(s).`);
    return memberIds;
  } catch (error) {
    console.error('Failed to sync auto-vote sheet with role membership:', error.message);
    return null;
  }
}

// Xoá các dòng auto (reaction === 'auto') của 1 người khỏi BotVote. Chạy qua
// runExclusive() để không đè lên các thao tác ghi khác.
async function removeAutoVoteRowsForUser(userId) {
  if (!SPREADSHEET_ID) {
    return;
  }

  const authClient = await getGoogleAuthClient();

  if (!authClient) {
    return;
  }

  const changed = await runExclusive(async () => {
    try {
      const sheets = google.sheets({ version: 'v4', auth: authClient });
      const data = await readVoteRows(sheets);

      if (!data) {
        return false;
      }

      const { auto } = splitUserEntries(data.entries, userId);

      if (!auto.length) {
        return false;
      }

      await deleteVoteRows(sheets, data.sheetId, auto.map((entry) => entry.rowNumber));
      console.log(`Removed auto-vote rows for user ${userId}.`);
      return true;
    } catch (error) {
      console.error('Failed to remove auto-vote rows for user:', error.message);
      return false;
    }
  });

  if (changed) {
    await refreshResultSheet();
  }
}

// Đồng bộ vote auto của RIÊNG 1 người theo trạng thái role hiện tại của họ —
// gọi ngay khi họ tích/bỏ ✅ hoặc khi role bị gắn/gỡ bằng cách khác.
//   enabled = true  (có role): bot điền Thứ 4/5/6 hộ, TRỪ KHI người đó đã có vote
//                    tay (khi đó vote của họ chỉ theo đúng những gì họ tự tích và
//                    các dòng auto thừa, nếu có, bị xoá).
//   enabled = false (mất role): xoá dòng auto của họ; vote tay giữ nguyên.
// Idempotent — gọi nhiều lần không sinh dòng trùng. Trả về true nếu sheet có đổi.
async function syncAutoVoteRowsForUser({ guildId, channelId, messageId, userId, username, enabled }) {
  if (!SPREADSHEET_ID || !messageId || !channelId) {
    return false;
  }

  const authClient = await getGoogleAuthClient();

  if (!authClient) {
    return false;
  }

  const changed = await runExclusive(async () => {
    try {
      const sheets = google.sheets({ version: 'v4', auth: authClient });

      await ensureSheetHeaders(authClient);

      const data = await readVoteRows(sheets);

      if (!data) {
        return false;
      }

      const { manual, auto } = splitUserEntries(data.entries, userId);

      if (!enabled || manual.length > 0) {
        if (!auto.length) {
          return false;
        }

        await deleteVoteRows(sheets, data.sheetId, auto.map((entry) => entry.rowNumber));
        console.log(`[auto-vote] Gỡ vote auto của user ${userId} (${enabled ? 'đã vote tay' : 'mất role'}).`);
        return true;
      }

      const missing = missingAutoDays(auto);

      if (!missing.length) {
        return false;
      }

      await appendVoteRows(sheets, buildAutoRows({
        guildId,
        channelId,
        messageId,
        userId,
        username: username || userId,
        days: missing,
      }));
      console.log(`[auto-vote] Điền vote auto Thứ 4/5/6 cho user ${userId}.`);
      return true;
    } catch (error) {
      console.error(`[auto-vote] Lỗi đồng bộ vote auto cho user ${userId}:`, error.message);
      return false;
    }
  });

  if (changed) {
    await refreshResultSheet();
  }

  return changed;
}

// Chạy ngay sau khi tạo tin vote scrim mới: điền Thứ 4/5/6 cho mọi người có
// role auto-vote. Idempotent + tôn trọng vote tay:
//   - Người ĐÃ có vote tay -> KHÔNG điền auto (và xoá dòng auto thừa nếu có).
//   - Người đã có đủ dòng auto -> không thêm trùng.
//   - Khi đọc role mới từ Discord thành công, dòng auto của người KHÔNG còn role
//     cũng bị dọn.
async function saveAutoVoteRows(voteMessage) {
  if (!SPREADSHEET_ID) {
    return;
  }

  // Role membership is the source of truth; also refresh the log/backup sheet
  // (chỉ khi vừa đọc được role từ Discord — nếu lỗi thì giữ nguyên sheet).
  const autoVote = await getAutoVoteRoleMembers(voteMessage.guild, { force: true });
  const autoVoteUserIds = autoVote.ids.map((id) => String(id).trim());
  const fromDiscord = autoVote.source === 'discord';

  if (fromDiscord) {
    await syncAutoVoteSheetWithRole(voteMessage.guild);
  } else {
    console.warn(`[auto-vote] Tạo tin vote nhưng KHÔNG đọc mới được role từ Discord (nguồn dự phòng: ${autoVote.source}, ${autoVoteUserIds.length} người).`);
  }

  // Không đọc được role và cũng không có danh sách dự phòng -> không làm gì
  // (tránh xoá nhầm). Đọc được từ Discord thì kể cả 0 người vẫn phải dọn auto thừa.
  if (!autoVoteUserIds.length && !fromDiscord) {
    return;
  }

  const authClient = await getGoogleAuthClient();

  if (!authClient) {
    return;
  }

  const changed = await runExclusive(async () => {
    try {
      const sheets = google.sheets({ version: 'v4', auth: authClient });

      await ensureVoteSheetExists(authClient);
      await ensureSheetHeaders(authClient);

      const data = await readVoteRows(sheets);

      if (!data) {
        return false;
      }

      const roleSet = new Set(autoVoteUserIds);
      const rowsToDelete = [];
      const rowsToAppend = [];
      const userIdsWithEntries = new Set(data.entries.map((entry) => entry.userId));

      // Dọn dòng auto thừa: người đã vote tay, hoặc (khi đọc role từ Discord
      // thành công) người không còn role.
      for (const userId of userIdsWithEntries) {
        const { manual, auto } = splitUserEntries(data.entries, userId);

        if (!auto.length) continue;

        if (manual.length > 0 || (fromDiscord && !roleSet.has(userId))) {
          rowsToDelete.push(...auto.map((entry) => entry.rowNumber));
        }
      }

      for (const userId of roleSet) {
        const { manual, auto } = splitUserEntries(data.entries, userId);

        if (manual.length > 0) continue;

        const missing = missingAutoDays(auto);

        if (!missing.length) continue;

        const username = await resolveUsername(voteMessage.guild, userId);

        rowsToAppend.push(...buildAutoRows({
          guildId: voteMessage.guildId,
          channelId: voteMessage.channelId,
          messageId: voteMessage.id,
          userId,
          username,
          days: missing,
        }));
      }

      await deleteVoteRows(sheets, data.sheetId, rowsToDelete);
      await appendVoteRows(sheets, rowsToAppend);

      console.log(`Auto-vote: thêm ${rowsToAppend.length} dòng, dọn ${rowsToDelete.length} dòng thừa.`);
      return rowsToDelete.length > 0 || rowsToAppend.length > 0;
    } catch (error) {
      console.error('Failed to save auto-vote rows to Google Sheets:', error.message);
      return false;
    }
  });

  if (changed) {
    await refreshResultSheet();
  }
}

module.exports = {
  ensureAutoVoteSheetExists,
  getAutoVoteRoleMemberIds,
  getAutoVoteRoleMembers,
  resolveUsername,
  syncAutoVoteSheetWithRole,
  removeAutoVoteRowsForUser,
  syncAutoVoteRowsForUser,
  saveAutoVoteRows,
};
