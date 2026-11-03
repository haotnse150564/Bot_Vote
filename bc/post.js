// ===== bc/post.js — Gửi tin điểm danh Bang Chiến (dùng chung cho nm!bc, /bc và tự động Thứ 4 10:00) =====
const { bcData } = require('../state');
const { SCRIM_PING_ROLE_ID, OFFLINE_EMOJI_REACT } = require('../config');
const { resetOffVoteSheet } = require('../googleSheets/bcSheet');
const { saveState } = require('../googleSheets/stateSheet');
const { formatBcMessage } = require('./format');

// Reset danh sách Offline, gửi tin điểm danh vào `channel`, react Offline, lưu messageId.
async function postBcCheckin(channel) {
  await resetOffVoteSheet();
  const sent = await channel.send({
    content: formatBcMessage([]),
    allowedMentions: { roles: SCRIM_PING_ROLE_ID ? [SCRIM_PING_ROLE_ID] : [] },
  });
  bcData.messageId = sent.id;
  bcData.channelId = channel.id;
  await sent.react(OFFLINE_EMOJI_REACT);
  await saveState();
  return sent;
}

module.exports = { postBcCheckin };
