// ===== BcStat sheet: tab Summary =====
// Bảng tổng hợp hiển thị — tính từ Record + thông tin bang (memberSheet), ghi đè
// toàn bộ mỗi lần tính lại (computeAndWriteSummary) và đọc ra (getSummaryRows).

const { BCSTAT_SPREADSHEET_ID, BCSTAT_SUMMARY_SHEET_NAME } = require('../config');
const { getAllBangMembers } = require('./memberSheet');
const {
  CATEGORIES,
  SUMMARY_HEADER,
  getSheetsClient,
  colLetter,
  normalizeName,
  levenshtein,
} = require('./bcStatShared');
const { readRecordState } = require('./bcStatRecords');

// Đọc toàn bộ Cumulative (KHÔNG đọc RawLog nữa — xem ghi chú đầu file), gom
// theo người rồi tính "Kỷ lục" mỗi hạng mục: giá trị THÔ CAO NHẤT người đó
// từng đạt được ở hạng mục đó (qua mọi trận đã lưu) — không cộng/trừ gì
// thêm (trước đây có trừ đi số Trọng thương/chết của đúng trận đó, đã bỏ
// theo yêu cầu người dùng vì làm sai lệch ý nghĩa "Kỷ lục", xem updateRecords()
// ở trên). Chỉ so sánh giữa các trận CÓ thu thập hạng mục đó (bỏ qua ô
// trống, không tính là 0). Ghép Discord ID + Class từ tab "Bang" rồi ghi đè
// lại Summary. Trả về { playerCount, matched, unmatched } để báo lại cho
// người dùng — unmatched: tên KHÔNG khớp chính xác với tab "Bang" (kèm gợi
// ý tên gần đúng nhất nếu có, để người dùng tự xác nhận/sửa tay theo mục 8
// spec).
async function computeAndWriteSummary() {
  const sheets = await getSheetsClient();
  // Đọc thẳng từ Record (KHÔNG quét Cumulative nữa — xem ghi chú đầu file):
  // Record đã tự cộng dồn Kỷ lục theo từng phiên (updateRecords), nên tổng
  // hợp lại ở đây chỉ còn là JOIN với tab "Bang", không cần tính toán lại gì.
  const grouped = await readRecordState(sheets);

  const bangMembers = await getAllBangMembers();
  const bangByNormalizedIngame = new Map();
  bangMembers.forEach((m) => {
    if (m.ingame) bangByNormalizedIngame.set(normalizeName(m.ingame), m);
  });

  const unmatched = [];
  const summaryRows = [];

  grouped.forEach((entry, key) => {
    let member = bangByNormalizedIngame.get(key);
    let suggestion = null;

    if (!member) {
      // Tìm gợi ý gần đúng nhất trong tab "Bang" (khoảng cách Levenshtein
      // nhỏ nhất, chỉ gợi ý nếu đủ gần — tránh gợi ý bừa khi không liên quan).
      // QUAN TRỌNG: lưu lại tên THẬT (đúng hoa/thường, m.ingame) chứ không
      // phải bangKey (đã lowercase) — suggestion này được dùng làm
      // canonicalName khi NPC bấm xác nhận gộp (mergeUnmatchedAlias), nên
      // phải là tên hiển thị đúng như trong tab "Bang", không phải khoá đã
      // chuẩn hoá.
      let bestDist = Infinity;
      let bestMember = null;
      bangByNormalizedIngame.forEach((candidateMember, bangKey) => {
        const dist = levenshtein(key, bangKey);
        if (dist < bestDist) {
          bestDist = dist;
          bestMember = candidateMember;
        }
      });
      if (bestMember && bestDist <= 2) suggestion = bestMember.ingame;
      unmatched.push({ name: entry.displayName, suggestion });
    }

    const recordCells = CATEGORIES.map((cat) => entry.records[cat.key].value);

    summaryRows.push([
      entry.displayName,
      member ? member.discordId || '' : '',
      member ? member.className || '' : '',
      ...recordCells,
    ]);
  });

  // QUAN TRỌNG: luôn ghi lại ĐÚNG dòng header (dòng 1) mỗi lần tính lại,
  // KHÔNG chỉ trông cậy vào header được ghi 1 lần lúc tạo sheet
  // (ensureBcStatSheetsExist bỏ qua nếu sheet đã tồn tại) — nếu không, khi
  // SUMMARY_HEADER đổi format (vd đổi cột trung bình sang kỷ lục) mà sheet cũ
  // đã tồn tại từ trước, header cũ (khác cột) sẽ bị LỆCH so với dữ liệu mới
  // ghi từ cột D trở đi, khiến bảng trông như tính sai.
  await sheets.spreadsheets.values.update({
    spreadsheetId: BCSTAT_SPREADSHEET_ID,
    range: `'${BCSTAT_SUMMARY_SHEET_NAME}'!A1`,
    valueInputOption: 'RAW',
    resource: { values: [SUMMARY_HEADER] },
  });

  await sheets.spreadsheets.values.clear({
    spreadsheetId: BCSTAT_SPREADSHEET_ID,
    range: `'${BCSTAT_SUMMARY_SHEET_NAME}'!A2:${colLetter(SUMMARY_HEADER.length - 1)}`,
  });
  if (summaryRows.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: BCSTAT_SPREADSHEET_ID,
      range: `'${BCSTAT_SUMMARY_SHEET_NAME}'!A2`,
      valueInputOption: 'RAW',
      resource: { values: summaryRows },
    });
  }

  return { playerCount: grouped.size, matched: grouped.size - unmatched.length, unmatched };
}

// Đọc toàn bộ Summary hiện có (đã tính sẵn từ lần "/bcstat -> Hoàn tất &
// Lưu" gần nhất, xem computeAndWriteSummary() ở trên) — dùng cho trang web
// (NMTeam) hiển thị "Thống Kê Chỉ Số Bang Chiến" ở mục cá nhân, KHÔNG tự
// tính lại gì thêm (đỡ tốn quota Sheets mỗi lần người dùng bấm "Tải thống
// kê"). Trả về { categories: [{key,label}], players: [{name, discordId,
// className, values: {catKey: {record:number|''}}}] } hoặc null nếu chưa
// cấu hình BCSTAT_SPREADSHEET_ID. record = "kỷ lục" (xem
// computeAndWriteSummary ở trên).
async function getSummaryRows() {
  if (!BCSTAT_SPREADSHEET_ID) return null;
  const sheets = await getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: BCSTAT_SPREADSHEET_ID,
    range: `'${BCSTAT_SUMMARY_SHEET_NAME}'!A2:${colLetter(SUMMARY_HEADER.length - 1)}`,
  });
  const rows = response.data.values || [];

  const players = rows
    .filter((row) => (row[0] || '').trim())
    .map((row) => {
      const values = {};
      CATEGORIES.forEach((cat, idx) => {
        const raw = row[3 + idx];
        values[cat.key] = { record: raw === undefined || raw === null || raw === '' ? '' : Number(raw) };
      });
      return {
        name: row[0] || '',
        discordId: row[1] || '',
        className: row[2] || '',
        values,
      };
    });

  return {
    categories: CATEGORIES.map((c) => ({ key: c.key, label: c.label })),
    players,
  };
}

module.exports = {
  computeAndWriteSummary,
  getSummaryRows,
};
