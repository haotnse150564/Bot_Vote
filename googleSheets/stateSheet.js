// Lưu/đọc scrimData, bcData, srcImageData (từ state.js) vào 1 sheet riêng
// ("BotState") để dữ liệu không bị mất mỗi khi bot được deploy lại (bộ nhớ
// trong process bị xóa sạch mỗi lần restart, ví dụ trên Railway).
//
// LƯU Ý: chatChannels (kênh chat được phép/server) KHÔNG lưu ở đây nữa —
// đã tách sang sheet riêng "ChatChanelAllows" (xem
// googleSheets/chatChannelAllowsSheet.js) dạng bảng serverId | channelId
// dễ xem/sửa tay hơn, tránh lưu trùng lặp 1 loại dữ liệu ở 2 chỗ.
//
// Cấu trúc sheet BotState:
//   A1: "key"           B1: "value"
//   A2: "scrimData"      B2: <JSON.stringify(scrimData)>
//   A3: "bcData"         B3: <JSON.stringify(bcData)>
//   A4: "srcImageData"   B4: <JSON.stringify(srcImageData)>
//   A5: "checkGearData"  B5: <JSON.stringify(checkGearData)>
//
// saveState() ghi đè 4 dòng trên mỗi khi được gọi (fixed range A2:B5).
// loadState() đọc lại 4 dòng đó và merge (Object.assign) vào ĐÚNG object
// scrimData/bcData/srcImageData/checkGearData đang được các module khác
// import — không tạo object mới, để giữ nguyên hành vi "mutate trực tiếp"
// như code gốc.

const { google } = require('./googleClient');
const { getGoogleAuthClient } = require('./auth');
const { scrimData, bcData, srcImageData, checkGearData } = require('../state');
const { SPREADSHEET_ID, STATE_SHEET_NAME } = require('../config');

async function ensureStateSheetExists(authClient) {
  if (!SPREADSHEET_ID) {
    return;
  }

  const sheets = google.sheets({ version: 'v4', auth: authClient });
  const response = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existingSheets = response.data.sheets || [];
  const exists = existingSheets.some((sheet) => sheet.properties.title === STATE_SHEET_NAME);

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: {
        requests: [
          {
            addSheet: {
              properties: {
                title: STATE_SHEET_NAME,
              },
            },
          },
        ],
      },
    });
  }

  // Đảm bảo có header + 4 dòng key cố định
  // (scrimData/bcData/srcImageData/checkGearData), kể cả khi sheet vừa
  // được tạo hoặc đang trống — để loadState()/saveState() sau này luôn
  // thao tác đúng trên range A2:B5.
  const existingValues = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${STATE_SHEET_NAME}!A1:B5`,
  }).catch(() => ({ data: {} }));

  const rows = (existingValues.data && existingValues.data.values) || [];

  if (rows.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${STATE_SHEET_NAME}!A1:B5`,
      valueInputOption: 'RAW',
      resource: {
        values: [
          ['key', 'value'],
          ['scrimData', JSON.stringify(scrimData)],
          ['bcData', JSON.stringify(bcData)],
          ['srcImageData', JSON.stringify(srcImageData)],
          ['checkGearData', JSON.stringify(checkGearData)],
        ],
      },
    });
  } else if (rows.length < 5) {
    // Sheet cũ đã tồn tại từ trước khi có srcImageData/checkGearData ->
    // chỉ thêm (các) dòng còn thiếu, không đụng vào dòng đã có sẵn.
    const missingRows = [];
    if (rows.length < 4) missingRows.push(['srcImageData', JSON.stringify(srcImageData)]);
    missingRows.push(['checkGearData', JSON.stringify(checkGearData)]);

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${STATE_SHEET_NAME}!A${rows.length + 1}:B5`,
      valueInputOption: 'RAW',
      resource: {
        values: missingRows,
      },
    });
  }
}

// Ghi đè toàn bộ scrimData + bcData + srcImageData hiện tại (in-memory)
// xuống sheet. Gọi hàm này ngay sau mỗi lần các state này bị thay đổi để
// đảm bảo dữ liệu luôn được lưu kịp thời, không đợi tới lúc deploy mới mất
// dữ liệu.
async function saveState() {
  if (!SPREADSHEET_ID) {
    return;
  }

  try {
    const authClient = await getGoogleAuthClient();
    if (!authClient) {
      return;
    }

    const sheets = google.sheets({ version: 'v4', auth: authClient });

    await ensureStateSheetExists(authClient);

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${STATE_SHEET_NAME}!A2:B5`,
      valueInputOption: 'RAW',
      resource: {
        values: [
          ['scrimData', JSON.stringify(scrimData)],
          ['bcData', JSON.stringify(bcData)],
          ['srcImageData', JSON.stringify(srcImageData)],
          ['checkGearData', JSON.stringify(checkGearData)],
        ],
      },
    });
  } catch (error) {
    // Best-effort: nếu lưu thất bại (vd lỗi mạng, quota Google Sheets),
    // không được làm crash bot — chỉ log lại để biết.
    console.error('Failed to save bot state to Google Sheets:', error.message);
  }
}

// Đọc scrimData/bcData/srcImageData đã lưu từ sheet và merge vào object
// hiện có. Gọi 1 lần lúc ClientReady, TRƯỚC khi bot xử lý bất kỳ lệnh nào.
async function loadState() {
  if (!SPREADSHEET_ID) {
    console.warn('GOOGLE_SHEET_ID chưa được set. Bỏ qua việc khôi phục scrimData/bcData/srcImageData từ Google Sheets.');
    return;
  }

  try {
    const authClient = await getGoogleAuthClient();
    if (!authClient) {
      return;
    }

    const sheets = google.sheets({ version: 'v4', auth: authClient });

    await ensureStateSheetExists(authClient);

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${STATE_SHEET_NAME}!A2:B5`,
    });

    const rows = response.data.values || [];

    for (const row of rows) {
      const key = row[0];
      const rawValue = row[1];

      if (!key || !rawValue) continue;

      let parsed;
      try {
        parsed = JSON.parse(rawValue);
      } catch (parseError) {
        console.error(`Failed to parse saved state for key "${key}":`, parseError.message);
        continue;
      }

      if (key === 'scrimData' && parsed && typeof parsed === 'object') {
        Object.assign(scrimData, parsed);
      } else if (key === 'bcData' && parsed && typeof parsed === 'object') {
        Object.assign(bcData, parsed);
      } else if (key === 'srcImageData' && parsed && typeof parsed === 'object') {
        Object.assign(srcImageData, parsed);
      } else if (key === 'checkGearData' && parsed && typeof parsed === 'object') {
        Object.assign(checkGearData, parsed);
      }
    }

    console.log('Đã khôi phục scrimData/bcData/srcImageData/checkGearData từ Google Sheets.');
  } catch (error) {
    // Best-effort: nếu đọc thất bại, bot vẫn khởi động bình thường với giá
    // trị mặc định trong state.js — chỉ log lại để biết.
    console.error('Failed to load bot state from Google Sheets:', error.message);
  }
}

module.exports = {
  ensureStateSheetExists,
  saveState,
  loadState,
};
