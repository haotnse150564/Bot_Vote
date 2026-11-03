// ===== Lệnh nm!: helper dùng chung =====
// Parse @mention -> Discord ID và tách nội dung caption khỏi tên lệnh.

// Chấp nhận Discord ID dạng số HOẶC @mention (<@ID>/<@!ID>) ở những chỗ cần
// 1 Discord ID — dùng cho nm!setmqh (idA/idB, trừ idB khi loai=kimlan vì
// đó là TÊN chứ không phải ID) để không bắt buộc người dùng phải tự đi lấy
// ID số (bật Chế độ nhà phát triển, chuột phải copy ID...), gõ @tag thẳng
// thành viên cũng được. Không phải mention thì trả về nguyên token — để
// applySetMqh() tự validate/báo lỗi định dạng như cũ.
function resolveMentionToken(token) {
  if (!token) return token;
  const trimmed = token.trim();
  const mentionMatch = trimmed.match(/^<@!?(\d{15,25})>$/);
  return mentionMatch ? mentionMatch[1] : trimmed;
}
// Cắt bỏ tên lệnh (vd "nm!postscrim1") khỏi ĐẦU message.content (dùng
// message.content GỐC, không phải bản đã lowercase, để giữ nguyên hoa/thường
// người dùng gõ trong caption), rồi bỏ hết role mention (dạng <@&id>, Discord
// tự chèn khi gõ @TênRole) ra khỏi phần còn lại — role mention được xử lý
// riêng qua message.mentions.roles, không cần giữ lại trong caption. Trả về
// chuỗi rỗng nếu người dùng không gõ gì thêm sau tên lệnh.
function extractPostText(rawContent, commandPrefix) {
  const afterCommand = rawContent.slice(commandPrefix.length);
  const withoutRoleMentions = afterCommand.replace(/<@&\d+>/g, ' ');
  return withoutRoleMentions.replace(/\s+/g, ' ').trim();
}

module.exports = {
  resolveMentionToken,
  extractPostText,
};
