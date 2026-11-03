// Tự kiểm tra lại role auto-vote khi role bị gắn/gỡ BẰNG CÁCH KHÁC ngoài
// react ✅ (vd admin gắn/gỡ tay trong Discord, bot khác cấp role...) — trước
// đây sheet RoleAutoVote chỉ được làm mới khi có người react ✅ hoặc lúc tạo
// tin vote/bấm "Đồng bộ vote", nên đổi role tay thì sheet không cập nhật.
// Debounce để nhiều thay đổi liên tiếp chỉ tốn 1 lần sync (tránh quota Sheets).
//
// Ngoài ra, vote của RIÊNG người vừa đổi role được cập nhật NGAY trong BotVote
// (có role -> bot điền Thứ 4/5/6 hộ nếu họ chưa vote tay; mất role -> gỡ vote
// auto của họ, vote tay giữ nguyên) — không phải chờ bấm "Đồng bộ vote".
const { Events } = require('discord.js');
const client = require('../client');
const { scrimData } = require('../state');
const { AUTOVOTE_ROLE_ID } = require('../config');
const { syncAutoVoteSheetWithRole, syncAutoVoteRowsForUser } = require('../googleSheets/autoVoteSheet');

const DEBOUNCE_MS = 5 * 1000;
let timer = null;

client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
  // oldMember partial (chưa có trong cache) -> không biết role cũ, bỏ qua để
  // khỏi sync mỗi lần ai đó đổi nickname; các đường sync khác vẫn bắt được.
  if (oldMember.partial) return;

  const hadRole = oldMember.roles.cache.has(AUTOVOTE_ROLE_ID);
  const hasRole = newMember.roles.cache.has(AUTOVOTE_ROLE_ID);

  if (hadRole === hasRole) return;

  if (scrimData.messageId && scrimData.channelId) {
    syncAutoVoteRowsForUser({
      guildId: newMember.guild.id,
      channelId: scrimData.channelId,
      messageId: scrimData.messageId,
      userId: newMember.id,
      username: newMember.user.username,
      enabled: hasRole,
    }).catch((error) => {
      console.error('[auto-vote] Cập nhật vote auto sau khi role đổi lỗi:', error.message);
    });
  }

  clearTimeout(timer);
  timer = setTimeout(() => {
    syncAutoVoteSheetWithRole(newMember.guild, { force: true }).catch((error) => {
      console.error('[auto-vote] Sync sheet sau khi role đổi lỗi:', error.message);
    });
  }, DEBOUNCE_MS);
});
