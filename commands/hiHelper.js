// Dùng chung cho /hi (commands/slashMisc.js), nm!hi (commands/messageMisc.js)
// và POST /admin/hi (admin/routes/routesSrcImage.js) — 1 nội dung chào duy nhất.
//
// Mỗi lần chào 1 người, TỰ ĐỘNG "vào sổ" tab "Bang": cột A = Discord ID,
// cột C/D = công thức VLOOKUP sang tab "Cập nhật phái", cột E = Nhất Mộng
// (xem registerGreetedMember trong googleSheets/memberSheet.js).
const { UPDATE_INFO_CHANNEL_ID, SCRIM_SIGNUP_CHANNEL_ID, BUILD_INFO_CHANNEL_ID, PICK_ROLE_CHANNEL_ID } = require('../config');
const { registerGreetedMember } = require('../googleSheets/memberSheet');

function buildHiMessageContent(discordId) {
  // Link web đặt trong <...> để Discord KHÔNG tạo khung xem trước (embed).
  return `Xin chào bạn <@${discordId}> đến với Nhất Mộng:\n` +
    `Bạn vui lòng update thông tin tại: <#${UPDATE_INFO_CHANNEL_ID}>\n` +
    `Pick role tại: <#${PICK_ROLE_CHANNEL_ID}>\n` +
    `Theo dõi thông tin đăng ký scrim bang tại: <#${SCRIM_SIGNUP_CHANNEL_ID}>\n` +
    `Mọi hoạt động liên quan tới game cập nhật tại (update rank, check gear, thư viện hệ phái): <#${BUILD_INFO_CHANNEL_ID}>\n` +
    `Link web tổng hợp thông tin: <https://nhatmongnth.vercel.app/>`;
}

// KHÔNG throw ra ngoài — lỗi ghi Sheet chỉ trả về { ok: false, error } và log
// ra console, không làm hỏng việc gửi tin chào.
async function registerGreetedMemberSilently(discordId) {
  try {
    const row = await registerGreetedMember(discordId);
    return { ok: true, ...row };
  } catch (error) {
    console.error(`[hi] Không tự "vào sổ" được Discord ID ${discordId} vào tab "Bang":`, error.message);
    return { ok: false, error: error.message };
  }
}

function describeRegisterResult(result) {
  if (!result) return null;
  if (!result.ok) {
    return `⚠️ Đã chào nhưng chưa "vào sổ" được tab "Bang": ${result.error}`;
  }
  if (!result.added && result.repaired) {
    return `🔧 Discord ID này đã có ở dòng ${result.rowNumber} tab "Bang" nhưng công thức C/D đang là chữ thô — đã ghi lại thành công thức.`;
  }
  if (!result.added) {
    return `📒 Discord ID này đã có sẵn ở dòng ${result.rowNumber} tab "Bang" — không ghi thêm.`;
  }
  return `✅ Đã thêm vào dòng ${result.rowNumber} tab "Bang": cột A = Discord ID, C/D = công thức Ingame/Class, E = Nhất Mộng.`;
}

module.exports = { buildHiMessageContent, registerGreetedMemberSilently, describeRegisterResult };
