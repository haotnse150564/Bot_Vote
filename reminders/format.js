const {
  SCRIM_PING_ROLE_ID,
  GCMN_EVENT_HOUR,
  GCMN_EVENT_MINUTE,
  GCMN_REMINDER_MINUTES_BEFORE,
} = require('../config');

function formatBcReminderMessage() {
  return `<@&${SCRIM_PING_ROLE_ID}>\n# Đến giờ tập hợp bang chiến, mọi người online game để các lead pt dần nhé! \n ## Tranh thủ online game vào PT, mang thú cưỡi đúng quy định và chuẩn bị thuốc tăng chỉ số.`;
}

// Giờ diễn ra lấy từ config để đổi giờ chỉ cần sửa 1 chỗ (config/schedule.js)
function formatGcmnTime() {
  return `${GCMN_EVENT_HOUR}h${String(GCMN_EVENT_MINUTE).padStart(2, '0')}`;
}

function formatGcmnReminderMessage() {
  return `<@&${SCRIM_PING_ROLE_ID}>\n# Hoạt động **Giải Cứu Mỹ Nhân** diễn ra lúc **${formatGcmnTime()}** (sau ${GCMN_REMINDER_MINUTES_BEFORE} phút nữa)!!`;
}

function formatScrimReminderMessage(sessionLabel, opponent, matches) {
  const rolePing = SCRIM_PING_ROLE_ID ? `<@&${SCRIM_PING_ROLE_ID}>\n` : '';
  return `${rolePing}# Còn 30 phút nữa là đến giờ đánh Scrim ${sessionLabel}!\nĐối Thủ: ${opponent}\nSố Trận: ${matches} Trận\nMọi người chuẩn bị vào phòng nhé!`;
}

function formatThu5ReminderMessage() {
  const rolePing = SCRIM_PING_ROLE_ID ? `<@&${SCRIM_PING_ROLE_ID}>\n` : '';
  return `${rolePing}Event Thứ 5 May Mắn:\nVào Game -> Chỉ Dẫn -> Thứ 5 Cuồng Nhiệt -> Đến Điểm Danh\nHoặc Link: https://www.swordofjustice.com/h5/20260518/officialwebfastvnsea/?channel=game#/`;
}

function formatBoxSaleReminderMessage() {
  const rolePing = SCRIM_PING_ROLE_ID ? `<@&${SCRIM_PING_ROLE_ID}>\n` : '';
  return `${rolePing}Hôm Nay Có Bán Box 0 Ngọc Trong Shop Kỳ Trân. Mọi Người Nhớ Mua`;
}

module.exports = {
  formatBcReminderMessage,
  formatGcmnReminderMessage,
  formatScrimReminderMessage,
  formatThu5ReminderMessage,
  formatBoxSaleReminderMessage,
};