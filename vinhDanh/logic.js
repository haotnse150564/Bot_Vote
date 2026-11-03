// ===== Sảnh Vinh Danh Bang Chiến: hàm thuần logic (không đụng Discord API) =====
// Tách khỏi index.js: isAdmin, chuẩn hoá dữ liệu, gộp trùng, đồng bộ role.

const client = require('../client');
const { NPC_ROLE_ID, DISCORD_GUILD_ID, QUAN_LONG_CHI_CHU_TITLE, QUAN_LONG_CHI_CHU_ROLE_ID } = require('../config');
const { getVinhDanhConfig, setVinhDanhConfigValues } = require('../googleSheets/vinhDanhSheet');

function isAdmin(member) {
  return Boolean(member && member.roles && member.roles.cache.has(NPC_ROLE_ID));
}

function normalizeTitleKey(title) {
  return String(title || '').trim().toLowerCase();
}

// Thứ 7 gần nhất (kể cả hôm nay nếu hôm nay đã là Thứ 7) tính theo giờ VN —
// dùng làm "Ngày Vinh Danh" ghi vào sheet, vì lịch cập nhật cố định vào mỗi
// Thứ 7 hàng tuần.
function getMostRecentSaturdayStr(vnNow) {
  const weekday = vnNow.getDay(); // 0 = Chủ Nhật ... 6 = Thứ 7
  const daysSinceSaturday = (weekday - 6 + 7) % 7;
  const saturday = new Date(vnNow);
  saturday.setDate(vnNow.getDate() - daysSinceSaturday);
  const dd = String(saturday.getDate()).padStart(2, '0');
  const mm = String(saturday.getMonth() + 1).padStart(2, '0');
  const yyyy = saturday.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// So khớp Ingame đọc từ ảnh với danh sách tab "Bang" — ưu tiên khớp CHÍNH
// XÁC (bỏ khoảng trắng thừa 2 đầu), fallback khớp KHÔNG PHÂN BIỆT hoa/
// thường nếu không có khớp chính xác nào (đề phòng Gemini đọc sai hoa/
// thường 1-2 ký tự). Không khớp được thì trả về null — embed KHÔNG hiện tag
// Discord nữa (chỉ hiện tên ingame, xem vinhDanh/format.js) nên việc này
// giờ chỉ còn ảnh hưởng tới việc gắn/tháo role "Quần Long Chi Chủ"
// (syncQuanLongChiChuRole bên dưới cần đúng Discord ID mới gắn/tháo được).
function findDiscordIdByIngame(members, ingame) {
  if (!ingame) return null;
  const target = ingame.trim();
  const exact = members.find((m) => m.ingame === target);
  if (exact) return exact.discordId;
  const loose = members.find((m) => (m.ingame || '').trim().toLowerCase() === target.toLowerCase());
  return loose ? loose.discordId : null;
}

// entries: mảng phẳng [{ danhHieu, ingame, discordId, tran }] (có thể có 2
// dòng trùng danhHieu nếu tuần 2 trận). Gộp trùng: nếu 2 trận ra CÙNG 1
// ingame (không phân biệt hoa/thường) cho cùng 1 danh hiệu thì chỉ giữ 1
// dòng (bỏ nhãn Trận, vì không cần phân biệt nữa).
function dedupeEntries(entries) {
  const byDanhHieu = new Map();
  entries.forEach((e) => {
    if (!byDanhHieu.has(e.danhHieu)) byDanhHieu.set(e.danhHieu, []);
    byDanhHieu.get(e.danhHieu).push(e);
  });

  const result = [];
  byDanhHieu.forEach((list, danhHieu) => {
    const seen = new Set();
    const kept = [];
    list.forEach((e) => {
      const key = (e.ingame || '').trim().toLowerCase();
      if (key && seen.has(key)) return;
      if (key) seen.add(key);
      kept.push(e);
    });
    // Chỉ 1 người duy nhất cho danh hiệu này (dù đọc từ 1 hay 2 trận) -> bỏ
    // nhãn "Trận" (không cần thiết phải phân biệt nữa).
    if (kept.length === 1) kept[0] = { ...kept[0], tran: '' };
    kept.forEach((e) => result.push({ ...e, danhHieu }));
  });
  return result;
}

// Đồng bộ role QUAN_LONG_CHI_CHU_ROLE_ID theo đúng (các) người ĐANG giữ
// danh hiệu "Quần Long Chi Chủ" trong lô Vinh Danh vừa ghi (deduped — có
// thể có 2 người nếu tuần đó 2 trận ra 2 người khác nhau). Gọi sau MỖI lần
// appendVinhDanhBatch (kể cả khi mùa/tuần đó kết thúc và người giữ danh
// hiệu đổi sang người khác): so với danh sách người giữ CŨ đã lưu trong
// Vinh Danh Config (key quan_long_chi_chu_holder_ids, danh sách Discord ID
// cách nhau bằng dấu phẩy) -> THÁO role khỏi người không còn giữ nữa ->
// GẮN role cho người mới giữ -> lưu lại danh sách mới vào config. Chỉ tính
// người đã tra được Discord ID (theo Ingame, tab "Bang") — người chưa tra
// được ID thì bỏ qua (không gắn/tháo được gì, NPC tự bổ sung ID cho họ ở
// tab "Bang" nếu muốn).
async function syncQuanLongChiChuRole(dedupedEntries) {
  if (!QUAN_LONG_CHI_CHU_ROLE_ID) return;

  const targetKey = normalizeTitleKey(QUAN_LONG_CHI_CHU_TITLE);
  const newHolderIds = [
    ...new Set(
      dedupedEntries
        .filter((e) => normalizeTitleKey(e.danhHieu) === targetKey && e.discordId)
        .map((e) => String(e.discordId))
    ),
  ];

  const config = await getVinhDanhConfig();
  const oldHolderIds = (config.quan_long_chi_chu_holder_ids || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  const toRemove = oldHolderIds.filter((id) => !newHolderIds.includes(id));
  const toAdd = newHolderIds.filter((id) => !oldHolderIds.includes(id));

  if (toRemove.length || toAdd.length) {
    try {
      const guild = await client.guilds.fetch(DISCORD_GUILD_ID);

      for (const discordId of toRemove) {
        try {
          const member = await guild.members.fetch(discordId);
          await member.roles.remove(QUAN_LONG_CHI_CHU_ROLE_ID);
        } catch (error) {
          console.error(`Không tháo được role Quần Long Chi Chủ khỏi ${discordId}:`, error.message);
        }
      }

      for (const discordId of toAdd) {
        try {
          const member = await guild.members.fetch(discordId);
          await member.roles.add(QUAN_LONG_CHI_CHU_ROLE_ID);
        } catch (error) {
          console.error(`Không gắn được role Quần Long Chi Chủ cho ${discordId}:`, error.message);
        }
      }
    } catch (error) {
      console.error('Không fetch được server để đồng bộ role Quần Long Chi Chủ:', error.message);
    }
  }

  const oldKey = [...oldHolderIds].sort().join(',');
  const newKey = [...newHolderIds].sort().join(',');
  if (oldKey !== newKey) {
    await setVinhDanhConfigValues({ quan_long_chi_chu_holder_ids: newHolderIds.join(',') });
  }
}

module.exports = {
  isAdmin,
  normalizeTitleKey,
  getMostRecentSaturdayStr,
  findDiscordIdByIngame,
  dedupeEntries,
  syncQuanLongChiChuRole,
};
