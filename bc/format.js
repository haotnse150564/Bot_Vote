const { SCRIM_PING_ROLE_ID, OFFLINE_EMOJI_MENTION } = require('../config');

function formatBcMessage(offlineList) {
  const rolePing = SCRIM_PING_ROLE_ID ? `<@&${SCRIM_PING_ROLE_ID}>\n\n` : '';
  const listSection = (offlineList && offlineList.length)
    ? `\n\nDanh sách đánh dấu Offline:\n${offlineList.map((item) => `${item.ingame} - ${item.class}`).join('\n')}`
    : '';

  return `${rolePing}# Điểm Danh Bang Chiến Tuần Này.
React ${OFFLINE_EMOJI_MENTION} nếu không đánh bang chiến.${listSection}`;
}

module.exports = { formatBcMessage };