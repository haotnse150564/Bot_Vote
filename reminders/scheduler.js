const client = require('../client');
const { scrimData, reminderState } = require('../state');
const {
  BC_REMINDER_CHANNEL_ID,
  SCRIM_REMINDER_CHANNEL_ID,
  GUILD_REMINDER_CHANNEL_ID,
  SCRIM_PING_ROLE_ID,
  BC_CHECKIN_AUTO,
  BC_CHECKIN_CHANNEL_ID,
  BC_CHECKIN_DAY,
  BC_CHECKIN_HOUR,
  BC_CHECKIN_MINUTE,
  BC_EVENT_DAY,
  BC_EVENT_HOUR,
  BC_EVENT_MINUTE,
  BC_REMINDER_MINUTES_BEFORE,
  GCMN_EVENT_DAY,
  GCMN_EVENT_HOUR,
  GCMN_EVENT_MINUTE,
  GCMN_REMINDER_MINUTES_BEFORE,
  SCRIM_REMINDER_MINUTES_BEFORE,
  THU5_EVENT_DAY,
  THU5_EVENT_HOUR,
  THU5_EVENT_MINUTE,
  BOX_SALE_EVENT_DAY,
  BOX_SALE_EVENT_HOUR,
  BOX_SALE_EVENT_MINUTE,
} = require('../config');
const {
  getVnNow,
  getDateKey,
  isGcmnOpeningWeek,
  getReminderMark,
  parseVnWeekday,
  parseScrimTime,
  parseVnDayMonth,
} = require('../utils/time');

// Trả về true nếu KHÔNG có ngày cụ thể nào được set (giữ hành vi nhắc theo
// thứ như cũ) HOẶC ngày/tháng hôm nay khớp đúng ngày cụ thể đã set cho buổi
// scrim đó. Chỉ khi admin điền ngày (VD "5/9") thì mới giới hạn nhắc đúng
// ngày đó — tránh nhắc lặp lại mỗi tuần vào đúng thứ dù tuần đó không có
// scrim thật hoặc admin quên đổi ngày.
function matchesScrimDate(dateLabel, vnNow) {
  const parsed = parseVnDayMonth(dateLabel);
  if (!parsed) return true;
  return parsed.day === vnNow.getDate() && parsed.month === vnNow.getMonth() + 1;
}
const { postBcCheckin } = require('../bc/post');
const {
  formatBcReminderMessage,
  formatGcmnReminderMessage,
  formatScrimReminderMessage,
  formatThu5ReminderMessage,
  formatBoxSaleReminderMessage,
} = require('./format');

async function sendReminderMessage(text, channelId) {
  if (!channelId) {
    return;
  }

  try {
    const channel = await client.channels.fetch(channelId);
    await channel.send({
      content: text,
      allowedMentions: { roles: SCRIM_PING_ROLE_ID ? [SCRIM_PING_ROLE_ID] : [] },
    });
  } catch (error) {
    console.error('Failed to send reminder message:', error.message);
  }
}

async function sendAutoBcCheckin() {
  try {
    const channel = await client.channels.fetch(BC_CHECKIN_CHANNEL_ID);
    await postBcCheckin(channel);
    console.log('[BC-CHECKIN] Đã tự gửi tin điểm danh Bang Chiến.');
  } catch (error) {
    console.error('[BC-CHECKIN] Không tự gửi được điểm danh Bang Chiến:', error.message);
  }
}

function checkReminders() {
  const vnNow = getVnNow();
  const dayOfWeek = vnNow.getDay();
  const hours = vnNow.getHours();
  const minutes = vnNow.getMinutes();
  const todayKey = getDateKey(vnNow);

  // Điểm danh Bang Chiến tự động — mỗi Thứ 4 lúc 10:00 (giờ lấy từ config/schedule.js)
  if (
    BC_CHECKIN_AUTO &&
    BC_CHECKIN_CHANNEL_ID &&
    dayOfWeek === BC_CHECKIN_DAY &&
    hours === BC_CHECKIN_HOUR &&
    minutes === BC_CHECKIN_MINUTE &&
    reminderState.lastBcCheckinDate !== todayKey
  ) {
    reminderState.lastBcCheckinDate = todayKey;
    sendAutoBcCheckin();
  }

  // Bang chiến reminder — every Saturday, 30 minutes before 20:00
  let bcReminderMinuteMark = BC_EVENT_MINUTE - BC_REMINDER_MINUTES_BEFORE;
  let bcReminderHour = BC_EVENT_HOUR;
  if (bcReminderMinuteMark < 0) {
    bcReminderMinuteMark += 60;
    bcReminderHour -= 1;
  }

  if (
    dayOfWeek === BC_EVENT_DAY &&
    hours === bcReminderHour &&
    minutes === bcReminderMinuteMark &&
    reminderState.lastBcReminderDate !== todayKey
  ) {
    reminderState.lastBcReminderDate = todayKey;
    sendReminderMessage(formatBcReminderMessage(), BC_REMINDER_CHANNEL_ID);
  }

  // Giải cứu mỹ nhân reminder — every other Tuesday, 15 minutes before 20:30 (giờ lấy từ config/schedule.js)
  let gcmnReminderMinuteMark = GCMN_EVENT_MINUTE - GCMN_REMINDER_MINUTES_BEFORE;
  let gcmnReminderHour = GCMN_EVENT_HOUR;
  if (gcmnReminderMinuteMark < 0) {
    gcmnReminderMinuteMark += 60;
    gcmnReminderHour -= 1;
  }

  if (
    dayOfWeek === GCMN_EVENT_DAY &&
    hours === gcmnReminderHour &&
    minutes === gcmnReminderMinuteMark &&
    reminderState.lastGcmnReminderDate !== todayKey &&
    isGcmnOpeningWeek(vnNow)
  ) {
    reminderState.lastGcmnReminderDate = todayKey;
    sendReminderMessage(formatGcmnReminderMessage(), GUILD_REMINDER_CHANNEL_ID);
  }

  // Scrim Buổi 1 reminder — 30 phút trước giờ đánh, đúng ngày trong tuần đang set
  const session1Weekday = parseVnWeekday(scrimData.session1Day);
  const session1TimeParsed = parseScrimTime(scrimData.session1Time);

  if (session1Weekday !== null && session1TimeParsed) {
    const mark1 = getReminderMark(session1TimeParsed.hour, session1TimeParsed.minute, SCRIM_REMINDER_MINUTES_BEFORE);

    if (
      dayOfWeek === session1Weekday &&
      hours === mark1.hour &&
      minutes === mark1.minute &&
      reminderState.lastScrimSession1ReminderDate !== todayKey &&
      matchesScrimDate(scrimData.session1Date, vnNow)
    ) {
      reminderState.lastScrimSession1ReminderDate = todayKey;
      sendReminderMessage(
        formatScrimReminderMessage('Buổi 1', scrimData.session1Opponent, scrimData.session1Matches),
        SCRIM_REMINDER_CHANNEL_ID
      );
    }
  }

  // Scrim Buổi 2 reminder — 30 phút trước giờ đánh, đúng ngày trong tuần đang set
  const session2Weekday = parseVnWeekday(scrimData.session2Day);
  const session2TimeParsed = parseScrimTime(scrimData.session2Time);

  if (session2Weekday !== null && session2TimeParsed) {
    const mark2 = getReminderMark(session2TimeParsed.hour, session2TimeParsed.minute, SCRIM_REMINDER_MINUTES_BEFORE);

    if (
      dayOfWeek === session2Weekday &&
      hours === mark2.hour &&
      minutes === mark2.minute &&
      reminderState.lastScrimSession2ReminderDate !== todayKey &&
      matchesScrimDate(scrimData.session2Date, vnNow)
    ) {
      reminderState.lastScrimSession2ReminderDate = todayKey;
      sendReminderMessage(
        formatScrimReminderMessage('Buổi 2', scrimData.session2Opponent, scrimData.session2Matches),
        SCRIM_REMINDER_CHANNEL_ID
      );
    }
  }

  // Thứ 5 May Mắn — mỗi Thứ 5, đúng 8:00 sáng
  if (
    dayOfWeek === THU5_EVENT_DAY &&
    hours === THU5_EVENT_HOUR &&
    minutes === THU5_EVENT_MINUTE &&
    reminderState.lastThu5ReminderDate !== todayKey
  ) {
    reminderState.lastThu5ReminderDate = todayKey;
    sendReminderMessage(formatThu5ReminderMessage(), GUILD_REMINDER_CHANNEL_ID);
  }

  // Box 0 Ngọc — mỗi Thứ 7, đúng 8:00 sáng
  if (
    dayOfWeek === BOX_SALE_EVENT_DAY &&
    hours === BOX_SALE_EVENT_HOUR &&
    minutes === BOX_SALE_EVENT_MINUTE &&
    reminderState.lastBoxSaleReminderDate !== todayKey
  ) {
    reminderState.lastBoxSaleReminderDate = todayKey;
    sendReminderMessage(formatBoxSaleReminderMessage(), GUILD_REMINDER_CHANNEL_ID);
  }
}

module.exports = { sendReminderMessage, checkReminders };