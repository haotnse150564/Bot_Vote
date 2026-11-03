// ===== Hub — kênh menu duy nhất =====
// Kênh HUB_CHANNEL_ID (config.js) có ĐÚNG 1 tin menu cố định (embed + 3 nút, xem hub/format.js), đăng lại
// từ đầu mỗi lần deploy (kênh được dọn sạch trước — xem utils/channelReset.js). Thành viên bấm nút 1 tính năng
// -> bot trả lời RIÊNG TƯ (ephemeral), dùng lại handler của từng module:
//   - Đua Rank Thí Kiếm    -> bảng xếp hạng + nút "Cập nhật điểm"/"Xem Rank".
//   - Vinh Danh Bang Chiến -> CHỈ role NPC_ROLE_ID: mở thẳng popup chọn 1-2 ảnh.
//   - BC Stat              -> CHỈ role NPC_ROLE_ID: mở màn hình /bcstat, ảnh gửi thẳng vào kênh Hub.
//
// Quyền bot cần ở kênh Hub: View Channel, Send Messages, Embed Links, Attach Files, Manage Messages, Read Message History.
// Kênh Hub CHỈ nhận tin của người đang có phiên "chờ gửi ảnh" — tin khác bị xoá (xem hub/messageGuard.js).

const { Events } = require('discord.js');
const client = require('../client');
const { HUB_CHANNEL_ID, NPC_ROLE_ID } = require('../config');
const { isBotReady, replyNotReadyToInteraction } = require('../utils/readyGate');
const { HUB_BUTTON_IDS, HUB_BUTTON_RANK, HUB_BUTTON_VINH_DANH, HUB_BUTTON_BCSTAT, buildHubMessage } = require('./format');
const { buildRankMenuReply, markRankAwaiting, clearRankAwaiting } = require('../thiKiem');
const { handleVinhDanhHubButton } = require('../vinhDanh');
const { buildBcstatMenuReply } = require('../bcstat');
const { setMenuMessageId, getMenuMessageId, startHubSweeper } = require('./messageGuard');

function isNpc(member) {
  return Boolean(member && member.roles && member.roles.cache && member.roles.cache.has(NPC_ROLE_ID));
}

// Đăng tin menu vào kênh Hub — gọi 1 lần lúc ClientReady, SAU resetFixedBoardChannels().
// Ghi nhớ ID tin menu để lớp dọn định kỳ (hub/messageGuard.js) KHÔNG xoá nhầm nó.
let postingMenu = false;

async function ensureHubMessagePosted() {
  if (!HUB_CHANNEL_ID) return;
  if (postingMenu) return;
  postingMenu = true;
  try {
    const channel = await client.channels.fetch(HUB_CHANNEL_ID);
    const menuMessage = await channel.send(buildHubMessage());
    setMenuMessageId(menuMessage.id);
    console.log('Đã đăng tin menu Hub.');
  } catch (error) {
    console.error('Không đăng được tin menu Hub:', error.message);
  } finally {
    postingMenu = false;
  }
}

// Chạy ở mỗi lượt dọn định kỳ: nếu tin menu bị ai đó xoá tay thì đăng lại. CHỈ đăng
// lại khi Discord trả đúng "Unknown Message" (10008/404) hoặc chưa từng đăng được —
// lỗi tạm thời khác (mạng/5xx) thì bỏ qua, tránh đăng trùng 2 tin menu.
async function ensureHubMenuPresent() {
  if (!HUB_CHANNEL_ID || postingMenu) return;
  const currentId = getMenuMessageId();
  if (currentId) {
    const channel = await client.channels.fetch(HUB_CHANNEL_ID);
    try {
      await channel.messages.fetch(currentId);
    } catch (error) {
      if (!(error && (error.code === 10008 || error.status === 404))) throw error;
      console.warn('Tin menu Hub không còn (bị xoá?) — đăng lại.');
      await ensureHubMessagePosted();
      return;
    }

    return;
  }
  console.warn('Tin menu Hub không còn (bị xoá?) — đăng lại.');
  await ensureHubMessagePosted();
}

// Bật lớp dọn định kỳ kênh Hub — gọi 1 lần lúc ClientReady, SAU ensureHubMessagePosted().
function startHubMaintenance() {
  startHubSweeper({ ensureMenu: ensureHubMenuPresent });
}

// Trả về payload ephemeral cho lựa chọn (hoặc { content } báo lỗi/từ chối).
async function buildReplyForOption(option, interaction) {
  switch (option) {
    case HUB_BUTTON_RANK:
      // Mở phiên chờ ảnh: 5 phút tới ảnh người này gửi vào kênh Hub được xử lý
      // như ảnh cập nhật điểm Thí Kiếm (không bị gác cổng xoá) — xem
      // thiKiem/sharedState.js.
      markRankAwaiting(interaction.user.id);
      return buildRankMenuReply();
    case HUB_BUTTON_BCSTAT:
      // CHỈ NPC — buildBcstatMenuReply tự check role và trả { content } nếu không đủ quyền.
      return buildBcstatMenuReply(interaction);
    default:
      return { content: '❌ Lựa chọn không hợp lệ.' };
  }
}

async function handleHubButton(interaction) {
  const option = interaction.customId;

  // Chọn mục khác của Hub = thôi chờ ảnh Thí Kiếm (tránh ảnh Check Gear/bcstat
  // bị nhận nhầm là ảnh rank); riêng mục Rank sẽ mở lại phiên ở buildReplyForOption.
  clearRankAwaiting(interaction.user.id);

  // Vinh Danh Bang Chiến: bấm là mở THẲNG popup chọn ảnh (bỏ tin trung gian). showModal
  // PHẢI là phản hồi đầu tiên nên xử lý TRƯỚC khi defer; handleVinhDanhHubButton tự
  // check role NPC (không phải NPC -> báo riêng tư, không mở popup).
  if (option === HUB_BUTTON_VINH_DANH) {
    if (!isBotReady()) {
      await replyNotReadyToInteraction(interaction);
      return;
    }
    await handleVinhDanhHubButton(interaction);
    return;
  }

  // Bước dựng phản hồi có thể chậm (đọc Google Sheets) -> defer ephemeral ngay.
  try {
    await interaction.deferReply({ ephemeral: true });
  } catch (error) {
    console.error('Không defer được nút Hub:', error.message);
    return;
  }

  if (!isBotReady()) {
    await replyNotReadyToInteraction(interaction);
    return;
  }

  let payload;
  try {
    payload = await buildReplyForOption(option, interaction);
  } catch (error) {
    console.error(`Lỗi dựng phản hồi nút Hub (${option}):`, error.message);
    payload = { content: '❌ Có lỗi xảy ra khi mở tính năng này, vui lòng thử lại sau.' };
  }

  try {
    await interaction.editReply(payload);
  } catch (error) {
    console.error(`Không gửi được phản hồi nút Hub (${option}):`, error.message);
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.isButton() || !HUB_BUTTON_IDS.includes(interaction.customId)) return;
    await handleHubButton(interaction);
  } catch (error) {
    console.error('Lỗi xử lý nút Hub:', error.message);
  }
});

module.exports = { ensureHubMessagePosted, startHubMaintenance };
