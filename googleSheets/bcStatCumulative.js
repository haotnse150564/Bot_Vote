// ===== BcStat sheet: tab Cumulative =====
// Nguồn "sự thật" 1 dòng/(người, trận): upsert khi lưu phiên mới (updateCumulative),
// ghi lại toàn tab (writeCumulativeState) và liệt kê các trận gần nhất.

const { BCSTAT_SPREADSHEET_ID, BCSTAT_CUMULATIVE_SHEET_NAME } = require('../config');
const { parseMatchDateParts, splitMatchLabel, assertValidMatchLabel } = require('./bcStatMatchLabel');
const {
  CATEGORIES,
  CUMULATIVE_HEADER,
  getSheetsClient,
  colLetter,
  normalizeName,
} = require('./bcStatShared');

// combined: Map(normalizedName -> { displayName, values: { catKey: number } })
// — CÙNG dữ liệu 1 phiên vừa ghi vào RawLog. matchLabel: nhãn trận đã
// validate. renameFromLabel (tuỳ chọn): nhãn trận CŨ cần đổi thành
// matchLabel — áp dụng cho MỌI dòng đang mang nhãn cũ đó, kể cả người không
// có mặt trong phiên đang lưu lần này (vd sửa lại đúng chính tả tên đối thủ
// cho cả trận, không chỉ riêng vài người vừa gửi lại ảnh).
// Đọc toàn bộ Cumulative hiện có, UPSERT đúng dòng (người, trận): nếu dòng
// đó đã tồn tại (lưu lại đúng trận cũ để SỬA) — chỉ ghi đè các hạng mục CÓ
// giá trị trong phiên này, giữ nguyên hạng mục khác; nếu chưa có — tạo dòng
// mới. Rồi ghi đè lại toàn bộ tab (clear + rewrite — bảng này tăng dần theo
// người*trận, rewrite toàn bộ mỗi lần là đủ nhanh và đơn giản/an toàn hơn
// tính patch từng ô).
async function updateCumulative(combined, matchLabel, renameFromLabel) {
  if (!combined || !combined.size) return;
  const label = assertValidMatchLabel(matchLabel);
  const labelKey = normalizeName(label);
  const renameFromKey = renameFromLabel ? normalizeName(renameFromLabel) : null;
  const sheets = await getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: BCSTAT_SPREADSHEET_ID,
    range: `'${BCSTAT_CUMULATIVE_SHEET_NAME}'!A2:${colLetter(CUMULATIVE_HEADER.length - 1)}`,
  });
  const rows = response.data.values || [];

  // key = "<tên đã chuẩn hoá>\u0000<nhãn trận đã chuẩn hoá>"
  const state = new Map();
  rows.forEach((row) => {
    const name = (row[0] || '').trim();
    let rowLabel = (row[1] || '').trim();
    if (!name || !rowLabel) return;
    let rowLabelKey = normalizeName(rowLabel);
    // Đổi nhãn trận (nút "✏️ Sửa trận đã lưu" -> NPC đổi lại tên đối thủ
    // hoặc ngày) — áp dụng cho MỌI người đang mang nhãn cũ này.
    if (renameFromKey && rowLabelKey === renameFromKey) {
      rowLabel = label;
      rowLabelKey = labelKey;
    }
    const values = {};
    CATEGORIES.forEach((cat, idx) => {
      const raw = row[2 + idx];
      values[cat.key] = raw === undefined || raw === '' ? '' : Number(raw);
    });
    state.set(`${normalizeName(name)}\u0000${rowLabelKey}`, { displayName: name, matchLabel: rowLabel, values });
  });

  combined.forEach((entry, playerKey) => {
    const stateKey = `${playerKey}\u0000${labelKey}`;
    const existing = state.get(stateKey);
    const values = existing ? { ...existing.values } : {};
    CATEGORIES.forEach((cat) => {
      const v = entry.values[cat.key];
      // Không gửi lại hạng mục này trong phiên vừa rồi -> giữ nguyên giá trị
      // cũ đã lưu cho đúng trận này (nếu có), không xoá mất.
      if (v === undefined || v === null || Number.isNaN(v)) return;
      values[cat.key] = v;
    });
    state.set(stateKey, { displayName: entry.displayName, matchLabel: label, values });
  });

  await writeCumulativeState(sheets, state);
}

// Ghi đè (clear + rewrite) toàn bộ tab Cumulative từ 1 Map state (key bất kỳ
// -> {displayName, matchLabel, values}) — dùng chung bởi updateCumulative()
// và mergeUnmatchedAlias().
async function writeCumulativeState(sheets, state) {
  const outRows = [...state.values()].map((entry) => [
    entry.displayName,
    entry.matchLabel,
    ...CATEGORIES.map((cat) => {
      const v = entry.values[cat.key];
      return v === '' || v === undefined || v === null ? '' : v;
    }),
  ]);

  // QUAN TRỌNG: luôn ghi lại ĐÚNG dòng header (dòng 1) mỗi lần ghi, KHÔNG chỉ
  // trông cậy vào header được ghi 1 lần lúc tạo sheet (ensureBcStatSheetsExist
  // bỏ qua nếu sheet đã tồn tại) — nếu không, khi CUMULATIVE_HEADER đổi
  // format mà sheet cũ đã tồn tại từ trước, header cũ sẽ bị LỆCH so với dữ
  // liệu mới ghi từ cột B trở đi.
  await sheets.spreadsheets.values.update({
    spreadsheetId: BCSTAT_SPREADSHEET_ID,
    range: `'${BCSTAT_CUMULATIVE_SHEET_NAME}'!A1`,
    valueInputOption: 'RAW',
    resource: { values: [CUMULATIVE_HEADER] },
  });

  await sheets.spreadsheets.values.clear({
    spreadsheetId: BCSTAT_SPREADSHEET_ID,
    range: `'${BCSTAT_CUMULATIVE_SHEET_NAME}'!A2:${colLetter(CUMULATIVE_HEADER.length - 1)}`,
  });
  if (outRows.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: BCSTAT_SPREADSHEET_ID,
      range: `'${BCSTAT_CUMULATIVE_SHEET_NAME}'!A2`,
      valueInputOption: 'RAW',
      resource: { values: outRows },
    });
  }
}

// Đọc toàn bộ Cumulative, gom danh sách nhãn trận DUY NHẤT (không phân biệt
// hoa/thường/khoảng trắng thừa), sắp theo ngày MỚI NHẤT trước (parse từ
// chính nhãn, xem splitMatchLabel/parseMatchDateParts) — dùng cho nút "✏️
// Sửa trận đã lưu" (bcstat/format.js::buildMatchEditSelectPayload, Discord
// select menu tối đa 25 option nên mặc định cũng chỉ lấy 25 trận gần nhất).
async function getRecentMatchLabels(limit = 25) {
  const sheets = await getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: BCSTAT_SPREADSHEET_ID,
    range: `'${BCSTAT_CUMULATIVE_SHEET_NAME}'!B2:B`,
  });
  const rows = response.data.values || [];

  const seen = new Map(); // labelKey -> { label, date }
  rows.forEach((row) => {
    const label = (row[0] || '').trim();
    if (!label) return;
    const key = normalizeName(label);
    if (seen.has(key)) return;
    const { dateStr } = splitMatchLabel(label);
    seen.set(key, { label, date: parseMatchDateParts(dateStr) });
  });

  return [...seen.values()]
    .sort((a, b) => {
      const at = a.date ? a.date.getTime() : -Infinity;
      const bt = b.date ? b.date.getTime() : -Infinity;
      return bt - at;
    })
    .slice(0, limit)
    .map((entry) => entry.label);
}

module.exports = {
  updateCumulative,
  writeCumulativeState,
  getRecentMatchLabels,
};
