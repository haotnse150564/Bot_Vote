// ===== BcStat sheet: nhãn trận "Tên đối thủ - dd/mm/yy" =====
// Build/split/validate nhãn trận (Bang Chiến luôn diễn ra Thứ 7). Thuần logic, không đụng Sheets.

// Bang Chiến luôn diễn ra vào Thứ 7 — nhãn trận LUÔN có dạng
// "<đối thủ> - dd/mm/yy" (vd "Thanh Vân Các - 05/09/26"), ngày 2 chữ số được
// hiểu là 20xx.
const MATCH_DATE_REGEX = /^([0-3]\d)\/([01]\d)\/(\d{2})$/;
const MATCH_LABEL_SEPARATOR = ' - ';

// "05/09/26" -> Date(2026, 8, 5), hoặc null nếu sai định dạng/ngày ảo (vd
// 31/02). year 2 chữ số luôn hiểu là 20xx.
function parseMatchDateParts(dateStr) {
  const match = MATCH_DATE_REGEX.exec(String(dateStr || '').trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = 2000 + Number(match[3]);
  const date = new Date(year, month - 1, day);
  // So lại đúng ngày/tháng/năm đã parse — Date tự "tràn" sang tháng sau với
  // ngày ảo (vd 31/02 -> 03/03) thay vì báo lỗi, nên phải tự kiểm tra lại.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function buildMatchLabel(opponent, dateStr) {
  return `${String(opponent || '').trim()}${MATCH_LABEL_SEPARATOR}${String(dateStr || '').trim()}`;
}

// "Thanh Vân Các - 05/09/26" -> { opponent: 'Thanh Vân Các', dateStr: '05/09/26' }
// Tách theo dấu " - " CUỐI CÙNG trong chuỗi — phòng trường hợp tên đối thủ
// tự nó có chứa dấu gạch ngang.
function splitMatchLabel(label) {
  const str = String(label || '');
  const idx = str.lastIndexOf(MATCH_LABEL_SEPARATOR);
  if (idx === -1) return { opponent: str.trim(), dateStr: '' };
  return { opponent: str.slice(0, idx).trim(), dateStr: str.slice(idx + MATCH_LABEL_SEPARATOR.length).trim() };
}

// Validate + build nhãn trận từ input thô (opponent, dateStr) — dùng chung
// cho cả Discord (bcstat/matchHandlers.js::handleMatchModalSubmit) lẫn web
// (admin/api.js::POST /admin/bcstat/save) để 2 đường luôn áp cùng 1 luật.
// Trả về { ok:true, label } hoặc { ok:false, error }.
function validateMatchInput(opponent, dateStr) {
  const trimmedOpponent = String(opponent || '').trim();
  const trimmedDate = String(dateStr || '').trim();
  if (!trimmedOpponent) return { ok: false, error: 'Thiếu tên đối thủ.' };
  if (!MATCH_DATE_REGEX.test(trimmedDate)) {
    return { ok: false, error: 'Ngày phải theo định dạng dd/mm/yy, ví dụ 05/09/26.' };
  }
  const date = parseMatchDateParts(trimmedDate);
  if (!date) return { ok: false, error: 'Ngày không hợp lệ (ngày/tháng không tồn tại) — kiểm tra lại.' };
  if (date.getDay() !== 6) {
    return { ok: false, error: 'Bang Chiến luôn diễn ra vào Thứ 7 — ngày vừa nhập không phải Thứ 7, kiểm tra lại.' };
  }
  return { ok: true, label: buildMatchLabel(trimmedOpponent, trimmedDate) };
}

function assertValidMatchLabel(matchLabel) {
  const label = String(matchLabel || '').trim();
  if (!label) throw new Error('Thiếu nhãn trận (đối thủ + ngày) để lưu.');
  return label;
}

module.exports = {
  parseMatchDateParts,
  buildMatchLabel,
  splitMatchLabel,
  validateMatchInput,
  assertValidMatchLabel,
};
