// ===== BcStat sheet: tab Alias =====
// Bảng "tên gõ sai -> tên chuẩn": đọc map, áp alias lên dữ liệu vừa đọc và gộp
// 1 tên chưa khớp vào tên chuẩn (Cumulative + Record + Alias + Summary).

const { BCSTAT_SPREADSHEET_ID, BCSTAT_CUMULATIVE_SHEET_NAME, BCSTAT_ALIAS_SHEET_NAME } = require('../config');
const {
  CATEGORIES,
  CUMULATIVE_HEADER,
  getSheetsClient,
  colLetter,
  normalizeName,
} = require('./bcStatShared');
const { writeCumulativeState } = require('./bcStatCumulative');
const { mergeRecordsAlias } = require('./bcStatRecords');
const { computeAndWriteSummary } = require('./bcStatSummary');

// Đọc toàn bộ tab Alias -> Map(normalizedRawName -> canonicalDisplayName).
// canonicalDisplayName lấy ĐÚNG NHƯ NPC xác nhận lúc gộp (thường trùng tên
// trong tab "Bang") — dùng làm khoá chuẩn hoá khi cộng dồn Cumulative, xem
// resolveAliases() ngay bên dưới.
async function getAliasMap() {
  if (!BCSTAT_SPREADSHEET_ID) return new Map();
  const sheets = await getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: BCSTAT_SPREADSHEET_ID,
    range: `'${BCSTAT_ALIAS_SHEET_NAME}'!A2:B`,
  });
  const rows = response.data.values || [];
  const map = new Map();
  rows.forEach((row) => {
    const raw = (row[0] || '').trim();
    const canonical = (row[1] || '').trim();
    if (raw && canonical) map.set(normalizeName(raw), canonical);
  });
  return map;
}

// combined: Map(normalizedName -> {displayName, values}) — CÙNG kiểu dữ
// liệu 1 phiên vừa gửi (mục 8 spec: NPC gõ sai/tên nhân vật hiển thị khác
// tên trong tab "Bang"). Với MỖI người trong combined mà tên (đã chuẩn hoá)
// trùng khoá alias đã xác nhận trước đó -> đổi hẳn key + displayName sang
// tên CHUẨN đã lưu, để merge THẲNG vào đúng dòng Cumulative của người đó
// ngay từ bước ghi (updateCumulative), không cần gộp tay lại lần nữa cho
// đúng tên gõ sai y hệt về sau (mục "tự gộp thông tin bot đã nói" trong yêu
// cầu người dùng). Trả về Map MỚI (không sửa trực tiếp `combined` truyền vào).
async function resolveAliases(combined) {
  if (!combined || !combined.size) return combined;
  const aliasMap = await getAliasMap();
  if (!aliasMap.size) return combined;

  const resolved = new Map();
  combined.forEach((entry, key) => {
    const canonicalName = aliasMap.get(key);
    const finalKey = canonicalName ? normalizeName(canonicalName) : key;
    const finalDisplayName = canonicalName || entry.displayName;
    if (!resolved.has(finalKey)) {
      resolved.set(finalKey, { displayName: finalDisplayName, values: {} });
    }
    // Nếu 2 tên gõ khác nhau trong CÙNG 1 phiên cùng trỏ về 1 tên chuẩn
    // (hiếm nhưng có thể xảy ra), gộp giá trị lại luôn thay vì ghi đè mất.
    Object.assign(resolved.get(finalKey).values, entry.values);
  });
  return resolved;
}

// Gộp tên "rawName" (chưa khớp tab "Bang") vào ĐÚNG "canonicalName" (tên
// chuẩn NPC vừa xác nhận, mục "tự gộp thông tin bot đã nói" trong yêu cầu
// người dùng) — chuyển TOÀN BỘ các dòng (người=rawName, trận=bất kỳ) sang
// người=canonicalName: nếu canonicalName đã có sẵn dòng ở ĐÚNG trận đó thì
// gộp theo từng hạng mục (giá trị của rawName ưu tiên đè lên hạng mục nó CÓ,
// giữ nguyên giá trị của canonicalName ở hạng mục rawName không có — coi như
// rawName là dữ liệu "mới hơn" của cùng người/trận đó); nếu canonicalName
// CHƯA có dòng nào ở trận đó thì coi như đổi tên thẳng dòng của rawName.
// Sau khi gộp: xoá hết dòng rawName, LƯU LẠI alias (để lần lưu SAU tự động
// hiểu đúng, không hỏi lại) rồi tính lại Summary luôn cho gọn (trả thẳng kết
// quả computeAndWriteSummary() mới).
async function mergeUnmatchedAlias(rawName, canonicalName) {
  const rawKey = normalizeName(rawName);
  const canonicalKey = normalizeName(canonicalName);
  if (!rawKey || !canonicalKey) throw new Error('Thiếu tên gõ sai hoặc tên chuẩn để gộp.');

  const sheets = await getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: BCSTAT_SPREADSHEET_ID,
    range: `'${BCSTAT_CUMULATIVE_SHEET_NAME}'!A2:${colLetter(CUMULATIVE_HEADER.length - 1)}`,
  });
  const rows = response.data.values || [];

  // key = "<tên đã chuẩn hoá>\u0000<nhãn trận đã chuẩn hoá>"
  const state = new Map();
  let foundRaw = false;
  rows.forEach((row) => {
    const name = (row[0] || '').trim();
    const rowLabel = (row[1] || '').trim();
    if (!name || !rowLabel) return;
    const playerKey = normalizeName(name);
    if (playerKey === rawKey) foundRaw = true;
    const values = {};
    CATEGORIES.forEach((cat, idx) => {
      const raw = row[2 + idx];
      values[cat.key] = raw === undefined || raw === '' ? '' : Number(raw);
    });
    state.set(`${playerKey}\u0000${normalizeName(rowLabel)}`, { playerKey, displayName: name, matchLabel: rowLabel, values });
  });
  if (!foundRaw) throw new Error(`Không tìm thấy "${rawName}" trong dữ liệu (có thể đã được gộp trước đó).`);

  [...state.entries()]
    .filter(([, entry]) => entry.playerKey === rawKey)
    .forEach(([oldStateKey, entry]) => {
      const rowLabelKey = normalizeName(entry.matchLabel);
      const newStateKey = `${canonicalKey}\u0000${rowLabelKey}`;
      const existingCanonical = state.get(newStateKey);
      if (existingCanonical) {
        CATEGORIES.forEach((cat) => {
          const v = entry.values[cat.key];
          if (v !== '' && v !== undefined) existingCanonical.values[cat.key] = v;
        });
      } else {
        state.set(newStateKey, {
          playerKey: canonicalKey,
          displayName: canonicalName,
          matchLabel: entry.matchLabel,
          values: entry.values,
        });
      }
      state.delete(oldStateKey);
    });

  // Cập nhật lại displayName của TẤT CẢ dòng còn lại thuộc canonicalKey theo
  // đúng tên chuẩn vừa xác nhận (kể cả những dòng vốn đã là canonicalKey từ
  // trước, để nhất quán nếu NPC gõ hoa/thường khác đôi chút lúc xác nhận).
  state.forEach((entry) => {
    if (entry.playerKey === canonicalKey) entry.displayName = canonicalName;
  });

  await writeCumulativeState(sheets, state);

  // Gộp luôn Kỷ lục (tách riêng khỏi Cumulative — xem ghi chú đầu file) của
  // tên gõ sai vào tên chuẩn, không throw nếu lỗi (Cumulative vẫn đã gộp
  // thành công ở bước trên).
  try {
    await mergeRecordsAlias(sheets, rawKey, canonicalKey, canonicalName);
  } catch (error) {
    console.error('Lỗi khi gộp BC Stat - Kỷ Lục cho tên đã xác nhận:', error.message);
  }

  // Lưu alias để lần sau tự động áp dụng (xem resolveAliases() ở trên) —
  // append thêm dòng mới cũng không sai vì getAliasMap() luôn lấy dòng SAU
  // CÙNG khớp normalizedRawName nhờ duyệt tuần tự rồi set() đè lên.
  await sheets.spreadsheets.values.append({
    spreadsheetId: BCSTAT_SPREADSHEET_ID,
    range: `'${BCSTAT_ALIAS_SHEET_NAME}'!A:B`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    resource: { values: [[rawName, canonicalName]] },
  });

  return computeAndWriteSummary();
}

module.exports = {
  getAliasMap,
  resolveAliases,
  mergeUnmatchedAlias,
};
