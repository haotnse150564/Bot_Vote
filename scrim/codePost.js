// Đăng tin Gift Code vào kênh code — dùng chung cho /code, nm!code và route
// web POST /admin/scrim/code để 3 nơi không lệch nhau về kênh đích.
const client = require('../client');
const { CODE_CHANNEL_ID, SCRIM_PING_ROLE_ID } = require('../config');
const { formatCodeMessage } = require('./format');

// channelId (tuỳ chọn): ghi đè kênh đích (web có thể truyền kênh khác); bỏ
// trống = CODE_CHANNEL_ID. Trả về Message vừa gửi; ném lỗi nếu không tìm thấy
// kênh hoặc bot không gửi tin vào đó được (thiếu quyền...).
async function postScrimCode(code, channelId) {
  const targetChannelId = channelId || CODE_CHANNEL_ID;
  const channel = await client.channels.fetch(targetChannelId);

  if (!channel || typeof channel.send !== 'function') {
    throw new Error(`Kênh ${targetChannelId} không tồn tại hoặc không gửi tin nhắn được.`);
  }

  return channel.send({
    content: formatCodeMessage(code),
    allowedMentions: { roles: SCRIM_PING_ROLE_ID ? [SCRIM_PING_ROLE_ID] : [] },
  });
}

module.exports = { postScrimCode };
