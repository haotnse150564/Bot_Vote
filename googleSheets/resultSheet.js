const { google } = require('./googleClient');
const { getGoogleAuthClient } = require('./auth');
const { syncDkScrimSheets } = require('./dkScrimSheet');
const { SPREADSHEET_ID, SHEET_NAME, DSB_SHEET_NAME, RESULT_SHEET_NAME, AUTOVOTE_REACTION_TAG } = require('../config');

async function ensureResultSheet(authClient) {
  if (!SPREADSHEET_ID) {
    return;
  }

  const sheets = google.sheets({ version: 'v4', auth: authClient });
  const response = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existingSheets = response.data.sheets || [];
  const exists = existingSheets.some((sheet) => sheet.properties.title === RESULT_SHEET_NAME);

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: {
        requests: [
          {
            addSheet: {
              properties: {
                title: RESULT_SHEET_NAME,
              },
            },
          },
        ],
      },
    });
  }
}

// Đọc DSB (danh sách thành viên) + BotVote (log từng lượt vote thô) rồi build:
//  - resultRows: bảng chi tiết theo từng người (ID/Ingame/Class + X ở đúng
//    cột ngày họ đã vote) — y hệt logic gốc.
//  - summary: 5 số tổng hợp (tổng vote Thứ 4/5/6, tổng "Không Đánh", và số
//    người CHƯA vote ngày nào cả) — dùng để ghi thêm 5 cột tổng hợp vào sheet
//    VÀ để tin nhắn auto chat "Cập nhật tình hình vote" (AutoReply/index.js)
//    lấy số mà không phải đọc/parse lại sheet 1 lần nữa.
// sheets: instance đã tạo sẵn (Sheets API client) — truyền vào để tái dùng,
// tránh phải lấy authClient/tạo sheets instance nhiều lần không cần thiết.
async function computeVoteData(sheets) {
  const dsbResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${DSB_SHEET_NAME}!A:D`,
  });

  const dsbRows = dsbResponse.data.values || [];

  if (!dsbRows.length) {
    console.warn(`No rows found in ${DSB_SHEET_NAME}. Cannot build result sheet.`);
    return null;
  }

  const voteResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:H`,
  });

  const voteRows = voteResponse.data.values || [];
  const votesByUser = {};
  // Những userId có ÍT NHẤT 1 lượt vote TAY (reaction khác 'auto') — dùng cho
  // cột "Auto" trên web để phân biệt "đang auto vote" với "có role auto vote
  // nhưng vote tay". Không ảnh hưởng bảng A:G/summary bên dưới.
  const manualVoterIds = new Set();

  if (voteRows.length > 1) {
    for (let i = 1; i < voteRows.length; i += 1) {
      const row = voteRows[i];
      const userId = row[4] !== undefined && row[4] !== null ? String(row[4]).trim() : '';
      const day = row[6] !== undefined && row[6] !== null ? String(row[6]).trim() : '';

      if (!userId || !day) continue;

      const reactionTag = row[7] !== undefined && row[7] !== null ? String(row[7]).trim() : '';

      if (reactionTag !== AUTOVOTE_REACTION_TAG) {
        manualVoterIds.add(userId);
      }

      if (!votesByUser[userId]) {
        votesByUser[userId] = new Set();
      }

      votesByUser[userId].add(day);
    }
  }

  const header = ['ID', 'Ingame', 'Class', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Không Đánh'];
  const resultRows = [header];

  const headerRow = dsbRows[0].map((cell) => String(cell).trim().toLowerCase());
  const idIndex = headerRow.indexOf('id');
  const ingameIndex = headerRow.indexOf('ingame');
  const classIndex = headerRow.indexOf('class');

  // 5 số tổng hợp: tổng số vote Thứ 4/5/6, tổng "Không Đánh", và số người
  // KHÔNG vote ngày nào cả trong 4 cột trên (4/5/6/0 đều trống).
  let totalThu4 = 0;
  let totalThu5 = 0;
  let totalThu6 = 0;
  let totalKhongDanh = 0;
  let notVotedCount = 0;

  for (let i = 1; i < dsbRows.length; i += 1) {
    const row = dsbRows[i];
    const id = (idIndex >= 0 && row[idIndex]) ? String(row[idIndex]).trim() : (row[0] ? String(row[0]).trim() : '');
    const ingame = (ingameIndex >= 0 && row[ingameIndex]) ? String(row[ingameIndex]).trim() : (row[1] ? String(row[1]).trim() : '');
    const className = (classIndex >= 0 && row[classIndex])
      ? String(row[classIndex]).trim()
      : ((row[3] !== undefined && row[3] !== null) ? String(row[3]).trim() : (row[2] ? String(row[2]).trim() : ''));

    if (!id) continue;

    const trimmedId = String(id).trim();
    const hasDay4 = Object.keys(votesByUser).some((votedId) => String(votedId).trim() === trimmedId && votesByUser[votedId].has('4'));
    const hasDay5 = Object.keys(votesByUser).some((votedId) => String(votedId).trim() === trimmedId && votesByUser[votedId].has('5'));
    const hasDay6 = Object.keys(votesByUser).some((votedId) => String(votedId).trim() === trimmedId && votesByUser[votedId].has('6'));
    const hasDay0 = Object.keys(votesByUser).some((votedId) => String(votedId).trim() === trimmedId && votesByUser[votedId].has('0'));

    if (hasDay4) totalThu4 += 1;
    if (hasDay5) totalThu5 += 1;
    if (hasDay6) totalThu6 += 1;
    if (hasDay0) totalKhongDanh += 1;
    if (!hasDay4 && !hasDay5 && !hasDay6 && !hasDay0) notVotedCount += 1;

    const dayValues = [
      hasDay4 ? 'X' : '',
      hasDay5 ? 'X' : '',
      hasDay6 ? 'X' : '',
      hasDay0 ? 'X' : '',
    ];

    resultRows.push([id, ingame, className, dayValues[0], dayValues[1], dayValues[2], dayValues[3]]);
  }

  return {
    resultRows,
    summary: { totalThu4, totalThu5, totalThu6, totalKhongDanh, notVotedCount },
    manualVoterIds,
  };
}

// Gộp các lần refresh dồn dập: chỉ 1 lần chạy tại 1 thời điểm + tối đa 1 lần
// chờ kế tiếp (chạy SAU KHI lần đang chạy xong nên luôn đọc dữ liệu mới nhất).
// Trước đây nhiều lần refresh chạy song song, lần đọc CŨ hơn có thể ghi SAU cùng
// và đè bảng "Kết Quả Vote" bằng dữ liệu cũ.
let refreshRunning = null;
let refreshQueued = null;

function refreshResultSheet() {
  if (!refreshRunning) {
    refreshRunning = runRefreshResultSheet().finally(() => {
      refreshRunning = null;
    });
    return refreshRunning;
  }

  if (!refreshQueued) {
    refreshQueued = refreshRunning
      .catch(() => {})
      .then(() => {
        refreshQueued = null;
        return refreshResultSheet();
      });
  }

  return refreshQueued;
}

async function runRefreshResultSheet() {
  if (!SPREADSHEET_ID) {
    return;
  }

  const authClient = await getGoogleAuthClient();

  if (!authClient) {
    return;
  }

  const sheets = google.sheets({ version: 'v4', auth: authClient });

  try {
    await ensureResultSheet(authClient);

    const data = await computeVoteData(sheets);

    if (!data) {
      return;
    }

    const { resultRows, summary } = data;

    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `${RESULT_SHEET_NAME}!A1:Z`,
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${RESULT_SHEET_NAME}!A1:G${resultRows.length}`,
      valueInputOption: 'RAW',
      resource: {
        values: resultRows,
      },
    });

    // 5 cột tổng hợp — đặt cách bảng chi tiết theo người (A:G) 1 cột trống
    // (H), bắt đầu từ cột I, để không đụng vào/không bị đụng bởi bảng A:G
    // dù danh sách thành viên (DSB) dài ngắn thế nào.
    const summaryHeader = ['Tổng Thứ 4', 'Tổng Thứ 5', 'Tổng Thứ 6', 'Tổng Không Đánh', 'Chưa Vote'];
    const summaryValues = [
      summary.totalThu4,
      summary.totalThu5,
      summary.totalThu6,
      summary.totalKhongDanh,
      summary.notVotedCount,
    ];

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${RESULT_SHEET_NAME}!I1:M2`,
      valueInputOption: 'RAW',
      resource: {
        values: [summaryHeader, summaryValues],
      },
    });

    console.log(`Updated result sheet ${RESULT_SHEET_NAME}.`);

    // Tự động đồng bộ danh sách "Đã Đăng Ký" vào DKScrimBang1/DKScrimBang2
    // (sheet nguồn khác) mỗi khi "Kết Quả Vote" vừa được cập nhật xong.
    // Tái dùng resultRows đã tính sẵn ở trên, không đọc lại Sheets API.
    await syncDkScrimSheets(resultRows);
  } catch (error) {
    console.error('Failed to refresh result sheet:', error.message);
  }
}

// Chỉ lấy 5 số tổng hợp (không ghi gì vào sheet cả) — dùng cho tin nhắn auto
// chat "Cập nhật tình hình vote" (AutoReply/index.js -> checkVoteStatusAutoChat)
// để không phải chờ/khởi tạo cả sheet "Kết Quả Vote" mỗi lần gửi tin.
async function getVoteSummary() {
  if (!SPREADSHEET_ID) {
    return null;
  }

  const authClient = await getGoogleAuthClient();

  if (!authClient) {
    return null;
  }

  try {
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const data = await computeVoteData(sheets);
    return data ? data.summary : null;
  } catch (error) {
    console.error('Failed to compute vote summary:', error.message);
    return null;
  }
}

// Lấy CẢ bảng chi tiết theo người (resultRows) LẪN 5 số tổng hợp (summary),
// không ghi gì vào sheet — dùng cho dashboard kết quả vote trên web (khác
// getVoteSummary() ở trên chỉ trả 5 số tổng hợp, không đủ để hiển thị
// bảng "ai đã/chưa vote" từng người trên web).
//
// autoRoleIds (tuỳ chọn): Set userId đang giữ role auto-vote. Có truyền thì mỗi
// người có thêm autoStatus:
//   'auto'   — có role và KHÔNG vote tay (đang auto vote)      -> web hiện ✔
//   'manual' — có role nhưng đã vote tay                         -> web hiện O
//   'none'   — không có role auto-vote                           -> web hiện X
// Không truyền (vd resetVoteSheet gọi) thì autoStatus = null, như cũ.
async function getVoteDetail({ autoRoleIds = null } = {}) {
  if (!SPREADSHEET_ID) {
    return null;
  }

  const authClient = await getGoogleAuthClient();
  if (!authClient) {
    return null;
  }

  try {
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const data = await computeVoteData(sheets);
    if (!data) return null;

    const [header, ...rows] = data.resultRows;
    const autoSummary = { auto: 0, manual: 0, none: 0 };

    const people = rows.map((row) => {
      const id = row[0] || '';
      const trimmedId = String(id).trim();
      let autoStatus = null;

      if (autoRoleIds) {
        if (!autoRoleIds.has(trimmedId)) {
          autoStatus = 'none';
        } else if (data.manualVoterIds.has(trimmedId)) {
          autoStatus = 'manual';
        } else {
          autoStatus = 'auto';
        }
        autoSummary[autoStatus] += 1;
      }

      return {
        id,
        ingame: row[1] || '',
        className: row[2] || '',
        thu4: row[3] === 'X',
        thu5: row[4] === 'X',
        thu6: row[5] === 'X',
        khongDanh: row[6] === 'X',
        autoStatus,
      };
    });

    return { people, summary: data.summary, autoSummary: autoRoleIds ? autoSummary : null };
  } catch (error) {
    console.error('Failed to compute vote detail:', error.message);
    return null;
  }
}

module.exports = { ensureResultSheet, refreshResultSheet, getVoteSummary, getVoteDetail };