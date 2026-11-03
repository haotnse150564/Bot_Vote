const { scrimData } = require('../state');
const { SCRIM_PING_ROLE_ID } = require('../config');

function formatScrimTimeDate(time, date) {
  const t = (time || '').trim();
  const d = (date || '').trim();

  if (t && d) return `${t}, ${d}`;
  if (t) return t;
  if (d) return d;
  return 'Đang cập nhật';
}

function formatScrimMessage() {
  const updateInfo = scrimData.updatedAt ? `Đã Cập Nhật Lúc: ${scrimData.updatedAt}` : '';
  const rolePing = SCRIM_PING_ROLE_ID ? `<@&${SCRIM_PING_ROLE_ID}>\n` : '';
  return `${rolePing}# THÔNG BÁO LỊCH / VOTE SCRIM

# Buổi 1: ${scrimData.session1Day}
## Thời Gian: ${formatScrimTimeDate(scrimData.session1Time, scrimData.session1Date)}
## Đối Thủ: ${scrimData.session1Opponent}
### Số Trận: ${scrimData.session1Matches} Trận

# Buổi 2: ${scrimData.session2Day}
## Thời Gian: ${formatScrimTimeDate(scrimData.session2Time, scrimData.session2Date)}
## Đối Thủ: ${scrimData.session2Opponent}
### Số Trận: ${scrimData.session2Matches} Trận

---
${updateInfo}

>>> Chọn ngày phù hợp bằng các emoji bên dưới:
4️⃣ = Thứ 4
5️⃣ = Thứ 5
6️⃣ = Thứ 6
0️⃣ = Không đánh
Đánh dấu Tích xanh để nhận role tự động tích khi có Scrim mới từ giờ về sau
(Chỉ tích cho lần đầu, lần sau sẽ được tự động vote và không cần tích lại)

Nếu bạn đã tích auto vote nhưng có chỉ thể đánh 1 ngày thay vì 2 như mọi khi
chỉ cần thả react đúng ngày có thể đành mà không cần tháo role auto vote.`
;

}

// Chuẩn hóa input ngày về dạng "Thứ X".
// Chấp nhận: "6", "T6", "t6", "thứ 6", "Thứ6", "thu 6", "Thứ 6" (đã chuẩn), "cn", "chủ nhật"...
// Nếu không khớp mẫu ngày hợp lệ (2/3/4/5/6/7/CN) thì giữ nguyên input gốc
// (cho phép các giá trị tự do như "Đang tìm").
function normalizeScrimDay(input) {
  const raw = (input || '').trim();
  if (!raw) return raw;

  // Bỏ dấu, chữ thường để so khớp linh hoạt
  const normalized = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // bỏ dấu tiếng Việt

  // Chủ nhật / CN
  if (/^(cn|chu ?nhat)$/.test(normalized)) {
    return 'Chủ Nhật';
  }

  // Bắt số ngày: "6", "t6", "thu6", "thu 6", "thứ 6"...
  const match = normalized.match(/^(?:thu|t)?\s*([2-7])$/);
  if (match) {
    return `Thứ ${match[1]}`;
  }

  // Không khớp mẫu -> giữ nguyên (vd: "Đang tìm", "Nghỉ", ...)
  return raw;
}

// Áp dụng chuỗi cập nhật dạng: [ngày] ; [giờ,ngày/tháng] ; [đối thủ] ; [số trận]
// Phần nào để trống thì giữ nguyên giá trị cũ.
function applyScrimUpdateArgs(session, rawArgs) {
  const args = rawArgs.split(';').map((arg) => arg.trim());

  if (args[0]) {
    scrimData[`session${session}Day`] = normalizeScrimDay(args[0]);
  }

  if (args.length >= 2 && args[1]) {
    const [time, date] = args[1].split(',').map((s) => s.trim());
    if (time) scrimData[`session${session}Time`] = time;
    if (date) scrimData[`session${session}Date`] = date;
  }

  if (args.length >= 3 && args[2]) {
    scrimData[`session${session}Opponent`] = args[2];
  }

  if (args.length >= 4 && args[3]) {
    scrimData[`session${session}Matches`] = args[3];
  }
}

function formatCodeMessage(code) {
  const rolePing = SCRIM_PING_ROLE_ID ? `<@&${SCRIM_PING_ROLE_ID}>\n\n` : '';
  return `${rolePing}Gife code: ${code}\nLink Nhập Code: https://levelup.vnggames.com/vn/vi/games/jusvn/redeem`;
}

function resetScrimData() {
  scrimData.session1Day = 'Thứ 5';
  scrimData.session1Time = '';
  scrimData.session1Date = '';
  scrimData.session1Opponent = 'Đang tìm...';
  scrimData.session1Matches = '2';
  scrimData.session2Day = 'Đang tìm';
  scrimData.session2Time = '';
  scrimData.session2Date = '';
  scrimData.session2Opponent = 'Đang tìm...';
  scrimData.session2Matches = '2';
}

module.exports = {
  formatScrimTimeDate,
  formatScrimMessage,
  applyScrimUpdateArgs,
  normalizeScrimDay,
  formatCodeMessage,
  resetScrimData,
};