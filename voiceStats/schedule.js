// Lịch Bang — tính mốc diễn ra KẾ TIẾP của từng sự kiện định kỳ + 2 buổi scrim
// đang set (scrimData), trả về text dùng Discord timestamp (<t:...>) nên mỗi
// người tự thấy đúng giờ múi giờ của mình và đếm ngược "trong X giờ".
const { scrimData, customScheduleEvents } = require('../state');
const {
  BC_EVENT_DAY, BC_EVENT_HOUR, BC_EVENT_MINUTE,
  GCMN_EVENT_DAY, GCMN_EVENT_HOUR, GCMN_EVENT_MINUTE, GCMN_REFERENCE_DATE_UTC,
  THU5_EVENT_DAY, THU5_EVENT_HOUR, THU5_EVENT_MINUTE,
  BOX_SALE_EVENT_DAY, BOX_SALE_EVENT_HOUR, BOX_SALE_EVENT_MINUTE,
} = require('../config');
const { parseVnWeekday, parseScrimTime, parseVnDayMonth } = require('../utils/time');

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Giờ VN -> mốc UTC ms.
function vnToUtcMs(year, monthIndex, day, hour, minute) {
  return Date.UTC(year, monthIndex, day, hour, minute) - VN_OFFSET_MS;
}

// Các ngày (lịch VN) từ hôm nay tới +horizonDays, mỗi ngày là {y, m, d, dow, dateOnlyUtc}.
function vnDays(nowMs, horizonDays) {
  const vn = new Date(nowMs + VN_OFFSET_MS);
  const days = [];
  for (let i = 0; i <= horizonDays; i++) {
    const dt = new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate() + i));
    days.push({ y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate(), dow: dt.getUTCDay(), dateOnlyUtc: dt.getTime() });
  }
  return days;
}

function nextWeekly(dow, hour, minute, nowMs) {
  for (const day of vnDays(nowMs, 7)) {
    if (day.dow !== dow) continue;
    const ms = vnToUtcMs(day.y, day.m, day.d, hour, minute);
    if (ms > nowMs) return ms;
  }
  return null;
}

function nextGcmn(nowMs) {
  for (const day of vnDays(nowMs, 21)) {
    if (day.dow !== GCMN_EVENT_DAY) continue;
    const weeks = Math.round((day.dateOnlyUtc - GCMN_REFERENCE_DATE_UTC) / (7 * DAY_MS));
    if (((weeks % 2) + 2) % 2 !== 0) continue;
    const ms = vnToUtcMs(day.y, day.m, day.d, GCMN_EVENT_HOUR, GCMN_EVENT_MINUTE);
    if (ms > nowMs) return ms;
  }
  return null;
}

// Lần diễn ra kế tiếp của sự kiện tuỳ chỉnh: đúng thứ, và số tuần tính từ ngày mốc chia hết cho everyWeeks.
function nextCustom(ev, nowMs) {
  const m = String(ev.anchorDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const time = parseScrimTime(ev.time);
  if (!m || !time) return null;
  const anchorUtc = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const every = Math.max(1, ev.everyWeeks || 1);
  for (const day of vnDays(nowMs, 7 * every)) {
    if (day.dow !== ev.weekday) continue;
    const weeks = Math.round((day.dateOnlyUtc - anchorUtc) / (7 * DAY_MS));
    if (weeks < 0 || weeks % every !== 0) continue;
    const ms = vnToUtcMs(day.y, day.m, day.d, time.hour, time.minute);
    if (ms > nowMs) return ms;
  }
  return null;
}

function repeatLabel(every) {
  return every <= 1 ? 'mỗi tuần' : `${every} tuần/lần`;
}

function scrimEvent(label, day, timeStr, dateStr, opponent, nowMs) {
  const weekday = parseVnWeekday(day);
  if (weekday === null) return { sortMs: Infinity, text: `⚔️ **Scrim ${label}**: chưa có lịch (${day || 'đang tìm'})` };

  const time = parseScrimTime(timeStr);
  const hour = time ? time.hour : 0;
  const minute = time ? time.minute : 0;
  const vn = new Date(nowMs + VN_OFFSET_MS);

  let ms = null;
  const dm = parseVnDayMonth(dateStr);
  if (dm) {
    ms = vnToUtcMs(vn.getUTCFullYear(), dm.month - 1, dm.day, hour, minute);
    if (ms <= nowMs) return null; // ngày đã set nhưng đã qua -> không hiện
  } else {
    ms = nextWeekly(weekday, hour, minute, nowMs);
  }
  if (ms === null) return null;

  const vs = opponent && !/đang tìm/i.test(opponent) ? ` vs **${opponent}**` : ' (chưa có đối)';
  const when = time ? `<t:${Math.floor(ms / 1000)}:F> (<t:${Math.floor(ms / 1000)}:R>)` : `<t:${Math.floor(ms / 1000)}:D> — chưa chốt giờ`;
  return { sortMs: ms, text: `⚔️ **Scrim ${label}**${vs}\n   ${when}` };
}

function buildScheduleText(nowMs = Date.now()) {
  const events = [];
  const add = (ms, name, emoji) => {
    if (ms === null) return;
    events.push({ sortMs: ms, text: `${emoji} **${name}**\n   <t:${Math.floor(ms / 1000)}:F> (<t:${Math.floor(ms / 1000)}:R>)` });
  };

  add(nextWeekly(BC_EVENT_DAY, BC_EVENT_HOUR, BC_EVENT_MINUTE, nowMs), 'Bang Chiến', '🏰');
  add(nextGcmn(nowMs), 'Giải Cứu Mỹ Nhân (2 tuần/lần)', '👸');
  add(nextWeekly(THU5_EVENT_DAY, THU5_EVENT_HOUR, THU5_EVENT_MINUTE, nowMs), 'Thứ 5 May Mắn', '🍀');
  add(nextWeekly(BOX_SALE_EVENT_DAY, BOX_SALE_EVENT_HOUR, BOX_SALE_EVENT_MINUTE, nowMs), 'Box 0 Ngọc', '🎁');

  for (const ev of customScheduleEvents) add(nextCustom(ev, nowMs), `${ev.name} (${repeatLabel(ev.everyWeeks)})`, '📌');

  const s1 = scrimEvent('Buổi 1', scrimData.session1Day, scrimData.session1Time, scrimData.session1Date, scrimData.session1Opponent, nowMs);
  const s2 = scrimEvent('Buổi 2', scrimData.session2Day, scrimData.session2Time, scrimData.session2Date, scrimData.session2Opponent, nowMs);
  if (s1) events.push(s1);
  if (s2) events.push(s2);

  events.sort((a, b) => a.sortMs - b.sortMs);
  return `📅 **LỊCH BANG SẮP TỚI**\n\n${events.map((e) => e.text).join('\n\n')}`;
}

// Dạng dữ liệu cho trang web: [{ key, name, emoji, atMs|null, note }] đã sắp theo thời gian.
function buildScheduleData(nowMs = Date.now()) {
  const list = [];
  const add = (key, name, emoji, ms, note = '') => {
    if (ms !== null) list.push({ key, name, emoji, atMs: ms, note });
  };
  add('bc', 'Bang Chiến', '🏰', nextWeekly(BC_EVENT_DAY, BC_EVENT_HOUR, BC_EVENT_MINUTE, nowMs));
  add('gcmn', 'Giải Cứu Mỹ Nhân (2 tuần/lần)', '👸', nextGcmn(nowMs));
  add('thu5', 'Thứ 5 May Mắn', '🍀', nextWeekly(THU5_EVENT_DAY, THU5_EVENT_HOUR, THU5_EVENT_MINUTE, nowMs));
  add('box', 'Box 0 Ngọc', '🎁', nextWeekly(BOX_SALE_EVENT_DAY, BOX_SALE_EVENT_HOUR, BOX_SALE_EVENT_MINUTE, nowMs));

  for (const ev of customScheduleEvents) {
    const ms = nextCustom(ev, nowMs);
    if (ms === null) continue;
    list.push({
      key: `custom-${ev.id}`, name: ev.name, emoji: '📌', atMs: ms, note: repeatLabel(ev.everyWeeks),
      custom: { id: ev.id, weekday: ev.weekday, time: ev.time, everyWeeks: ev.everyWeeks, anchorDate: ev.anchorDate },
    });
  }

  [['Buổi 1', 'session1'], ['Buổi 2', 'session2']].forEach(([label, k]) => {
    const day = scrimData[`${k}Day`];
    const timeStr = scrimData[`${k}Time`];
    const weekday = parseVnWeekday(day);
    if (weekday === null) return;
    const time = parseScrimTime(timeStr);
    const vn = new Date(nowMs + VN_OFFSET_MS);
    const dm = parseVnDayMonth(scrimData[`${k}Date`]);
    let ms;
    if (dm) {
      ms = vnToUtcMs(vn.getUTCFullYear(), dm.month - 1, dm.day, time ? time.hour : 0, time ? time.minute : 0);
      if (ms <= nowMs) return;
    } else {
      ms = nextWeekly(weekday, time ? time.hour : 0, time ? time.minute : 0, nowMs);
    }
    const opp = scrimData[`${k}Opponent`];
    const note = (opp && !/đang tìm/i.test(opp) ? `vs ${opp}` : 'chưa có đối') + (time ? '' : ' · chưa chốt giờ');
    add(k, `Scrim ${label}`, '⚔️', ms, note);
  });

  list.sort((a, b) => a.atMs - b.atMs);
  return list;
}

module.exports = { buildScheduleText, buildScheduleData };
