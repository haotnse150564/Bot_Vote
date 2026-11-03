const client = require('../client');
const { scrimData } = require('../state');
const { DAY_REACTIONS } = require('../config');
const { parseScrimDayNumber } = require('../utils/time');

// Trả về true nếu đối thủ đã được xác nhận (khác rỗng và khác các placeholder
// kiểu "Đang tìm..."). Dùng để quyết định buổi đó có nên hiện emoji vote hay không.
function isOpponentConfirmed(opponent) {
  const o = (opponent || '').trim().toLowerCase();
  if (!o) return false;
  return o !== 'đang tìm...' && o !== 'đang tìm';
}

// Only react with the day-emojis that are actually relevant this week
// (based on session1Day / session2Day, AND only if the opponent for that
// session has been confirmed — i.e. not still "Đang tìm..."),
// plus 0️⃣ (Không đánh) which always shows.
// Falls back to showing only 0️⃣ if no session has a confirmed opponent yet.
function getActiveDayEmojis() {
  const activeDays = new Set();
  const d1 = parseScrimDayNumber(scrimData.session1Day);
  const d2 = parseScrimDayNumber(scrimData.session2Day);

  if (d1 !== null && isOpponentConfirmed(scrimData.session1Opponent)) {
    activeDays.add(d1);
  }
  if (d2 !== null && isOpponentConfirmed(scrimData.session2Opponent)) {
    activeDays.add(d2);
  }

  if (activeDays.size === 0) {
    return ['0️⃣'];
  }

  return Object.keys(DAY_REACTIONS).filter(
    (emoji) => emoji === '0️⃣' || activeDays.has(DAY_REACTIONS[emoji])
  );
}

// Called after editing an existing scrim message: adds any newly-relevant day
// reactions, and removes the bot's own reaction from ones no longer relevant
// (if no user has reacted to it, this makes the emoji disappear from the message).
async function syncScrimReactions(scrimMessage) {
  const activeEmojis = new Set(getActiveDayEmojis());

  for (const emoji of activeEmojis) {
    try {
      await scrimMessage.react(emoji);
    } catch (error) {
      console.error(`Failed to add reaction ${emoji}:`, error.message);
    }
  }

  for (const emoji of Object.keys(DAY_REACTIONS)) {
    if (emoji === '0️⃣' || activeEmojis.has(emoji)) continue;

    const reaction = scrimMessage.reactions.cache.get(emoji);

    if (reaction) {
      try {
        await reaction.users.remove(client.user.id);
      } catch (error) {
        console.error(`Failed to remove inactive reaction ${emoji}:`, error.message);
      }
    }
  }
}

module.exports = { getActiveDayEmojis, syncScrimReactions, isOpponentConfirmed };