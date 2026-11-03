// ===== googleSheets/googleClient.js — shim thay `google` của gói googleapis (chỉ nạp Sheets + Drive) =====
const sheetsPkg = require('@googleapis/sheets');
const drivePkg = require('@googleapis/drive');
const { GOOGLE_API_TIMEOUT_MS } = require('../config/sheets');

// Option toàn cục (tương đương google.options của googleapis). Mặc định: timeout 5 phút.
const globalOptions = { timeout: GOOGLE_API_TIMEOUT_MS };

const google = {
  _options: globalOptions, // googleapis-common đọc context._options khi tạo service client
  auth: sheetsPkg.auth, // AuthPlus: dùng được `new google.auth.GoogleAuth(...)`
  options(opts) {
    Object.assign(globalOptions, opts);
  },
  sheets(opts) {
    return sheetsPkg.sheets.call(google, { ...globalOptions, ...opts });
  },
  drive(opts) {
    return drivePkg.drive.call(google, { ...globalOptions, ...opts });
  },
};

module.exports = { google };
