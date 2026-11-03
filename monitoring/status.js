// ===== monitoring/status.js — sổ ghi nhận trạng thái Google Sheet / sao lưu cho lệnh /status =====
// Các module gọi recordSheetOk/recordSheetError(nguồn, lỗi) ở chỗ đã bắt lỗi sẵn. Chỉ giữ trong RAM (mất khi restart).
const sources = new Map(); // nguồn -> { ok, lastOkAt, errors, lastErrorAt, lastError }
const recent = []; // tối đa 10 lỗi gần nhất
let startedAt = Date.now();

function entry(source) {
  if (!sources.has(source)) sources.set(source, { ok: 0, lastOkAt: 0, errors: 0, lastErrorAt: 0, lastError: '' });
  return sources.get(source);
}

function recordSheetOk(source) {
  const e = entry(source);
  e.ok += 1;
  e.lastOkAt = Date.now();
}

function recordSheetError(source, error) {
  const e = entry(source);
  const message = String((error && error.message) || error || 'lỗi không rõ').slice(0, 200);
  e.errors += 1;
  e.lastErrorAt = Date.now();
  e.lastError = message;
  recent.unshift({ at: Date.now(), source, message });
  if (recent.length > 10) recent.pop();
}

function getSheetStatus() {
  return { sources: [...sources.entries()].map(([name, v]) => ({ name, ...v })), recent: [...recent], startedAt };
}

module.exports = { recordSheetOk, recordSheetError, getSheetStatus };
