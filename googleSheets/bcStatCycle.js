// ===== BcStat sheet: chu kỳ =====
// Số chu kỳ kế tiếp, trạng thái chu kỳ hiện tại, dữ liệu chu kỳ hiện tại và
// thao tác "Bắt Đầu Chu Kỳ Mới" (lưu trữ + dọn Cumulative/RawLog).

const {
  BCSTAT_SPREADSHEET_ID,
  BCSTAT_RAWLOG_SHEET_NAME,
  BCSTAT_CUMULATIVE_SHEET_NAME,
  BCSTAT_CYCLE_SHEET_NAME,
} = require('../config');
const { getAllBangMembers } = require('./memberSheet');
const {
  CATEGORIES,
  RAWLOG_HEADER,
  CUMULATIVE_HEADER,
  getSheetsClient,
  colLetter,
  normalizeName,
  levenshtein,
} = require('./bcStatShared');
const { parseMatchDateParts, splitMatchLabel } = require('./bcStatMatchLabel');

// Đọc/ghi số "chu kỳ kế tiếp" ở tab BCSTAT_CYCLE_SHEET_NAME (xem ghi chú
// cạnh BCSTAT_CYCLE_SHEET_NAME trong config.js) — mặc định 1 nếu ô trống
// (sheet mới tạo/lỗi đọc), không throw để không làm hỏng cả luồng chỉ vì
// chưa đọc được đúng số thứ tự.
async function getNextCycleNumber(sheets) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: BCSTAT_SPREADSHEET_ID,
    range: `'${BCSTAT_CYCLE_SHEET_NAME}'!A2`,
  });
  const raw = response.data.values && response.data.values[0] && response.data.values[0][0];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

async function setNextCycleNumber(sheets, n) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: BCSTAT_SPREADSHEET_ID,
    range: `'${BCSTAT_CYCLE_SHEET_NAME}'!A2`,
    valueInputOption: 'RAW',
    resource: { values: [[n]] },
  });
}

// Đọc toàn bộ Cumulative hiện có, gom danh sách trận DUY NHẤT — CHÍNH LÀ
// "chu kỳ đang tích luỹ dở" (xem ghi chú đầu file: mỗi trận vẫn còn trong
// Cumulative nghĩa là CHƯA được xuất/dọn theo chu kỳ nào) — dùng để NPC xem
// trước (web tự hỏi confirm() nếu matches.length < 3, theo yêu cầu "vẫn
// được nhưng hỏi xác nhận trước") TRƯỚC KHI thật sự bấm "Bắt Đầu Chu Kỳ
// Mới" (startNewBcStatCycle bên dưới, THẬT SỰ xoá dữ liệu).
async function getBcStatCycleStatus() {
  const sheets = await getSheetsClient();
  const nextCycleNumber = await getNextCycleNumber(sheets);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: BCSTAT_SPREADSHEET_ID,
    range: `'${BCSTAT_CUMULATIVE_SHEET_NAME}'!B2:B`,
  });
  const rows = response.data.values || [];
  const seen = new Map();
  rows.forEach((row) => {
    const label = (row[0] || '').trim();
    if (!label) return;
    const key = normalizeName(label);
    if (seen.has(key)) return;
    const { opponent, dateStr } = splitMatchLabel(label);
    seen.set(key, { label, opponent, dateStr, date: parseMatchDateParts(dateStr) });
  });
  const matches = [...seen.values()]
    .sort((a, b) => {
      const at = a.date ? a.date.getTime() : Infinity;
      const bt = b.date ? b.date.getTime() : Infinity;
      return at - bt; // cũ nhất trước — đúng thứ tự Trận 1 -> 2 -> 3 trong chu kỳ
    })
    .map((m) => ({ label: m.label, opponent: m.opponent, dateStr: m.dateStr }));
  return { nextCycleNumber, matches };
}

// ---- Số liệu THÔ theo từng trận của chu kỳ đang tích luỹ dở (yêu cầu "bảng
// hiển thị web giờ là bảng lịch sử trận... nếu không có thì hiện trận gần
// nhất") ----
// Đọc toàn bộ Cumulative hiện có (1 dòng/(người,trận), xem ghi chú đầu file)
// + ghép Discord ID/Class từ tab "Bang" (giống getSummaryRows) — dùng để
// trang web hiển thị ĐÚNG số liệu thô của MỘT trận cụ thể do NPC chọn qua ô
// chọn (mặc định trận gần nhất), KHÔNG còn hiện "Kỷ lục" ở bảng chính nữa
// (Kỷ lục giờ CHỈ hiện trong modal cá nhân khi bấm vào tên — xem
// getSummaryRows() ở trên, đã có sẵn cột record dùng cho modal đó).
// matches sắp xếp CŨ NHẤT TRƯỚC (Trận 1 -> 2 -> 3), giống hệt
// getBcStatCycleStatus() — web tự hiểu phần tử CUỐI của mảng là "trận gần
// nhất" để chọn mặc định.
// Trả về { categories: [{key,label}], matches: [{label,opponent,dateStr}],
// players: [{name, discordId, className, matchValues: [{catKey:number}, ...]
// }] } — matchValues[i] tương ứng đúng matches[i]; trận nào người đó CHƯA có
// mặt hoặc hạng mục đó chưa thu thập trong trận đó thì KHÔNG có key tương
// ứng trong object (không phải 0) để web tự hiện "—", không hiểu lầm là 0.
async function getCurrentCycleData() {
  const sheets = await getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: BCSTAT_SPREADSHEET_ID,
    range: `'${BCSTAT_CUMULATIVE_SHEET_NAME}'!A2:${colLetter(CUMULATIVE_HEADER.length - 1)}`,
  });
  const rows = (response.data.values || []).filter((row) => (row[0] || '').trim() && (row[1] || '').trim());

  // Danh sách trận DUY NHẤT, sắp cũ nhất trước — y hệt getBcStatCycleStatus().
  const matchesByKey = new Map();
  rows.forEach((row) => {
    const label = row[1].trim();
    const key = normalizeName(label);
    if (matchesByKey.has(key)) return;
    const { opponent, dateStr } = splitMatchLabel(label);
    matchesByKey.set(key, { label, opponent, dateStr, date: parseMatchDateParts(dateStr) });
  });
  const matches = [...matchesByKey.values()].sort((a, b) => {
    const at = a.date ? a.date.getTime() : Infinity;
    const bt = b.date ? b.date.getTime() : Infinity;
    return at - bt;
  });
  const matchIndexByKey = new Map(matches.map((m, idx) => [normalizeName(m.label), idx]));

  const bangMembers = await getAllBangMembers();
  const bangByNormalizedIngame = new Map();
  bangMembers.forEach((m) => {
    if (m.ingame) bangByNormalizedIngame.set(normalizeName(m.ingame), m);
  });

  // normalizedName -> { displayName, member, matchValues: [{}, {}, ...] }
  const playersByKey = new Map();
  rows.forEach((row) => {
    const name = row[0].trim();
    const label = row[1].trim();
    const idx = matchIndexByKey.get(normalizeName(label));
    if (idx === undefined) return; // không thể xảy ra (label lấy từ chính rows này), phòng thủ cho chắc
    const key = normalizeName(name);
    if (!playersByKey.has(key)) {
      playersByKey.set(key, {
        displayName: name,
        member: bangByNormalizedIngame.get(key) || null,
        matchValues: matches.map(() => ({})),
      });
    }
    const values = {};
    CATEGORIES.forEach((cat, ci) => {
      const raw = row[2 + ci];
      if (raw !== undefined && raw !== '') values[cat.key] = Number(raw);
    });
    playersByKey.get(key).matchValues[idx] = values;
  });

  // Gợi ý tên gần đúng nhất trong tab "Bang" cho người CHƯA khớp (member ===
  // null) — dùng lại đúng thuật toán Levenshtein đã có ở computeAndWriteSummary()
  // (mục 8 spec) để web hiện sẵn gợi ý cạnh nút ⚠️ thay vì bắt NPC tự gõ
  // tìm lại từ đầu mỗi lần gộp, giống hệt luồng "🔗 Xem & xác nhận tên chưa
  // khớp" bên Discord. Chỉ gợi ý nếu đủ gần (khoảng cách <= 2), tránh gợi ý
  // bừa khi không liên quan. suggestion lưu ĐÚNG tên hiển thị (m.ingame) vì
  // đây sẽ được dùng thẳng làm canonicalName khi NPC xác nhận gộp.
  function findSuggestion(key) {
    let bestDist = Infinity;
    let bestMember = null;
    bangByNormalizedIngame.forEach((candidateMember, bangKey) => {
      const dist = levenshtein(key, bangKey);
      if (dist < bestDist) {
        bestDist = dist;
        bestMember = candidateMember;
      }
    });
    return bestMember && bestDist <= 2 ? bestMember.ingame : null;
  }

  const players = [...playersByKey.values()].map((entry) => ({
    name: entry.displayName,
    discordId: entry.member ? entry.member.discordId || '' : '',
    className: entry.member ? entry.member.className || '' : '',
    matchValues: entry.matchValues,
    suggestion: entry.member ? null : findSuggestion(normalizeName(entry.displayName)),
  }));

  return {
    categories: CATEGORIES.map((c) => ({ key: c.key, label: c.label })),
    matches: matches.map((m) => ({ label: m.label, opponent: m.opponent, dateStr: m.dateStr })),
    players,
  };
}

// ---- "Bắt Đầu Chu Kỳ Mới" (yêu cầu người dùng) ----
// THẬT SỰ đóng chu kỳ đang tích luỹ dở: đọc lại TOÀN BỘ số liệu thô của
// từng người/trận đang có trong Cumulative (để web dựng file Excel lưu vào
// Blob — bot không tự tạo file Excel, chỉ trả JSON thô), xoá sạch Cumulative
// (mỗi dòng ở đây ĐÚNG LÀ 1 trận thuộc chu kỳ vừa xong, không có dòng nào
// thuộc chu kỳ khác — xem ghi chú đầu file), xoá luôn các dòng RawLog thuộc
// đúng những trận đó (theo yêu cầu người dùng "xoá luôn cả RawLog cho gọn"
// — các dòng RawLog của trận KHÔNG thuộc chu kỳ này, nếu có, vẫn được giữ
// nguyên), rồi tăng số chu kỳ kế tiếp lên 1.
// KHÔNG đụng gì tới tab Record (Kỷ lục) — Kỷ lục tách riêng, sống sót qua
// mọi lần đóng chu kỳ (xem ghi chú đầu file).
// Trả về { cycleNumber (chu kỳ VỪA đóng), matches: [{label,opponent,
// dateStr}], players: [{name,matchLabel,values}], rawRows: [{session,name,
// values}] } — web dùng để dựng file Excel (bảng số liệu thô + RawLog tham
// khảo) rồi tự lưu lên Blob.
async function startNewBcStatCycle() {
  const sheets = await getSheetsClient();
  const nextCycleNumber = await getNextCycleNumber(sheets);

  const cumResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: BCSTAT_SPREADSHEET_ID,
    range: `'${BCSTAT_CUMULATIVE_SHEET_NAME}'!A2:${colLetter(CUMULATIVE_HEADER.length - 1)}`,
  });
  const cumRows = (cumResponse.data.values || []).filter((row) => (row[0] || '').trim() && (row[1] || '').trim());
  if (!cumRows.length) {
    throw new Error('Chưa có trận nào được lưu — không có gì để xuất chu kỳ mới.');
  }

  const matchesByKey = new Map();
  const players = cumRows.map((row) => {
    const name = row[0].trim();
    const matchLabel = row[1].trim();
    const key = normalizeName(matchLabel);
    if (!matchesByKey.has(key)) {
      const { opponent, dateStr } = splitMatchLabel(matchLabel);
      matchesByKey.set(key, { label: matchLabel, opponent, dateStr, date: parseMatchDateParts(dateStr) });
    }
    const values = {};
    CATEGORIES.forEach((cat, idx) => {
      const raw = row[2 + idx];
      values[cat.key] = raw === undefined || raw === '' ? '' : Number(raw);
    });
    return { name, matchLabel, values };
  });
  const matches = [...matchesByKey.values()].sort((a, b) => {
    const at = a.date ? a.date.getTime() : Infinity;
    const bt = b.date ? b.date.getTime() : Infinity;
    return at - bt;
  });

  // Tách RawLog thành 2 phần: thuộc chu kỳ đang đóng (sẽ xoá, nhưng vẫn trả
  // về để web đưa vào file Excel tham khảo) và KHÔNG thuộc (giữ nguyên).
  const rawResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: BCSTAT_SPREADSHEET_ID,
    range: `'${BCSTAT_RAWLOG_SHEET_NAME}'!A2:${colLetter(RAWLOG_HEADER.length - 1)}`,
  });
  const rawRows = rawResponse.data.values || [];
  const exportedRawRows = [];
  const keptRawRows = [];
  rawRows.forEach((row) => {
    const sessionCell = (row[0] || '').trim();
    // "Session/Trận" có dạng "<sessionLabel> — <nhãn trận>" (xem
    // appendSessionRows) — tách theo dấu " — " CUỐI CÙNG để lấy đúng nhãn.
    const sepIdx = sessionCell.lastIndexOf(' — ');
    const label = sepIdx === -1 ? '' : sessionCell.slice(sepIdx + 3).trim();
    if (label && matchesByKey.has(normalizeName(label))) {
      exportedRawRows.push(row);
    } else {
      keptRawRows.push(row);
    }
  });

  // ---- Ghi thay đổi thật sự lên Sheet (từ đây trở đi coi như "đã xong",
  // không rollback nếu lỗi giữa chừng — chấp nhận được vì mỗi bước ghi đè
  // TOÀN BỘ 1 vùng, chạy lại route này lần nữa vẫn cho kết quả nhất quán) ----
  await setNextCycleNumber(sheets, nextCycleNumber + 1);

  await sheets.spreadsheets.values.clear({
    spreadsheetId: BCSTAT_SPREADSHEET_ID,
    range: `'${BCSTAT_CUMULATIVE_SHEET_NAME}'!A2:${colLetter(CUMULATIVE_HEADER.length - 1)}`,
  });

  await sheets.spreadsheets.values.clear({
    spreadsheetId: BCSTAT_SPREADSHEET_ID,
    range: `'${BCSTAT_RAWLOG_SHEET_NAME}'!A2:${colLetter(RAWLOG_HEADER.length - 1)}`,
  });
  if (keptRawRows.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: BCSTAT_SPREADSHEET_ID,
      range: `'${BCSTAT_RAWLOG_SHEET_NAME}'!A2`,
      valueInputOption: 'RAW',
      resource: { values: keptRawRows },
    });
  }

  return {
    cycleNumber: nextCycleNumber,
    matches: matches.map((m) => ({ label: m.label, opponent: m.opponent, dateStr: m.dateStr })),
    players,
    rawRows: exportedRawRows.map((row) => ({
      session: row[0] || '',
      name: row[1] || '',
      values: CATEGORIES.reduce((acc, cat, idx) => {
        acc[cat.key] = row[2 + idx] === undefined ? '' : row[2 + idx];
        return acc;
      }, {}),
    })),
  };
}

module.exports = {
  getBcStatCycleStatus,
  getCurrentCycleData,
  startNewBcStatCycle,
};
