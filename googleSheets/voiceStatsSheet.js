// Tab "Voice Bang" (Google Sheet chính, SPREADSHEET_ID) — mỗi dòng là 1 lượt
// ngồi voice trong danh mục Bang Chiến/Scrim:
//   A = Ngày (YYYY-MM-DD, giờ VN)   B = Discord ID   C = Ingame/tên
//   D = Kênh voice                  E = Vào lúc       F = Ra lúc (YYYY-MM-DD HH:mm)
//   G = Số phút                     H = Loại (Bang Chiến | Scrim | Khác)
const { google } = require('./googleClient');
const { getGoogleAuthClient } = require('./auth');
const { SPREADSHEET_ID, VOICE_STATS_SHEET_NAME } = require('../config');

const HEADER_ROW = ['Ngày', 'Discord ID', 'Ingame', 'Kênh voice', 'Vào lúc', 'Ra lúc', 'Số phút', 'Loại'];

async function getSheetsClient() {
  const authClient = await getGoogleAuthClient();
  if (!authClient) throw new Error('Chưa cấu hình Google Sheets credentials cho bot.');
  return google.sheets({ version: 'v4', auth: authClient });
}

async function ensureVoiceStatsSheet() {
  if (!SPREADSHEET_ID) return;
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties.title' });
  const exists = (meta.data.sheets || []).some((s) => s.properties.title === VOICE_STATS_SHEET_NAME);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { requests: [{ addSheet: { properties: { title: VOICE_STATS_SHEET_NAME } } }] },
    });
  }
  const head = await sheets.spreadsheets.values
    .get({ spreadsheetId: SPREADSHEET_ID, range: `'${VOICE_STATS_SHEET_NAME}'!A1:H1` })
    .catch(() => ({ data: {} }));
  if (!((head.data && head.data.values) || []).length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${VOICE_STATS_SHEET_NAME}'!A1:H1`,
      valueInputOption: 'RAW',
      resource: { values: [HEADER_ROW] },
    });
  }
}

async function appendVoiceRows(rows) {
  if (!rows.length) return;
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${VOICE_STATS_SHEET_NAME}'!A:H`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    resource: { values: rows },
  });
}

// Trả về [{ date, discordId, ingame, channel, minutes, type }] có Ngày >= sinceDateKey ('' = tất cả).
async function readVoiceRows(sinceDateKey = '') {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${VOICE_STATS_SHEET_NAME}'!A2:H`,
  });
  return (res.data.values || [])
    .map((r) => ({
      date: String(r[0] || '').trim(),
      discordId: String(r[1] || '').trim(),
      ingame: String(r[2] || '').trim(),
      channel: String(r[3] || '').trim(),
      minutes: Number(r[6]) || 0,
      type: String(r[7] || '').trim(),
    }))
    .filter((r) => r.discordId && r.date >= sinceDateKey);
}

module.exports = { ensureVoiceStatsSheet, appendVoiceRows, readVoiceRows };
