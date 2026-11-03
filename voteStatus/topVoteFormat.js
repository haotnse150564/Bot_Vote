// Format tin nhắn "Bảng xếp hạng chuyên cần vote" (top 10) cho lệnh
// /topvote (nm!topvote) — dữ liệu lấy từ googleSheets/topVoteSheet.js ->
// getTopVoters().

const RANK_MEDALS = ['🥇', '🥈', '🥉'];

function formatTopVoteMessage(topVoters) {
  if (!Array.isArray(topVoters) || !topVoters.length) {
    return '📊 Chưa có dữ liệu bảng xếp hạng chuyên cần vote (chưa có tuần nào được tổng kết qua `/rsvote`).';
  }

  const lines = topVoters.map((person, index) => {
    const rank = index + 1;
    const medal = RANK_MEDALS[index] || `**${rank}.**`;
    const displayName = person.ingame || `ID ${person.id}`;
    const classPart = person.className ? ` (${person.className})` : '';

    return `${medal} ${displayName}${classPart} — **${person.total}** tuần đã vote`;
  });

  return `### 🏆 Bảng Xếp Hạng Chuyên Cần Vote (Top ${topVoters.length})\n${lines.join('\n')}`;
}

module.exports = { formatTopVoteMessage };
