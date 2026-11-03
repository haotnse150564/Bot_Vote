// Đọc tab "Bang" trong Google Sheet NGUỒN (cùng spreadsheet với
// SRC_IMAGE_SPREADSHEET_ID dùng để chụp ảnh Scrim 1/2/Bang Chiến và tab
// "List BC/Scrim") để tra cứu Ingame + Class theo Discord ID — phục vụ
// auto-chat AI (AutoReply/aiClient.js) xưng hô đúng tên/class như bạn bè
// trong game thay vì chat vô danh.
//
// Cấu trúc cột trong tab "Bang" (khai báo ở config.js -> BANG_SHEET_COLUMNS):
//   A = Discord ID, C = Ingame, D = Class, O = Không Trong Bang (đánh dấu
//   "x" khi thành viên đã rời bang — dùng thay cho việc xoá hẳn dòng, xem
//   getBangMemberList/updateBangMember bên dưới). Cột này CÙNG Ý NGHĨA với
//   cột O mà NMTeam/server.js (NAME_RANGES.Bang) đang đọc cho tính năng "Tự
//   Động" xếp team — chỉ ghi thêm giá trị "x"/"", KHÔNG đụng cột F-N khác
//   (Cố định/Theo Vị Trí/Theo team/Dự Bị/Skill 1-5).

const { google } = require('./googleClient');
const { getGoogleAuthClient } = require('./auth');
const { SRC_IMAGE_SPREADSHEET_ID, BANG_SHEET_NAME, BANG_SHEET_COLUMNS } = require('../config');
// (SRC_IMAGE_SPREADSHEET_ID đã import ở trên — dùng chung cho cả đọc lẫn
// ghi tab "Bang", không cần thêm require nào khác.)

const COLUMN_INDEX = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, I: 8, J: 9, K: 10, L: 11, M: 12, N: 13, O: 14 };

// Cache trong bộ nhớ để tránh gọi Sheets API mỗi lần bot chat (auto-chat có
// thể trigger rất thường xuyên). Hết hạn sau MEMBER_CACHE_TTL_MS rồi mới
// đọc lại — đủ mới để cập nhật khi có thành viên mới mà không tốn quota API.
const MEMBER_CACHE_TTL_MS = 5 * 60 * 1000; // 5 phút
let cachedRows = null;
let cachedAt = 0;

async function fetchBangSheetRows() {
  const auth = await getGoogleAuthClient();
  if (!auth) {
    throw new Error('Chưa cấu hình Google Sheets credentials cho bot.');
  }

  const sheets = google.sheets({ version: 'v4', auth });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SRC_IMAGE_SPREADSHEET_ID,
    // A1:O1000 — đủ rộng cho toàn bộ danh sách hiện tại (kể cả cột O =
    // Không Trong Bang), không cần biết trước số hàng thật sự có dữ liệu.
    range: `'${BANG_SHEET_NAME}'!A1:O1000`,
  });

  return response.data.values || [];
}

async function getBangSheetRows() {
  const isExpired = Date.now() - cachedAt > MEMBER_CACHE_TTL_MS;
  if (cachedRows && !isExpired) return cachedRows;

  cachedRows = await fetchBangSheetRows();
  cachedAt = Date.now();
  return cachedRows;
}

function readCell(row, columnLetter) {
  const raw = row[COLUMN_INDEX[columnLetter]];
  const value = raw === undefined || raw === null ? '' : String(raw).trim();
  return value || null;
}

// Cột O (Không Trong Bang) là ô đánh dấu kiểu "x"/trống, không phải text —
// đọc riêng thành boolean cho gọn phía gọi (getBangMemberList).
function readCheckboxCell(row, columnLetter) {
  const raw = row[COLUMN_INDEX[columnLetter]];
  return String(raw || '').trim().toLowerCase() === 'x';
}

// discordId: string (message.author.id). Trả về { ingame, className } nếu
// tìm thấy Discord ID khớp ở cột A, hoặc null nếu không có/lỗi đọc sheet
// (auto-chat vẫn tiếp tục chạy bình thường, chỉ là không xưng tên được).
async function getMemberInfoByDiscordId(discordId) {
  try {
    const rows = await getBangSheetRows();

    const matchedRow = rows.find((row) => {
      const cellId = readCell(row, BANG_SHEET_COLUMNS.discordId);
      return cellId !== null && cellId === discordId;
    });

    if (!matchedRow) return null;

    const ingame = readCell(matchedRow, BANG_SHEET_COLUMNS.ingame);
    const className = readCell(matchedRow, BANG_SHEET_COLUMNS.className);

    if (!ingame && !className) return null;

    return { ingame, className };
  } catch (error) {
    console.error('Không thể tra cứu thông tin thành viên từ tab "Bang":', error.message);
    return null;
  }
}

// Trả về TOÀN BỘ danh sách thành viên trong tab "Bang" dưới dạng
// [{ discordId, ingame, className }] (bỏ qua các hàng không có tên ingame —
// không đủ dữ liệu để nhận diện). Dùng làm "tài liệu tham khảo" nhét vào
// prompt AI (AutoReply/aiClient.js), để AI tự tìm tên khớp khi được hỏi về
// NGƯỜI KHÁC (vd "B chơi class gì") thay vì chỉ tra được thông tin của
// chính người đang chat qua Discord ID như getMemberInfoByDiscordId ở trên
// — việc nhận diện tên người được hỏi trong câu tự nhiên rất khó làm chính
// xác bằng logic thường (regex/so khớp chuỗi), nên để AI tự xử lý phần đó.
// Có kèm discordId (khác bản trước) để AutoReply/index.js đối chiếu thêm
// với TÊN DISCORD (username/nickname) của thành viên đó trong server —
// người chat thường gọi nhau bằng tên Discord chứ không phải lúc nào cũng
// nhớ đúng tên ingame, nên cần xem 2 loại tên này là 1 khi tra cứu.
async function getAllBangMembers() {
  try {
    const rows = await getBangSheetRows();

    return rows
      .map((row) => ({
        discordId: readCell(row, BANG_SHEET_COLUMNS.discordId),
        ingame: readCell(row, BANG_SHEET_COLUMNS.ingame),
        className: readCell(row, BANG_SHEET_COLUMNS.className),
      }))
      .filter((member) => member.ingame); // cần ít nhất có tên ingame để AI khớp được
  } catch (error) {
    console.error('Không thể lấy danh sách thành viên từ tab "Bang":', error.message);
    return [];
  }
}

// ---- Quản lý thành viên từ trang web (GET /admin/member/list, POST
// /admin/member/action) — thêm vào phần đọc có sẵn ở trên. Chỉ đọc/ghi 3
// cột A (Discord ID) / C (Ingame) / D (Class) — KHÔNG đụng tới các cột
// F-O (Cố định/Theo Vị Trí/Theo team/Dự Bị/Skill 1-5/Không Trong Bang, xem
// NAME_RANGES trong server.js của web) để không phá dữ liệu xếp team đang
// có sẵn trên sheet.

async function getSheetsClient() {
  const authClient = await getGoogleAuthClient();
  if (!authClient) {
    throw new Error('Chưa cấu hình Google Sheets credentials cho bot.');
  }
  return google.sheets({ version: 'v4', auth: authClient });
}

// Cột C/D trong tab "Bang" thường có sẵn công thức kiểu:
//   =IFERROR(VLOOKUP(A97;'Cập nhật phái'!A:D;4;FALSE);"")   (Ingame)
//   =IFERROR(VLOOKUP(A97;'Cập nhật phái'!A:E;5;FALSE);"")   (Class)
// Khi thêm 1 dòng MỚI mà không tra được Ingame/Class ngay lúc thêm (xem
// addBangMember/registerGreetedMember bên dưới), thay vì để ô C/D trống
// (mất công thức, khỏi tự cập nhật khi "Cập nhật phái" có dữ liệu sau
// này), COPY đúng công thức đó từ dòng ngay phía trên xuống dòng mới bằng
// thao tác copyPaste — y hệt bôi đen ô rồi Ctrl+C/Ctrl+V (hoặc kéo-thả) tay
// trên Sheet thật: Google Sheets tự dịch số hàng tương đối (A97 -> A98...)
// nên KHÔNG cần tự dựng lại chuỗi công thức bằng code. sheetId lấy 1 lần
// rồi cache lại vì id của 1 tab không đổi trong suốt vòng đời spreadsheet.
let cachedSheetId = null;

async function getBangGridSheetId(sheets) {
  if (cachedSheetId !== null) return cachedSheetId;
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SRC_IMAGE_SPREADSHEET_ID });
  const sheetMeta = (spreadsheet.data.sheets || []).find((sheet) => sheet.properties.title === BANG_SHEET_NAME);
  if (!sheetMeta) {
    throw new Error(`Không tìm thấy tab "${BANG_SHEET_NAME}" trong spreadsheet.`);
  }
  cachedSheetId = sheetMeta.properties.sheetId;
  return cachedSheetId;
}

// columnLetters: các cột (vd ['C'], ['D'], hoặc ['C','D']) cần copy công
// thức từ sourceRowNumber (dòng có sẵn công thức, thường là dòng ngay phía
// trên dòng mới) xuống destRowNumber. pasteType PASTE_FORMULA chỉ copy
// công thức/giá trị, KHÔNG đụng định dạng/màu ô đang có sẵn ở dòng mới.
async function copyBangFormulaColumns(sheets, sheetId, sourceRowNumber, destRowNumber, columnLetters) {
  if (!columnLetters.length) return;

  const requests = columnLetters.map((letter) => {
    const colIndex = COLUMN_INDEX[letter];
    return {
      copyPaste: {
        source: {
          sheetId,
          startRowIndex: sourceRowNumber - 1,
          endRowIndex: sourceRowNumber,
          startColumnIndex: colIndex,
          endColumnIndex: colIndex + 1,
        },
        destination: {
          sheetId,
          startRowIndex: destRowNumber - 1,
          endRowIndex: destRowNumber,
          startColumnIndex: colIndex,
          endColumnIndex: colIndex + 1,
        },
        pasteType: 'PASTE_FORMULA',
      },
    };
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SRC_IMAGE_SPREADSHEET_ID,
    resource: { requests },
  });
}

// Trả về TOÀN BỘ dòng trong tab "Bang" (KHÔNG lọc bỏ dòng thiếu ingame như
// getAllBangMembers ở trên — trang quản lý cần thấy cả dòng trống để biết
// còn slot nào chưa điền) — đọc TRỰC TIẾP, không dùng cache trong bộ nhớ,
// để trang web luôn thấy đúng dữ liệu mới nhất.
async function getBangMemberList() {
  const rows = await fetchBangSheetRows();
  return rows
    .map((row, index) => ({
      rowNumber: index + 1, // +1: dữ liệu bắt đầu từ dòng 1 (tab "Bang" không có header riêng)
      discordId: readCell(row, BANG_SHEET_COLUMNS.discordId),
      ingame: readCell(row, BANG_SHEET_COLUMNS.ingame),
      className: readCell(row, BANG_SHEET_COLUMNS.className),
      khongTrongBang: readCheckboxCell(row, BANG_SHEET_COLUMNS.khongTrongBang),
    }))
    .filter((member) => member.discordId); // bắt buộc phải có Discord ID mới quản lý được
}

// Thêm 1 thành viên mới vào CUỐI tab "Bang" (chỉ điền cột A/C/D, các cột
// F-O còn lại để trống — admin tự điền thêm trên Sheet nếu cần dùng tính
// năng "Tự Động" xếp team). Trả lỗi nếu discordId đã tồn tại (dùng
// updateBangMember để sửa thay vì thêm trùng dòng).
async function addBangMember(discordId, ingame, className) {
  const targetId = String(discordId || '').trim();
  if (!/^\d{15,25}$/.test(targetId)) {
    throw new Error('discordId không hợp lệ.');
  }
  const trimmedIngame = String(ingame || '').trim();
  if (!trimmedIngame) {
    throw new Error('Thiếu Ingame.');
  }
  const trimmedClass = String(className || '').trim();

  const rows = await fetchBangSheetRows();
  const alreadyExists = rows.some((row) => readCell(row, BANG_SHEET_COLUMNS.discordId) === targetId);
  if (alreadyExists) {
    throw new Error(`Discord ID ${targetId} đã có trong tab "Bang" — dùng sửa thay vì thêm mới.`);
  }

  const sheets = await getSheetsClient();
  // Cột A/C/D không liền nhau -> ghi từng cột riêng vào ĐÚNG dòng mới (dòng
  // kế tiếp sau dòng cuối cùng hiện có), thay vì append() (chỉ nối được
  // theo 1 khối cột liên tục).
  const newRowNumber = rows.length + 1;

  const valueData = [{ range: `'${BANG_SHEET_NAME}'!A${newRowNumber}`, values: [[targetId]] }];
  // Ingame bắt buộc phải có (đã throw ở trên nếu thiếu) nên luôn ghi giá
  // trị thật. Class có thể để trống khi thêm tay từ trang quản lý -> copy
  // công thức VLOOKUP từ dòng ngay phía trên xuống thay vì để trống hẳn
  // (xem copyBangFormulaColumns ở trên), nếu có dòng phía trên để copy.
  valueData.push({ range: `'${BANG_SHEET_NAME}'!C${newRowNumber}`, values: [[trimmedIngame]] });
  const formulaColumnsToCopy = [];
  if (trimmedClass) {
    valueData.push({ range: `'${BANG_SHEET_NAME}'!D${newRowNumber}`, values: [[trimmedClass]] });
  } else if (newRowNumber > 1) {
    formulaColumnsToCopy.push(BANG_SHEET_COLUMNS.className);
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SRC_IMAGE_SPREADSHEET_ID,
    resource: { valueInputOption: 'RAW', data: valueData },
  });

  if (formulaColumnsToCopy.length) {
    const sheetId = await getBangGridSheetId(sheets);
    await copyBangFormulaColumns(sheets, sheetId, newRowNumber - 1, newRowNumber, formulaColumnsToCopy);
  }

  cachedRows = null; // buộc lần đọc kế tiếp (chat AI, danh sách web) lấy lại dữ liệu mới
  return { rowNumber: newRowNumber, discordId: targetId, ingame: trimmedIngame, className: trimmedClass };
}

// Sửa Ingame/Class và/hoặc trạng thái "Không Trong Bang" của 1 dòng đã có
// (giữ nguyên Discord ID + mọi cột khác). field để trống/không truyền thì
// giữ nguyên giá trị cũ (giống nm!us1/us2). khongTrongBang là boolean rõ
// ràng (true/false) — khác ingame/className (bỏ trống = giữ nguyên), ở đây
// CÓ truyền (kể cả false) là ghi đè, vì đây là cách chính để đánh dấu 1
// người đã rời bang thay vì xoá hẳn dòng (xem removeBangMember bên dưới,
// giờ chỉ dùng khi cần xoá NHẦM dữ liệu, không dùng cho "người đó đã out").
async function updateBangMember(discordId, { ingame, className, khongTrongBang } = {}) {
  const targetId = String(discordId || '').trim();
  if (!targetId) throw new Error('Thiếu discordId.');

  const rows = await fetchBangSheetRows();
  const rowIndex = rows.findIndex((row) => readCell(row, BANG_SHEET_COLUMNS.discordId) === targetId);
  if (rowIndex === -1) {
    throw new Error(`Không tìm thấy Discord ID ${targetId} trong tab "Bang".`);
  }
  const rowNumber = rowIndex + 1;

  const sheets = await getSheetsClient();
  const data = [];
  if (ingame !== undefined && ingame !== null && String(ingame).trim()) {
    data.push({ range: `'${BANG_SHEET_NAME}'!C${rowNumber}`, values: [[String(ingame).trim()]] });
  }
  if (className !== undefined && className !== null && String(className).trim()) {
    data.push({ range: `'${BANG_SHEET_NAME}'!D${rowNumber}`, values: [[String(className).trim()]] });
  }
  if (typeof khongTrongBang === 'boolean') {
    data.push({ range: `'${BANG_SHEET_NAME}'!O${rowNumber}`, values: [[khongTrongBang ? 'x' : '']] });
  }
  if (!data.length) {
    throw new Error('Không có gì để cập nhật (thiếu Ingame/Class mới hoặc trạng thái Không Trong Bang).');
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SRC_IMAGE_SPREADSHEET_ID,
    resource: { valueInputOption: 'RAW', data },
  });

  cachedRows = null;
  return {
    rowNumber,
    discordId: targetId,
    ingame: ingame !== undefined && String(ingame).trim() ? String(ingame).trim() : readCell(rows[rowIndex], BANG_SHEET_COLUMNS.ingame),
    className: className !== undefined && String(className).trim() ? String(className).trim() : readCell(rows[rowIndex], BANG_SHEET_COLUMNS.className),
    khongTrongBang: typeof khongTrongBang === 'boolean' ? khongTrongBang : readCheckboxCell(rows[rowIndex], BANG_SHEET_COLUMNS.khongTrongBang),
  };
}

// Xoá HẲN 1 dòng khỏi tab "Bang" (xoá cả dòng, không chỉ xoá nội dung A/C/D
// — để không để lại dòng trống giữa bảng). CẨN THẬN: xoá luôn cả các cột
// F-O (Cố định/Theo Vị Trí/Theo team/Dự Bị/Skill 1-5) của dòng đó nếu có.
async function removeBangMember(discordId) {
  const targetId = String(discordId || '').trim();
  if (!targetId) throw new Error('Thiếu discordId.');

  const sheets = await getSheetsClient();
  const rows = await fetchBangSheetRows();
  const rowIndex = rows.findIndex((row) => readCell(row, BANG_SHEET_COLUMNS.discordId) === targetId);
  if (rowIndex === -1) return false;

  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SRC_IMAGE_SPREADSHEET_ID });
  const sheetMeta = (spreadsheet.data.sheets || []).find((sheet) => sheet.properties.title === BANG_SHEET_NAME);
  if (!sheetMeta) return false;
  const sheetId = sheetMeta.properties.sheetId;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SRC_IMAGE_SPREADSHEET_ID,
    resource: {
      requests: [
        { deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 } } },
      ],
    },
  });

  cachedRows = null;
  return true;
}

// ---- Tự động "vào sổ" tab "Bang" mỗi khi /hi chào 1 người (xem
// commands/hiHelper.js) ----
// Người vừa được chào CHƯA biết chỗ cập nhật hệ phái nên chưa có trong tab
// "Cập nhật phái" -> bot KHÔNG tra cứu gì cả, chỉ ghi 1 dòng mới ở cuối tab
// "Bang" gồm:
//   A = Discord ID (ép kiểu văn bản để không bị làm tròn ID dài)
//   C = =IFERROR(VLOOKUP(A<dòng>,'Cập nhật phái'!A:D,4,FALSE),"")   (Ingame)
//   D = =IFERROR(VLOOKUP(A<dòng>,'Cập nhật phái'!A:E,5,FALSE),"")   (Class)
//   E = Nhất Mộng
// Công thức tự hiện Ingame/Class ngay khi người đó cập nhật ở "Cập nhật phái".
// (API Sheets luôn nhận công thức dấu phẩy, kể cả khi Sheet hiển thị dấu ';'.)
// Discord ID đã có sẵn trong cột A thì KHÔNG ghi gì (tránh trùng dòng/ghi đè).
const GREETED_GROUP_NAME = 'Nhất Mộng';

async function writeGreetedRow(sheets, rowNumber, targetId, writeIdAndGroup) {
  const sheetId = await getBangGridSheetId(sheets);
  const rowIdx = rowNumber - 1;
  const cell = (colIndex, userEnteredValue, fields) => ({
    updateCells: {
      start: { sheetId, rowIndex: rowIdx, columnIndex: colIndex },
      rows: [{ values: userEnteredValue }],
      fields,
    },
  });
  // Công thức ghi bằng formulaValue + RESET định dạng số của ô về Automatic
  // (userEnteredFormat.numberFormat có trong fields nhưng không có giá trị).
  // Nếu ô C/D đang để định dạng \"Plain text\" thì values.update/USER_ENTERED
  // sẽ lưu công thức thành chữ thô — đó là lỗi trước đây.
  const requests = [
    cell(2, [
      { userEnteredValue: { formulaValue: `=IFERROR(VLOOKUP(A${rowNumber},'Cập nhật phái'!A:D,4,FALSE),"")` } },
      { userEnteredValue: { formulaValue: `=IFERROR(VLOOKUP(A${rowNumber},'Cập nhật phái'!A:E,5,FALSE),"")` } },
    ], 'userEnteredValue,userEnteredFormat.numberFormat'),
  ];
  if (writeIdAndGroup) {
    // Discord ID ghi dạng chuỗi (ID dài, tránh bị làm tròn).
    requests.push(cell(0, [{ userEnteredValue: { stringValue: targetId } }], 'userEnteredValue'));
    requests.push(cell(4, [{ userEnteredValue: { stringValue: GREETED_GROUP_NAME } }], 'userEnteredValue'));
  }
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SRC_IMAGE_SPREADSHEET_ID,
    resource: { requests },
  });
  await fixGreetedFormulasIfBroken(sheets, rowNumber);
}

// Sheet đặt khu vực dùng dấu ";" thì công thức ghi dấu "," bị #ERROR! (lỗi cú pháp). Ghi xong đọc lại C/D của dòng:
// nếu báo lỗi thì ghi lại bằng dấu ";" (USER_ENTERED, đọc theo ngôn ngữ của Sheet — cách này đã chạy được khi sửa tay).
const SHEET_ERROR_RE = /^#(ERROR|REF|NAME|VALUE|N\/A|DIV\/0)/i;
async function fixGreetedFormulasIfBroken(sheets, rowNumber) {
  try {
    await new Promise((resolve) => setTimeout(resolve, 1200)); // chờ Sheet tính xong
    const range = `'${BANG_SHEET_NAME}'!C${rowNumber}:D${rowNumber}`;
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SRC_IMAGE_SPREADSHEET_ID, range, valueRenderOption: 'FORMATTED_VALUE' });
    const vals = ((res.data.values || [])[0] || []).map((c) => String(c || '').trim());
    if (!vals.some((c) => SHEET_ERROR_RE.test(c))) return;
    console.warn(`[hi] Công thức dòng ${rowNumber} tab "${BANG_SHEET_NAME}" báo lỗi (${vals.join(' | ')}) -> ghi lại bằng dấu ";".`);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SRC_IMAGE_SPREADSHEET_ID,
      range,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[
        `=IFERROR(VLOOKUP(A${rowNumber};'Cập nhật phái'!A:D;4;FALSE);"")`,
        `=IFERROR(VLOOKUP(A${rowNumber};'Cập nhật phái'!A:E;5;FALSE);"")`,
      ]] },
    });
  } catch (error) {
    console.error('[hi] Không kiểm tra/sửa được công thức dòng vừa ghi:', error && error.message ? error.message : error);
  }
}

async function registerGreetedMember(discordId) {
  const targetId = String(discordId || '').replace(/\D/g, '');
  if (!/^\d{15,25}$/.test(targetId)) {
    throw new Error('discordId không hợp lệ.');
  }

  const rows = await fetchBangSheetRows();
  const idOf = (row) => String(readCell(row, BANG_SHEET_COLUMNS.discordId) || '').replace(/\D/g, '');
  const existingIndex = rows.findIndex((row) => idOf(row) === targetId);
  if (existingIndex !== -1) {
    // Dòng cũ lỡ bị ghi công thức dạng CHỮ THÔ (ô C/D hiện nguyên \"=IFERROR(...\"
    // thay vì kết quả) -> ghi lại đúng dạng công thức, không đụng cột A/E.
    const existingRow = rows[existingIndex];
    const cText = String(readCell(existingRow, 'C') || '').trim();
    const dText = String(readCell(existingRow, 'D') || '').trim();
    if (cText.startsWith('=') || dText.startsWith('=') || SHEET_ERROR_RE.test(cText) || SHEET_ERROR_RE.test(dText)) {
      const sheets = await getSheetsClient();
      await writeGreetedRow(sheets, existingIndex + 1, targetId, false);
      cachedRows = null;
      return { rowNumber: existingIndex + 1, discordId: targetId, added: false, repaired: true };
    }
    return { rowNumber: existingIndex + 1, discordId: targetId, added: false };
  }

  // Dòng mới = ngay sau dòng cuối cùng thật sự có Discord ID ở cột A (không
  // dùng rows.length + 1 vì các dòng dưới có thể đã kéo sẵn công thức C/D).
  let lastFilledIndex = -1;
  rows.forEach((row, index) => {
    if (idOf(row)) lastFilledIndex = index;
  });
  const rowNumber = lastFilledIndex + 2;

  const sheets = await getSheetsClient();
  await writeGreetedRow(sheets, rowNumber, targetId, true);

  cachedRows = null;
  return { rowNumber, discordId: targetId, added: true };
}

// Danh sách thành viên ĐANG TRONG BANG (bỏ dòng thiếu Ingame/Discord ID và dòng đánh dấu
// "x" ở cột O = Không Trong Bang) — dùng cache 5 phút như các hàm đọc ở trên. Phục vụ
// nút "Chọn Team" ở menu Hub (chonTeam/index.js): danh sách người đi cùng.
async function getActiveBangMembers() {
  const rows = await getBangSheetRows();
  return rows
    .map((row) => ({
      discordId: readCell(row, BANG_SHEET_COLUMNS.discordId),
      ingame: readCell(row, BANG_SHEET_COLUMNS.ingame),
      className: readCell(row, BANG_SHEET_COLUMNS.className),
      khongTrongBang: readCheckboxCell(row, BANG_SHEET_COLUMNS.khongTrongBang),
    }))
    .filter((member) => member.discordId && member.ingame && !member.khongTrongBang);
}

module.exports = {
  getMemberInfoByDiscordId,
  getAllBangMembers,
  getActiveBangMembers,
  getBangMemberList,
  addBangMember,
  updateBangMember,
  removeBangMember,
  registerGreetedMember,
};