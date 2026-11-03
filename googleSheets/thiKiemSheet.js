// Đọc/ghi 3 tab cho tính năng "Đua Rank Thí Kiếm Thiên Hạ" — xem chi tiết
// cấu trúc cột trong prompt gốc / thiKiem/index.js.
//   - THIKIEM_RANK_SHEET_NAME: A=ID Discord, B=Ingame, C=Điểm Rank,
//     D=Hạng Hiện Tại, E=Cập nhật lúc (ISO timestamp), F=Class (lấy trực
//     tiếp từ tab "Bang" lúc cập nhật điểm — xem thiKiem/index.js ->
//     processThiKiemImage — ghi lại vào đây để bảng xếp hạng chia theo Class
//     không phải tra cứu lại "Bang" mỗi lần hiển thị).
//   - THIKIEM_CONFIG_SHEET_NAME: A=Key, B=Value — cấu hình mùa giải +
//     message ID của 2 tin cố định (board/button), sửa được qua
//     /set-mua-giai thay vì phải vào sheet sửa tay.
//   - (Không còn sheet Mapping Discord-Ingame riêng — tên ingame lấy trực
//     tiếp từ tab "Bang", xem googleSheets/memberSheet.js.)
const { google } = require('./googleClient');
const { getGoogleAuthClient } = require('./auth');
const { getAllBangMembers } = require('./memberSheet');
const {
  THIKIEM_SPREADSHEET_ID,
  THIKIEM_RANK_SHEET_NAME,
  THIKIEM_CONFIG_SHEET_NAME,
  THIKIEM_BOARD_CHANNEL_ID,
} = require('../config');

const RANK_HEADER = [
  'ID Discord',
  'Ingame',
  'Điểm Rank',
  'Hạng Hiện Tại',
  'Cập nhật lúc',
  'Class',
  // Cột G-T: thống kê trận đấu lấy thêm từ tab "Dữ Liệu Mùa Giải" trong ảnh
  // (bảng 3 hàng số) — CHỈ lưu vào sheet, hiện tại KHÔNG hiển thị lên Bảng
  // Xếp Hạng (embed Discord) hay trang web /rank, xem thiKiem/index.js.
  'Số Trận',
  'Số Trận Thắng',
  'Hạ Gục',
  'Bị Hạ Gục',
  'Kỷ Lục Hạ Gục',
  'Kỷ Lục Hỗ Trợ',
  'Kỷ Lục ST',
  'Kỷ Lục Chịu ST',
  'Kỷ Lục Trị Liệu',
  'Hạ Gục TB',
  'Hỗ Trợ TB',
  'Sát Thương TB',
  'Chịu ST TB',
  'Trị Liệu TB',
];

// Tên field (key JS, dùng trong object entry/stats) tương ứng với TỪNG cột
// thống kê G-T ở trên, ĐÚNG THỨ TỰ — dùng để build range G:T lúc đọc/ghi mà
// không phải lặp lại danh sách cột nhiều lần rải rác trong file.
const STAT_FIELDS = [
  'soTran',
  'soTranThang',
  'haGuc',
  'biHaGuc',
  'kyLucHaGuc',
  'kyLucHoTro',
  'kyLucSatThuong',
  'kyLucChiuSt',
  'kyLucTriLieu',
  'haGucTb',
  'hoTroTb',
  'satThuongTb',
  'chiuStTb',
  'triLieuTb',
];

// Giá trị mặc định cho Config Mùa Giải — chỉ dùng để SEED lần đầu (sheet
// chưa tồn tại), sau đó đọc/sửa hoàn toàn qua sheet hoặc /set-mua-giai.
// LƯU Ý: ten_mua_giai LUÔN phải gõ kèm số Session (S1, S2...) ở cuối — các
// mùa giải có thể trùng phần tên chính nhưng khác Session, và giá trị này
// còn được so khớp với tên mùa giải đọc được từ ảnh (xem
// thiKiem/scoreImage.js -> normalizeSeasonName) để chặn ảnh gửi nhầm từ mùa cũ.
const DEFAULT_CONFIG_ROWS = [
  ['ten_mua_giai', 'Phù Sinh Vạn Tượng S1'],
  ['ngay_bat_dau', '31/07/2026'],
  ['ngay_ket_thuc', '21/09/2026'],
  ['kenh_rank_id', THIKIEM_BOARD_CHANNEL_ID],
  // board_message_id / button_message_id: bot tự điền lại khi đăng tin lần
  // đầu (hoặc khi tin cũ bị xoá tay) — xem thiKiem/index.js.
  ['board_message_id', ''],
  ['button_message_id', ''],
  // recent_updates_message_id / recent_updates_log: tin cố định #3 (Nhật Ký
  // Cập Nhật, tối đa 5 dòng gần nhất) — bot tự điền/ghi lại mỗi lần có
  // người cập nhật điểm thành công, xem thiKiem/board.js -> appendRecentUpdateLine.
  // recent_updates_log lưu dạng JSON (mảng chuỗi) để giữ nguyên qua các lần
  // restart bot (dù thực tế bị reset mỗi lần deploy do kênh bị dọn sạch).
  ['recent_updates_message_id', ''],
  ['recent_updates_log', ''],
  // board_view: tab đang được chọn trên Bảng Xếp Hạng ("" = Tổng, hoặc tên
  // 1 Class) — bot tự cập nhật mỗi khi có người bấm nút chuyển tab (xem
  // thiKiem/format.js -> VIEW_TONG/buildViewButtons và thiKiem/index.js ->
  // handleThiKiemViewButton), giữ đúng tab đang xem qua các lần cập nhật
  // điểm/restart bot thay vì tự nhảy về Tổng.
  ['board_view', ''],
];

async function getSheetsClient() {
  const auth = await getGoogleAuthClient();
  if (!auth) throw new Error('Chưa cấu hình Google Sheets credentials cho bot.');
  return google.sheets({ version: 'v4', auth });
}

async function sheetExists(sheets, title) {
  const response = await sheets.spreadsheets.get({ spreadsheetId: THIKIEM_SPREADSHEET_ID });
  return (response.data.sheets || []).some((s) => s.properties.title === title);
}

async function addSheetWithHeader(sheets, title, header) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: THIKIEM_SPREADSHEET_ID,
    resource: { requests: [{ addSheet: { properties: { title } } }] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: THIKIEM_SPREADSHEET_ID,
    range: `'${title}'!A1`,
    valueInputOption: 'RAW',
    resource: { values: [header] },
  });
}

// Sheet ĐÃ tồn tại từ trước khi có cột Class (F) — chỉ thiếu đúng cái tiêu
// đề "Class" ở F1 (dữ liệu cột F thì cứ để trống, upsertRankScore sẽ tự
// điền dần mỗi lần có người cập nhật điểm tiếp theo). Không đụng gì tới
// A1:E1 hiện có, chỉ bổ sung thêm F1 nếu còn trống.
async function ensureRankHeaderHasClassColumn(sheets) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: THIKIEM_SPREADSHEET_ID,
    range: `'${THIKIEM_RANK_SHEET_NAME}'!F1`,
  });
  const currentValue = (response.data.values || [])[0]?.[0];
  if (!currentValue) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: THIKIEM_SPREADSHEET_ID,
      range: `'${THIKIEM_RANK_SHEET_NAME}'!F1`,
      valueInputOption: 'RAW',
      resource: { values: [['Class']] },
    });
  }
}

// Sheet ĐÃ tồn tại từ trước khi có 14 cột thống kê mới (G-T) — chỉ bổ sung
// đúng phần tiêu đề còn thiếu ở G1:T1 (không đụng A1:F1 hiện có), giống
// tinh thần ensureRankHeaderHasClassColumn ở trên. Coi là "đã đủ" nếu G1 đã
// có giá trị (tránh ghi đè nếu vì lý do gì đó chạy lại nhiều lần).
async function ensureRankHeaderHasStatColumns(sheets) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: THIKIEM_SPREADSHEET_ID,
    range: `'${THIKIEM_RANK_SHEET_NAME}'!G1`,
  });
  const currentValue = (response.data.values || [])[0]?.[0];
  if (!currentValue) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: THIKIEM_SPREADSHEET_ID,
      range: `'${THIKIEM_RANK_SHEET_NAME}'!G1:T1`,
      valueInputOption: 'RAW',
      resource: { values: [RANK_HEADER.slice(6)] },
    });
  }
}

// Gọi 1 lần lúc ClientReady — tạo 2 sheet nếu chưa có (Đua Rank + Config Mùa
// Giải), seed sẵn giá trị mặc định cho Config Mùa Giải nếu vừa tạo mới.
// KHÔNG còn sheet "Mapping Discord-Ingame" riêng nữa — danh sách thành viên
// + tên ingame lấy trực tiếp từ tab "Bang" (SRC_IMAGE_SPREADSHEET_ID, xem
// googleSheets/memberSheet.js -> getMemberInfoByDiscordId()), vì bang đã có
// sẵn danh sách này rồi, không cần bắt thành viên đăng ký lại lần nữa.
async function ensureThiKiemSheetsExist() {
  if (!THIKIEM_SPREADSHEET_ID) return;

  const sheets = await getSheetsClient();

  if (!(await sheetExists(sheets, THIKIEM_RANK_SHEET_NAME))) {
    await addSheetWithHeader(sheets, THIKIEM_RANK_SHEET_NAME, RANK_HEADER);
  } else {
    // Sheet cũ (trước khi có tính năng chia theo Class / trước khi có 14
    // cột thống kê G-T) — bổ sung tiêu đề còn thiếu, không tạo lại/không
    // đụng dữ liệu đã có.
    await ensureRankHeaderHasClassColumn(sheets);
    await ensureRankHeaderHasStatColumns(sheets);
  }

  if (!(await sheetExists(sheets, THIKIEM_CONFIG_SHEET_NAME))) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: THIKIEM_SPREADSHEET_ID,
      resource: { requests: [{ addSheet: { properties: { title: THIKIEM_CONFIG_SHEET_NAME } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: THIKIEM_SPREADSHEET_ID,
      range: `'${THIKIEM_CONFIG_SHEET_NAME}'!A1`,
      valueInputOption: 'RAW',
      resource: { values: DEFAULT_CONFIG_ROWS },
    });
  }
}

// --- Config Mùa Giải (Key | Value) ---

async function getSeasonConfig() {
  const sheets = await getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: THIKIEM_SPREADSHEET_ID,
    range: `'${THIKIEM_CONFIG_SHEET_NAME}'!A:B`,
  });
  const rows = response.data.values || [];
  const config = {};
  rows.forEach(([key, value]) => {
    if (key) config[String(key).trim()] = value !== undefined ? String(value).trim() : '';
  });
  return config;
}

// Upsert 1 hoặc nhiều cặp Key/Value cùng lúc — dùng cho /set-mua-giai (ghi
// nhiều field 1 lượt) lẫn bot tự lưu board_message_id/button_message_id.
async function setSeasonConfigValues(updates) {
  const sheets = await getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: THIKIEM_SPREADSHEET_ID,
    range: `'${THIKIEM_CONFIG_SHEET_NAME}'!A:B`,
  });
  const rows = response.data.values || [];
  const keyToRowIndex = {};
  rows.forEach((row, idx) => {
    if (row[0]) keyToRowIndex[String(row[0]).trim()] = idx;
  });

  const dataUpdates = [];
  const appendRows = [];

  Object.entries(updates).forEach(([key, value]) => {
    if (Object.prototype.hasOwnProperty.call(keyToRowIndex, key)) {
      const rowNumber = keyToRowIndex[key] + 1; // 1-based cho A1 notation
      dataUpdates.push({ range: `'${THIKIEM_CONFIG_SHEET_NAME}'!B${rowNumber}`, values: [[value]] });
    } else {
      appendRows.push([key, value]);
    }
  });

  if (dataUpdates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: THIKIEM_SPREADSHEET_ID,
      resource: { valueInputOption: 'RAW', data: dataUpdates },
    });
  }
  if (appendRows.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: THIKIEM_SPREADSHEET_ID,
      range: `'${THIKIEM_CONFIG_SHEET_NAME}'!A:B`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      resource: { values: appendRows },
    });
  }
}

// --- Đua Rank Thí Kiếm (bảng điểm chính) ---

// Trả về { rows, header } — rows là mảng thô KHÔNG kèm header (mỗi phần tử
// là 1 dòng values thật trên sheet, index tương ứng rowNumber = idx + 2).
async function getAllRankRowsRaw(sheets) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: THIKIEM_SPREADSHEET_ID,
    range: `'${THIKIEM_RANK_SHEET_NAME}'!A2:T`,
  });
  return response.data.values || [];
}

// Đọc 1 giá trị thô từ cột G-T (theo STAT_FIELDS) thành object { soTran,
// soTranThang, ... } — dùng ở cả getAllRankEntries lẫn upsertRankScore (khi
// cần đọc lại dòng cũ để merge). Giữ nguyên dạng string thô từ sheet (kể cả
// rỗng) — chuẩn hoá null/rỗng do nơi gọi tự quyết định.
function parseStatFieldsFromRow(row) {
  const stats = {};
  STAT_FIELDS.forEach((field, idx) => {
    const raw = row[6 + idx];
    stats[field] = raw !== undefined && raw !== '' ? String(raw).trim() : '';
  });
  return stats;
}

// Trả về danh sách đã parse, GIỮ NGUYÊN thứ tự trên sheet (không sort) —
// dùng khi cần tra cứu theo ID. Dùng getLeaderboard() bên dưới nếu cần bảng
// đã sắp xếp theo điểm giảm dần.
// Tập Discord ID đang có trong tab "Bang" — bảng xếp hạng chỉ tính những người này. Trả null (= không lọc) khi
// không đọc được/tab Bang trống, để lỗi đọc sheet không làm cả bảng xếp hạng biến mất hay ghi trắng cột Hạng.
async function getBangIdSet() {
  const members = await getAllBangMembers();
  const ids = new Set(members.map((m) => String(m.discordId || '').trim()).filter(Boolean));
  return ids.size ? ids : null;
}

// Danh sách điểm của những người CÓ trong tab "Bang" (dùng để tính hạng hệ phái ở rank card, /hoso).
async function getBangRankEntries() {
  const [entries, bangIds] = await Promise.all([getAllRankEntries(), getBangIdSet()]);
  return bangIds ? entries.filter((e) => bangIds.has(e.discordId)) : entries;
}

async function getAllRankEntries() {
  const sheets = await getSheetsClient();
  const rows = await getAllRankRowsRaw(sheets);
  return rows
    .map((r, idx) => ({
      rowNumber: idx + 2,
      discordId: (r[0] || '').trim(),
      ingame: (r[1] || '').trim(),
      diem: r[2] !== undefined && r[2] !== '' ? parseInt(r[2], 10) : null,
      hang: r[3] !== undefined && r[3] !== '' ? parseInt(r[3], 10) : null,
      capNhatLuc: (r[4] || '').trim(),
      className: (r[5] || '').trim(),
      ...parseStatFieldsFromRow(r),
    }))
    .filter((r) => r.discordId);
}

async function getRankEntryByDiscordId(discordId) {
  const entries = await getAllRankEntries();
  return entries.find((e) => e.discordId === String(discordId)) || null;
}

// Chuẩn hoá object stats (key theo STAT_FIELDS, value từ Gemini Vision —
// số/string/null/undefined lẫn lộn) thành mảng 14 giá trị ĐÚNG THỨ TỰ cột
// G-T để ghi thẳng vào sheet — null/undefined/rỗng đều thành '' (không ghi
// đè bằng chuỗi "null").
function statsObjectToRowValues(stats) {
  return STAT_FIELDS.map((field) => {
    const value = stats ? stats[field] : undefined;
    return value === null || value === undefined || value === '' ? '' : value;
  });
}

// So sánh & ghi điểm mới cho 1 người — CHỈ update Điểm Rank + Cập nhật lúc
// nếu điểm mới lớn hơn điểm cũ (hoặc chưa có dữ liệu). Nếu điểm mới KHÔNG
// cao hơn, KHÔNG đụng gì tới "Cập nhật lúc" (để họ không mất lượt/rate
// limit). className lấy từ tab "Bang" (memberSheet.js) ngay lúc gửi ảnh —
// ghi lại vào cột F mỗi lần cập nhật (kể cả khi điểm không cao hơn, giống
// Ingame) để bảng xếp hạng chia theo Class (formatLeaderboardEmbed) luôn
// khớp Class MỚI NHẤT của họ bên "Bang" mà không cần tra cứu lại lúc hiển
// thị. stats (object theo STAT_FIELDS, xem geminiVision.js) LUÔN được đồng
// bộ vào cột G-T ở MỌI lần gửi ảnh hợp lệ — kể cả khi điểm rank không cao
// hơn — vì đây chỉ là số liệu thống kê tham khảo của mùa giải (không dùng
// để xếp hạng/rate limit), nên luôn muốn giữ bản MỚI NHẤT đọc được, giống
// tinh thần đồng bộ Ingame/Class. Trả về { updated, oldScore, newScore, isNewRow }.
async function upsertRankScore(discordId, ingame, newScore, className, stats) {
  const sheets = await getSheetsClient();
  const rows = await getAllRankRowsRaw(sheets);
  const rowIndex = rows.findIndex((r) => (r[0] || '').trim() === String(discordId));
  const nowIso = new Date().toISOString();
  const statValues = statsObjectToRowValues(stats);

  if (rowIndex < 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: THIKIEM_SPREADSHEET_ID,
      range: `'${THIKIEM_RANK_SHEET_NAME}'!A:T`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      resource: { values: [[discordId, ingame || '', newScore, '', nowIso, className || '', ...statValues]] },
    });
    return { updated: true, oldScore: null, newScore, isNewRow: true };
  }

  const row = rows[rowIndex];
  const oldScore = row[2] !== undefined && row[2] !== '' ? parseInt(row[2], 10) : null;
  const rowNumber = rowIndex + 2;

  if (oldScore !== null && newScore <= oldScore) {
    // Vẫn cập nhật Ingame/Class (có thể đổi tên nhân vật/đổi Class) + đồng
    // bộ luôn G-T (thống kê tham khảo, không đụng điểm/hạng/rate limit).
    const syncUpdates = [];
    if (ingame && ingame !== row[1]) {
      syncUpdates.push({ range: `'${THIKIEM_RANK_SHEET_NAME}'!B${rowNumber}`, values: [[ingame]] });
    }
    if (className && className !== row[5]) {
      syncUpdates.push({ range: `'${THIKIEM_RANK_SHEET_NAME}'!F${rowNumber}`, values: [[className]] });
    }
    if (stats) {
      syncUpdates.push({ range: `'${THIKIEM_RANK_SHEET_NAME}'!G${rowNumber}:T${rowNumber}`, values: [statValues] });
    }
    if (syncUpdates.length) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: THIKIEM_SPREADSHEET_ID,
        resource: { valueInputOption: 'RAW', data: syncUpdates },
      });
    }
    return { updated: false, oldScore, newScore, isNewRow: false };
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: THIKIEM_SPREADSHEET_ID,
    resource: {
      valueInputOption: 'RAW',
      data: [
        { range: `'${THIKIEM_RANK_SHEET_NAME}'!B${rowNumber}`, values: [[ingame || row[1] || '']] },
        { range: `'${THIKIEM_RANK_SHEET_NAME}'!C${rowNumber}`, values: [[newScore]] },
        { range: `'${THIKIEM_RANK_SHEET_NAME}'!E${rowNumber}`, values: [[nowIso]] },
        { range: `'${THIKIEM_RANK_SHEET_NAME}'!F${rowNumber}`, values: [[className || row[5] || '']] },
        { range: `'${THIKIEM_RANK_SHEET_NAME}'!G${rowNumber}:T${rowNumber}`, values: [statValues] },
      ],
    },
  });

  return { updated: true, oldScore, newScore, isNewRow: false };
}

// Sort toàn bộ theo Điểm Rank giảm dần, ghi đè lại cột Hạng Hiện Tại (D) cho
// TẤT CẢ mọi người, trả về danh sách đã sort (dùng luôn để build embed,
// khỏi phải đọc lại sheet lần nữa).
async function recomputeRanksAndGetLeaderboard() {
  const sheets = await getSheetsClient();
  const [rows, bangIds] = await Promise.all([getAllRankRowsRaw(sheets), getBangIdSet()]);

  const all = rows
    .map((r, idx) => ({
      rowNumber: idx + 2,
      discordId: (r[0] || '').trim(),
      ingame: (r[1] || '').trim(),
      diem: r[2] !== undefined && r[2] !== '' ? parseInt(r[2], 10) : 0,
      className: (r[5] || '').trim(),
    }))
    .filter((e) => e.discordId);

  // Chỉ xếp hạng người đang có Discord ID trong tab "Bang"; người ngoài Bang giữ nguyên dòng điểm nhưng không có hạng.
  const entries = bangIds ? all.filter((e) => bangIds.has(e.discordId)) : all;
  const excluded = bangIds ? all.filter((e) => !bangIds.has(e.discordId)) : [];

  entries.sort((a, b) => b.diem - a.diem);

  const data = [
    ...entries.map((e, idx) => ({ range: `'${THIKIEM_RANK_SHEET_NAME}'!D${e.rowNumber}`, values: [[idx + 1]] })),
    ...excluded.map((e) => ({ range: `'${THIKIEM_RANK_SHEET_NAME}'!D${e.rowNumber}`, values: [['']] })),
  ];
  if (data.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: THIKIEM_SPREADSHEET_ID,
      resource: { valueInputOption: 'RAW', data },
    });
  }

  return entries.map((e, idx) => ({ ...e, hang: idx + 1 }));
}

async function deleteRankRow(discordId) {
  const sheets = await getSheetsClient();
  const response = await sheets.spreadsheets.get({ spreadsheetId: THIKIEM_SPREADSHEET_ID });
  const sheetMeta = (response.data.sheets || []).find((s) => s.properties.title === THIKIEM_RANK_SHEET_NAME);
  if (!sheetMeta) return false;

  const rows = await getAllRankRowsRaw(sheets);
  const rowIndex = rows.findIndex((r) => (r[0] || '').trim() === String(discordId));
  if (rowIndex < 0) return false;

  const sheetId = sheetMeta.properties.sheetId;
  const actualRowIndex = rowIndex + 1; // +1 vì range đọc bắt đầu từ A2 (bỏ header)

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: THIKIEM_SPREADSHEET_ID,
    resource: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: actualRowIndex,
              endIndex: actualRowIndex + 1,
            },
          },
        },
      ],
    },
  });
  return true;
}

// Xoá TOÀN BỘ dữ liệu điểm Rank (giữ lại dòng header) — dùng cho nút
// "Reset Điểm Rank" trên web khi bắt đầu 1 mùa giải mới, không muốn giữ
// điểm cũ lại. KHÔNG đụng tới Config Mùa Giải (tên/thời gian sửa riêng
// qua setSeasonConfigValues) — chỉ xoá value, không xoá luôn cột/định
// dạng, nên dùng values.clear() thay vì deleteDimension.
async function resetAllRankData() {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.clear({
    spreadsheetId: THIKIEM_SPREADSHEET_ID,
    range: `'${THIKIEM_RANK_SHEET_NAME}'!A2:T`,
  });
}

// Chỉ xoá cột E (Cập nhật lúc) của TẤT CẢ mọi người, GIỮ NGUYÊN điểm/hạng
// (cột B/C/D) — dùng để gỡ rate limit THIKIEM_RATE_LIMIT_MS (mặc định 3
// tiếng, xem processThiKiemImage() trong thiKiem/scoreImage.js) hàng loạt 1 lần,
// khác với "Reset Điểm Rank" ở trên (xoá sạch cả điểm). Ca dùng: nhiều
// người bị dính rate limit lúc test (vd gửi ảnh test rồi bị khoá 3 tiếng),
// admin muốn mở khoá ngay cho tất cả mà không mất điểm đã có.
async function resetAllUpdateCooldowns() {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.clear({
    spreadsheetId: THIKIEM_SPREADSHEET_ID,
    range: `'${THIKIEM_RANK_SHEET_NAME}'!E2:E`,
  });
}

module.exports = {
  ensureThiKiemSheetsExist,
  getSeasonConfig,
  setSeasonConfigValues,
  getAllRankEntries,
  getBangRankEntries,
  getRankEntryByDiscordId,
  upsertRankScore,
  recomputeRanksAndGetLeaderboard,
  deleteRankRow,
  resetAllRankData,
  resetAllUpdateCooldowns,
};