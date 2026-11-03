// Lưu/đọc danh sách Discord ID được cấp quyền dùng các tính năng LIÊN QUAN
// TỚI CHAT (/tlmn, set thay profile người khác qua /setpf) ngang với role
// NPC — vào sheet RIÊNG "AccessID" trong BOT_CHAT_HISTORY_SPREADSHEET_ID
// (cùng spreadsheet với ChatGlobal). Đồng bộ 2 chiều với state.accessIds
// (Set trong bộ nhớ, xem state.js) — giống hệt pattern của
// chatChannelAllowsSheet.js (state.chatChannels), chỉ khác đây là danh
// sách 1 cột thay vì cặp (server, kênh).
//
// Cấu trúc sheet "AccessID":
//   A1: "discordId"
//   A2: <Discord ID 1 được cấp quyền>
//   A3: <Discord ID 2 được cấp quyền>
//   ...
// Chỉ ADMIN_USER_ID (config.js) mới thêm được ID mới vào đây, qua lệnh
// /setidsnpc (xem commands/slashCommands.js).

const { google } = require('./googleClient');
const { getGoogleAuthClient } = require('./auth');
const { accessIds } = require('../state');
const { BOT_CHAT_HISTORY_SPREADSHEET_ID, ACCESS_ID_SHEET_NAME } = require('../config');

const HEADER_ROW = ['discordId'];

async function ensureAccessIdSheetExists(authClient) {
  if (!BOT_CHAT_HISTORY_SPREADSHEET_ID) {
    return;
  }

  const sheets = google.sheets({ version: 'v4', auth: authClient });
  const response = await sheets.spreadsheets.get({ spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID });
  const existingSheets = response.data.sheets || [];
  const exists = existingSheets.some((sheet) => sheet.properties.title === ACCESS_ID_SHEET_NAME);

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID,
      resource: {
        requests: [
          {
            addSheet: {
              properties: {
                title: ACCESS_ID_SHEET_NAME,
              },
            },
          },
        ],
      },
    });
  }

  // Đảm bảo có header dòng 1 — kể cả khi sheet đã được TỰ TAY tạo sẵn từ
  // trước (vd tạo thẳng trên Google Sheets UI) mà chưa có header đúng chuẩn.
  const existingValues = await sheets.spreadsheets.values
    .get({
      spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID,
      range: `'${ACCESS_ID_SHEET_NAME}'!A1:A1`,
    })
    .catch(() => ({ data: {} }));

  const rows = (existingValues.data && existingValues.data.values) || [];

  if (rows.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID,
      range: `'${ACCESS_ID_SHEET_NAME}'!A1:A1`,
      valueInputOption: 'RAW',
      resource: { values: [HEADER_ROW] },
    });
  }
}

// Đọc toàn bộ danh sách Discord ID từ sheet và merge vào Set state.accessIds
// đang được các module khác import (mutate trực tiếp qua .add(), KHÔNG tạo
// Set mới — giữ đúng nguyên tắc "state.js là nguồn sự thật trong bộ nhớ").
// Gọi 1 lần lúc ClientReady, TRƯỚC khi bot xử lý bất kỳ lệnh nào.
async function loadAccessIds() {
  if (!BOT_CHAT_HISTORY_SPREADSHEET_ID) {
    console.warn('BOT_CHAT_HISTORY_SPREADSHEET_ID chưa được set. Bỏ qua việc khôi phục accessIds từ sheet AccessID.');
    return;
  }

  try {
    const authClient = await getGoogleAuthClient();
    if (!authClient) {
      return;
    }

    const sheets = google.sheets({ version: 'v4', auth: authClient });

    await ensureAccessIdSheetExists(authClient);

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID,
      range: `'${ACCESS_ID_SHEET_NAME}'!A2:A`,
    });

    const rows = response.data.values || [];

    // Xoá sạch dữ liệu cũ trong bộ nhớ trước khi nạp lại từ sheet, để nếu 1
    // dòng đã bị xoá trực tiếp trên sheet (bằng tay) thì bot cũng đồng bộ
    // theo, không giữ dữ liệu "mồ côi" trong bộ nhớ.
    accessIds.clear();

    for (const row of rows) {
      const discordId = row[0] ? String(row[0]).trim() : '';
      if (discordId) {
        accessIds.add(discordId);
      }
    }

    console.log(`Đã khôi phục ${accessIds.size} accessId từ sheet AccessID.`);
  } catch (error) {
    // Best-effort: nếu đọc thất bại, bot vẫn khởi động bình thường với giá
    // trị mặc định (rỗng) trong state.js — chỉ log lại để biết.
    console.error('Failed to load accessIds from AccessID sheet:', error.message);
  }
}

// Thêm 1 Discord ID mới vào cuối sheet. Gọi sau khi đã thêm xong vào
// state.accessIds trong bộ nhớ (lệnh /setidsnpc). KHÔNG tự kiểm tra trùng
// lặp ở đây — caller (/setidsnpc) tự check accessIds.has() TRƯỚC khi gọi
// hàm này để tránh ghi trùng dòng trên sheet.
async function addAccessIdRow(discordId) {
  if (!BOT_CHAT_HISTORY_SPREADSHEET_ID) {
    console.warn('BOT_CHAT_HISTORY_SPREADSHEET_ID chưa được set. AccessID không được lưu vào Google Sheets.');
    return;
  }

  try {
    const authClient = await getGoogleAuthClient();
    if (!authClient) {
      return;
    }

    const sheets = google.sheets({ version: 'v4', auth: authClient });

    await ensureAccessIdSheetExists(authClient);

    await sheets.spreadsheets.values.append({
      spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID,
      range: `'${ACCESS_ID_SHEET_NAME}'!A:A`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      resource: { values: [[discordId]] },
    });
  } catch (error) {
    console.error('Failed to add accessId row to AccessID sheet:', error.message);
  }
}

// Xoá 1 Discord ID khỏi sheet (dòng đầu tiên khớp đúng giá trị). Gọi SAU khi
// đã xoá khỏi state.accessIds trong bộ nhớ. Dùng cho tính năng Quản lý
// AccessID trên web (trước giờ chưa có lệnh Discord để BỎ quyền, chỉ có
// /setidsnpc để THÊM). Trả về false nếu không tìm thấy discordId đó.
async function removeAccessIdRow(discordId) {
  const targetId = String(discordId).trim();
  if (!BOT_CHAT_HISTORY_SPREADSHEET_ID) {
    throw new Error('BOT_CHAT_HISTORY_SPREADSHEET_ID chưa được set.');
  }

  const authClient = await getGoogleAuthClient();
  if (!authClient) {
    throw new Error('Chưa cấu hình Google Sheets credentials cho bot.');
  }

  const sheets = google.sheets({ version: 'v4', auth: authClient });
  await ensureAccessIdSheetExists(authClient);

  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID });
  const sheetMeta = (spreadsheet.data.sheets || []).find(
    (sheet) => sheet.properties.title === ACCESS_ID_SHEET_NAME
  );
  if (!sheetMeta) return false;
  const sheetId = sheetMeta.properties.sheetId;

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID,
    range: `'${ACCESS_ID_SHEET_NAME}'!A2:A`,
  });
  const rows = response.data.values || [];

  const rowIndex = rows.findIndex((row) => String(row[0] || '').trim() === targetId);
  if (rowIndex === -1) return false;

  const sheetRowNumber = rowIndex + 2;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: BOT_CHAT_HISTORY_SPREADSHEET_ID,
    resource: {
      requests: [
        {
          deleteDimension: {
            range: { sheetId, dimension: 'ROWS', startIndex: sheetRowNumber - 1, endIndex: sheetRowNumber },
          },
        },
      ],
    },
  });

  return true;
}

module.exports = {
  ensureAccessIdSheetExists,
  loadAccessIds,
  addAccessIdRow,
  removeAccessIdRow,
};
