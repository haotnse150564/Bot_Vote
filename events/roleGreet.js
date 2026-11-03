// Tự động chào (giống nội dung lệnh nm!hi / /hi) khi có thành viên VỪA được
// gắn role SCRIM_PING_ROLE_ID (id 1450590370194001941) — không cần NPC gõ
// lệnh tay nữa. Tin chào được gửi vào kênh FEEDBACK_CHANNEL_ID (id
// 1495792409416695868), tag đúng người vừa được cấp role.
const { Events } = require('discord.js');
const client = require('../client');
const { registerGreetedMemberSilently, buildHiMessageContent } = require('../commands/hiHelper');
const { SCRIM_PING_ROLE_ID, FEEDBACK_CHANNEL_ID } = require('../config');

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  try {
    const hadRoleBefore = oldMember.roles.cache.has(SCRIM_PING_ROLE_ID);
    const hasRoleNow = newMember.roles.cache.has(SCRIM_PING_ROLE_ID);

    // Chỉ bắn tin đúng lúc role VỪA được gắn thêm (chưa có -> có). Bỏ qua
    // mọi lần GuildMemberUpdate khác (đổi nickname, role khác, v.v.) và
    // trường hợp role đã có sẵn từ trước để không gửi lặp lại.
    if (hadRoleBefore || !hasRoleNow) return;

    // oldMember chưa có trong cache (partial) -> roles.cache của nó rỗng nên
    // hadRoleBefore luôn false, KHÔNG phân biệt được "vừa được gắn role" với
    // "đổi nickname..." -> bỏ qua để khỏi chào/ghi sheet nhầm.
    if (oldMember.partial) return;

    // Tự "vào sổ" tab "Bang" (A = Discord ID, C/D = công thức VLOOKUP, E = Nhất
    // Mộng) — y hệt nm!hi / /hi (commands/hiHelper.js). Chạy TRƯỚC khi gửi tin
    // chào và không bao giờ throw, nên lỗi Sheet không làm mất lời chào.
    registerGreetedMemberSilently(newMember.id).then((result) => {
      if (result.ok) {
        console.log(`[roleGreet] ${newMember.id}: ${result.added ? 'đã thêm' : 'đã có sẵn'} ở dòng ${result.rowNumber} tab "Bang".`);
      }
    });

    const channel = await client.channels.fetch(FEEDBACK_CHANNEL_ID);
    if (!channel) return;

    // Dùng chung nội dung với /hi và nm!hi (commands/hiHelper.js).
    await channel.send(buildHiMessageContent(newMember.id));

  } catch (error) {
    console.error('Failed to auto-greet member on role assign:', error.message);
  }
});
