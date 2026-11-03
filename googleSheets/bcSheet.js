const { google } = require('./googleClient');
const client = require('../client');
const { getGoogleAuthClient } = require('./auth');
const { bcData } = require('../state');
const { formatBcMessage } = require('../bc/format');
const { SPREADSHEET_ID, DSB_SHEET_NAME, BC_SHEET_NAME, SRC_IMAGE_SPREADSHEET_ID, SRC_IMAGE_TARGETS } = require('../config');

// Điền tên ingame của những người đã thả :offline: vào ô M23:N37 ở tab
// "Bang Chiến" trong Google Sheet DÙNG ĐỂ CHỤP ẢNH (SRC_IMAGE_SPREADSHEET_ID
// — khác spreadsheet với SPREADSHEET_ID lưu vote-off ở trên). 15 hàng x 2
// cột = tối đa 30 người: 15 tên đầu vào cột M (M23->M37), 15 tên tiếp theo
// vào cột N (N23->N37).
const OFFLINE_NAMES_START_ROW = 23;
const OFFLINE_NAMES_END_ROW = 37;
const OFFLINE_NAMES_ROWS_PER_COLUMN = OFFLINE_NAMES_END_ROW - OFFLINE_NAMES_START_ROW + 1; // 15

async function writeOfflineNamesToBcSheet(offlineList) {
  if (!SRC_IMAGE_SPREADSHEET_ID) return;

  const authClient = await getGoogleAuthClient();

  if (!authClient) return;

  const sheetTitle = (SRC_IMAGE_TARGETS.bc && SRC_IMAGE_TARGETS.bc.sheetTitle) || 'Bang Chiến';
  const sheets = google.sheets({ version: 'v4', auth: authClient });

  const names = offlineList.map((entry) => (entry && entry.ingame) || '').filter(Boolean);
  const maxCapacity = OFFLINE_NAMES_ROWS_PER_COLUMN * 2;

  if (names.length > maxCapacity) {
    console.warn(`Có ${names.length} người offline nhưng ${sheetTitle}!M23:N37 chỉ chứa được tối đa ${maxCapacity} — ${names.length - maxCapacity} người cuối bị cắt bớt.`);
  }

  // Luôn ghi đủ 15 hàng (kể cả rỗng '') để XOÁ tên cũ của tuần/lần trước
  // còn sót lại trong ô, thay vì chỉ ghi đè phần có tên mới.
  const values = [];

  for (let i = 0; i < OFFLINE_NAMES_ROWS_PER_COLUMN; i += 1) {
    values.push([
      names[i] || '',
      names[OFFLINE_NAMES_ROWS_PER_COLUMN + i] || '',
    ]);
  }

  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SRC_IMAGE_SPREADSHEET_ID,
      range: `${sheetTitle}!M${OFFLINE_NAMES_START_ROW}:N${OFFLINE_NAMES_END_ROW}`,
      valueInputOption: 'RAW',
      resource: { values },
    });

    console.log(`Đã điền ${names.length} tên offline vào ${sheetTitle}!M23:N37.`);
  } catch (error) {
    console.error('Lỗi khi điền tên offline vào sheet chụp ảnh (M23:N37):', error.message);
  }
}

async function ensureBcSheetExists(authClient) {
  if (!SPREADSHEET_ID) {
    return;
  }

  const sheets = google.sheets({ version: 'v4', auth: authClient });
  const response = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existingSheets = response.data.sheets || [];
  const exists = existingSheets.some((sheet) => sheet.properties.title === BC_SHEET_NAME);

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: {
        requests: [
          {
            addSheet: {
              properties: {
                title: BC_SHEET_NAME,
              },
            },
          },
        ],
      },
    });
  }
}

async function ensureBcSheetHeaders(authClient) {
  if (!SPREADSHEET_ID) {
    return;
  }

  const sheets = google.sheets({ version: 'v4', auth: authClient });

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${BC_SHEET_NAME}!A1:A1`,
    });

    if (response.data.values && response.data.values.length > 0) {
      return;
    }
  } catch (error) {
    // Ignore "range not found" errors and create the header row.
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${BC_SHEET_NAME}!A1:A1`,
    valueInputOption: 'RAW',
    resource: {
      values: [['userId']],
    },
  });
}

async function resetOffVoteSheet() {
  if (!SPREADSHEET_ID) {
    return;
  }

  const authClient = await getGoogleAuthClient();

  if (!authClient) {
    return;
  }

  const sheets = google.sheets({ version: 'v4', auth: authClient });

  try {
    await ensureBcSheetExists(authClient);

    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `${BC_SHEET_NAME}!A2:Z`,
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${BC_SHEET_NAME}!A1:A1`,
      valueInputOption: 'RAW',
      resource: {
        values: [['userId']],
      },
    });

    console.log(`Reset off-vote sheet ${BC_SHEET_NAME}.`);
  } catch (error) {
    console.error('Failed to reset off-vote sheet:', error.message);
  }
}

async function addOffVote(userId) {
  if (!SPREADSHEET_ID) {
    console.warn('GOOGLE_SHEET_ID is not set. Off-vote not saved to Google Sheets.');
    return;
  }

  const authClient = await getGoogleAuthClient();

  if (!authClient) {
    return;
  }

  try {
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    await ensureBcSheetExists(authClient);
    await ensureBcSheetHeaders(authClient);

    const existingResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${BC_SHEET_NAME}!A:A`,
    });

    const existingRows = existingResponse.data.values || [];
    const alreadyVoted = existingRows.slice(1).some(
      (row) => row[0] !== undefined && String(row[0]).trim() === String(userId).trim()
    );

    if (alreadyVoted) {
      return;
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${BC_SHEET_NAME}!A:A`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      resource: {
        values: [[userId]],
      },
    });

    console.log(`Saved off-vote for user ${userId} in Google Sheets.`);
    await refreshBcMessage();
  } catch (error) {
    console.error('Failed to save off-vote to Google Sheets:', error.message);
  }
}

async function removeOffVote(userId) {
  if (!SPREADSHEET_ID) {
    console.warn('GOOGLE_SHEET_ID is not set. Off-vote not removed from Google Sheets.');
    return;
  }

  const authClient = await getGoogleAuthClient();

  if (!authClient) {
    return;
  }

  try {
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    const spreadsheetResponse = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const sheetsData = spreadsheetResponse.data.sheets || [];
    const bcSheetData = sheetsData.find((sheet) => sheet.properties.title === BC_SHEET_NAME);

    if (!bcSheetData) {
      console.warn(`Sheet ${BC_SHEET_NAME} not found in spreadsheet.`);
      return;
    }

    const sheetId = bcSheetData.properties.sheetId;

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${BC_SHEET_NAME}!A:A`,
    });

    const rows = response.data.values || [];
    const rowsToDelete = [];

    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i];
      const rowUserId = row[0] !== undefined && row[0] !== null ? String(row[0]).trim() : '';

      if (rowUserId === String(userId).trim()) {
        rowsToDelete.push(i + 1);
      }
    }

    if (rowsToDelete.length === 0) {
      console.log(`No off-vote found for user ${userId}.`);
      return;
    }

    const requests = rowsToDelete.reverse().map((rowIndex) => ({
      deleteDimension: {
        range: {
          sheetId,
          dimension: 'ROWS',
          startIndex: rowIndex - 1,
          endIndex: rowIndex,
        },
      },
    }));

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: {
        requests,
      },
    });

    console.log(`Removed off-vote for user ${userId} from Google Sheets.`);
    await refreshBcMessage();
  } catch (error) {
    console.error('Failed to remove off-vote from Google Sheets:', error.message);
  }
}

async function refreshBcMessage() {
  if (!SPREADSHEET_ID || !bcData.messageId || !bcData.channelId) {
    return;
  }

  const authClient = await getGoogleAuthClient();

  if (!authClient) {
    return;
  }

  const sheets = google.sheets({ version: 'v4', auth: authClient });

  try {
    const voteResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${BC_SHEET_NAME}!A:A`,
    });

    const voteRows = voteResponse.data.values || [];
    const userIds = voteRows.slice(1)
      .map((row) => (row[0] !== undefined && row[0] !== null ? String(row[0]).trim() : ''))
      .filter(Boolean);

    let offlineList = [];

    if (userIds.length > 0) {
      const dsbResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${DSB_SHEET_NAME}!A:D`,
      });

      const dsbRows = dsbResponse.data.values || [];

      if (dsbRows.length > 0) {
        const headerRow = dsbRows[0].map((cell) => String(cell).trim().toLowerCase());
        const idIndex = headerRow.indexOf('id');
        const ingameIndex = headerRow.indexOf('ingame');
        const classIndex = headerRow.indexOf('class');

        const dsbMap = {};

        for (let i = 1; i < dsbRows.length; i += 1) {
          const row = dsbRows[i];
          const id = (idIndex >= 0 && row[idIndex]) ? String(row[idIndex]).trim() : (row[0] ? String(row[0]).trim() : '');

          if (!id) continue;

          const ingame = (ingameIndex >= 0 && row[ingameIndex]) ? String(row[ingameIndex]).trim() : (row[1] ? String(row[1]).trim() : '');
          const className = (classIndex >= 0 && row[classIndex])
            ? String(row[classIndex]).trim()
            : ((row[3] !== undefined && row[3] !== null) ? String(row[3]).trim() : (row[2] ? String(row[2]).trim() : ''));

          dsbMap[id] = { ingame, class: className };
        }

        offlineList = userIds.map((id) => dsbMap[id] || { ingame: id, class: '' });
      } else {
        offlineList = userIds.map((id) => ({ ingame: id, class: '' }));
      }
    }

    const channel = await client.channels.fetch(bcData.channelId);
    const bcMessage = await channel.messages.fetch(bcData.messageId);

    await bcMessage.edit({
      content: formatBcMessage(offlineList),
      allowedMentions: { roles: [] },
    });

    console.log('Updated bang chien message with offline list.');

    // Đồng thời điền tên vào sheet chụp ảnh (M23:N37) — hàm này tự bắt lỗi
    // riêng bên trong, không throw ra ngoài, nên không ảnh hưởng tới việc
    // cập nhật tin nhắn Discord ở trên dù có lỗi.
    await writeOfflineNamesToBcSheet(offlineList);
  } catch (error) {
    console.error('Failed to refresh bang chien message:', error.message);
  }
}

module.exports = {
  ensureBcSheetExists,
  ensureBcSheetHeaders,
  resetOffVoteSheet,
  addOffVote,
  removeOffVote,
  refreshBcMessage,
  writeOfflineNamesToBcSheet,
};