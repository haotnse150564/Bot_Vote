// ===== BcStat sheet: tab Record (Kỷ lục) =====
// Kỷ lục riêng 1 chỗ, sống sót kể cả khi Cumulative bị dọn theo chu kỳ:
// đọc/ghi trạng thái, upsert theo phiên, seed từ Cumulative lần đầu, gộp alias.

const {
  BCSTAT_SPREADSHEET_ID,
  BCSTAT_CUMULATIVE_SHEET_NAME,
  BCSTAT_RECORD_SHEET_NAME,
} = require('../config');
const {
  CATEGORIES,
  CUMULATIVE_HEADER,
  RECORD_HEADER,
  getSheetsClient,
  colLetter,
  normalizeName,
} = require('./bcStatShared');
const { assertValidMatchLabel } = require('./bcStatMatchLabel');

// Đọc toàn bộ tab Record hiện có -> Map(normalizedName -> {displayName,
// records: {catKey: {value, matchLabel}}}) — dùng chung bởi updateRecords(),
// mergeRecordsAlias() bên dưới.
async function readRecordState(sheets) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: BCSTAT_SPREADSHEET_ID,
    range: `'${BCSTAT_RECORD_SHEET_NAME}'!A2:${colLetter(RECORD_HEADER.length - 1)}`,
  });
  const rows = response.data.values || [];
  const state = new Map();
  rows.forEach((row) => {
    const name = (row[0] || '').trim();
    if (!name) return;
    const records = {};
    CATEGORIES.forEach((cat, idx) => {
      const valCol = 1 + idx * 2;
      const raw = row[valCol];
      records[cat.key] = {
        value: raw === undefined || raw === '' ? '' : Number(raw),
        matchLabel: row[valCol + 1] || '',
      };
    });
    state.set(normalizeName(name), { displayName: name, records });
  });
  return state;
}

// Ghi đè (clear + rewrite) toàn bộ tab Record từ 1 Map state (normalizedName
// -> {displayName, records: {catKey: {value, matchLabel}}}).
async function writeRecordState(sheets, state) {
  const outRows = [...state.values()].map((entry) => {
    const cells = [];
    CATEGORIES.forEach((cat) => {
      const r = entry.records[cat.key] || { value: '', matchLabel: '' };
      cells.push(r.value === '' || r.value === undefined || r.value === null ? '' : r.value, r.matchLabel || '');
    });
    return [entry.displayName, ...cells];
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: BCSTAT_SPREADSHEET_ID,
    range: `'${BCSTAT_RECORD_SHEET_NAME}'!A1`,
    valueInputOption: 'RAW',
    resource: { values: [RECORD_HEADER] },
  });

  await sheets.spreadsheets.values.clear({
    spreadsheetId: BCSTAT_SPREADSHEET_ID,
    range: `'${BCSTAT_RECORD_SHEET_NAME}'!A2:${colLetter(RECORD_HEADER.length - 1)}`,
  });
  if (outRows.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: BCSTAT_SPREADSHEET_ID,
      range: `'${BCSTAT_RECORD_SHEET_NAME}'!A2`,
      valueInputOption: 'RAW',
      resource: { values: outRows },
    });
  }
}

// combined: Map(normalizedName -> {displayName, values: {catKey: number}}) —
// CÙNG dữ liệu 1 phiên vừa ghi (đã áp alias). Với MỖI người/hạng mục CÓ giá
// trị trong phiên này: so trực tiếp giá trị THÔ với Kỷ lục đang lưu — CAO
// HƠN mới ghi đè (kèm nhãn trận vừa lưu). Kỷ lục = số liệu tốt nhất từng
// đạt được, KHÔNG cộng/trừ gì thêm (trước đây có trừ đi số Trọng thương/
// chết của đúng phiên đó, nhưng làm sai lệch hẳn ý nghĩa "Kỷ lục" — vd
// hạng mục "Trọng thương" tự trừ chính nó luôn ra 0, hạng mục "Vật tư"/
// "Hồi sinh" đạt 0 vẫn có thể bị trừ thành số âm nếu trận đó chết nhiều —
// theo yêu cầu người dùng, bỏ hẳn công thức này). renameFromLabel (tuỳ
// chọn, từ nút "✏️ Sửa trận đã lưu"): đổi lại nhãn trận đã lưu trong cột
// "Trận đạt" cho MỌI kỷ lục đang trỏ tới nhãn cũ đó, để không bị lệch tên
// trận sau khi sửa.
async function updateRecords(combined, matchLabel, renameFromLabel) {
  if (!combined || !combined.size) return;
  const label = assertValidMatchLabel(matchLabel);
  const sheets = await getSheetsClient();
  const state = await readRecordState(sheets);

  if (renameFromLabel) {
    const renameFromKey = normalizeName(renameFromLabel);
    state.forEach((entry) => {
      CATEGORIES.forEach((cat) => {
        const r = entry.records[cat.key];
        if (r && r.matchLabel && normalizeName(r.matchLabel) === renameFromKey) {
          r.matchLabel = label;
        }
      });
    });
  }

  combined.forEach((entry, key) => {
    let existing = state.get(key);
    if (!existing) {
      existing = { displayName: entry.displayName, records: {} };
      CATEGORIES.forEach((cat) => {
        existing.records[cat.key] = { value: '', matchLabel: '' };
      });
      state.set(key, existing);
    }
    existing.displayName = entry.displayName;
    CATEGORIES.forEach((cat) => {
      const v = entry.values[cat.key];
      if (v === undefined || v === null || v === '' || Number.isNaN(Number(v))) return;
      const score = Number(v);
      const current = existing.records[cat.key];
      if (current.value === '' || score > current.value) {
        existing.records[cat.key] = { value: score, matchLabel: label };
      }
    });
  });

  await writeRecordState(sheets, state);
}

// Chạy 1 LẦN DUY NHẤT khi tab Record vừa được tạo (chưa từng có) — quét lại
// TOÀN BỘ Cumulative hiện có để tính Kỷ lục ban đầu, tránh Summary hiển thị
// trống trơn ngay sau khi nâng cấp lên hệ thống Record tách riêng.
async function seedRecordsFromCumulative(sheets) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: BCSTAT_SPREADSHEET_ID,
    range: `'${BCSTAT_CUMULATIVE_SHEET_NAME}'!A2:${colLetter(CUMULATIVE_HEADER.length - 1)}`,
  });
  const rows = response.data.values || [];
  const state = new Map();
  rows.forEach((row) => {
    const name = (row[0] || '').trim();
    const label = (row[1] || '').trim();
    if (!name || !label) return;
    const key = normalizeName(name);
    if (!state.has(key)) {
      const records = {};
      CATEGORIES.forEach((cat) => {
        records[cat.key] = { value: '', matchLabel: '' };
      });
      state.set(key, { displayName: name, records });
    }
    const entry = state.get(key);
    CATEGORIES.forEach((cat, idx) => {
      const raw = row[2 + idx];
      if (raw === undefined || raw === '') return;
      const score = Number(raw);
      const current = entry.records[cat.key];
      if (current.value === '' || score > current.value) {
        entry.records[cat.key] = { value: score, matchLabel: label };
      }
    });
  });

  await writeRecordState(sheets, state);
}

// Gộp Kỷ lục của "rawKey" (tên gõ sai) vào "canonicalKey" (tên chuẩn) khi
// NPC xác nhận gộp tên (mergeUnmatchedAlias bên dưới) — giữ giá trị Kỷ lục
// CAO HƠN giữa 2 bên cho từng hạng mục, rồi xoá hẳn dòng rawKey.
async function mergeRecordsAlias(sheets, rawKey, canonicalKey, canonicalName) {
  const state = await readRecordState(sheets);
  const rawEntry = state.get(rawKey);
  if (!rawEntry) return; // không có Kỷ lục nào của tên gõ sai — không có gì để gộp

  let canonicalEntry = state.get(canonicalKey);
  if (!canonicalEntry) {
    canonicalEntry = { displayName: canonicalName, records: {} };
    CATEGORIES.forEach((cat) => {
      canonicalEntry.records[cat.key] = { value: '', matchLabel: '' };
    });
    state.set(canonicalKey, canonicalEntry);
  }
  CATEGORIES.forEach((cat) => {
    const rawRec = rawEntry.records[cat.key];
    const canRec = canonicalEntry.records[cat.key];
    if (rawRec.value !== '' && (canRec.value === '' || rawRec.value > canRec.value)) {
      canonicalEntry.records[cat.key] = { value: rawRec.value, matchLabel: rawRec.matchLabel };
    }
  });
  canonicalEntry.displayName = canonicalName;
  state.delete(rawKey);

  await writeRecordState(sheets, state);
}

module.exports = {
  readRecordState,
  updateRecords,
  seedRecordsFromCumulative,
  mergeRecordsAlias,
};
