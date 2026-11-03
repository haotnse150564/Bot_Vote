const { Client, GatewayIntentBits, Partials, Options } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    // Required to read who currently holds the auto-vote role (role is the
    // source of truth for auto-vote). Must ALSO be enabled in the Discord
    // Developer Portal -> Bot -> "Server Members Intent".
    GatewayIntentBits.GuildMembers,
    // Required to receive VoiceStateUpdate (ai vào/ra voice channel) —
    // dùng cho tính năng chào khi user trong danh sách VOICE_GREET_USER_IDS
    // vào voice. Không cần bật thêm gì đặc biệt trong Developer Portal cho
    // intent này (không phải privileged intent).
    GatewayIntentBits.GuildVoiceStates,
    // Cần thiết để bot nhận được sự kiện MessageCreate khi có người NHẮN
    // TIN RIÊNG (DM) cho bot — không có intent này, Discord sẽ không gửi
    // sự kiện messageCreate cho DM, mọi lệnh nm!... gõ trong DM sẽ bị bot
    // im lặng bỏ qua hoàn toàn dù code xử lý đã sẵn sàng. Không phải
    // privileged intent, không cần bật gì thêm trong Developer Portal.
    GatewayIntentBits.DirectMessages,
    // Nhật ký thành viên (activityLog/memberEvents.js): nhận sự kiện ban / gỡ ban. Không phải privileged intent.
    GatewayIntentBits.GuildModeration,
  ],
  // Cần thiết để MessageReactionAdd/Remove vẫn bắn ra cho các message
  // KHÔNG nằm trong cache (vd: message vote/bang chiến cũ sau khi bot bị
  // restart/redeploy — bộ nhớ cache bị xóa sạch nhưng message thật vẫn còn
  // trên Discord). Nếu thiếu dòng này, react của user vào các message cũ
  // đó sẽ bị discord.js âm thầm bỏ qua, không lưu được vào Google Sheets.
  // Partials.Channel: cần để nhận đúng sự kiện MessageCreate cho kênh DM
  // KHÔNG nằm trong cache (vd: DM đầu tiên từ 1 user, hoặc sau khi bot vừa
  // restart) — thiếu dòng này thì chỉ DM từ những kênh đã từng cache mới
  // nhận được, không ổn định.
  partials: [Partials.Message, Partials.Reaction, Partials.User, Partials.Channel],

  // ---- Giới hạn cache để RAM không tăng dần vô hạn theo thời gian bot chạy
  // (mặc định discord.js giữ MỌI message/user từng thấy trong RAM mãi mãi
  // tới khi restart — nguồn leak lớn nhất của bot chạy lâu ngày). Đã audit
  // toàn bộ codebase trước khi giới hạn: MỌI chỗ lấy lại message/user cũ
  // đều gọi qua .fetch(id) — nếu cache đã bị dọn, discord.js tự gọi lại API
  // lấy fresh data, KHÔNG throw/lỗi gì (grep "messages.fetch("/"users.fetch("
  // toàn repo không có chỗ nào dùng .cache.get() trực tiếp) — nên 2 Manager
  // dưới đây an toàn 100% khi giới hạn, cái giá duy nhất là thỉnh thoảng
  // tốn thêm 1 API call khi cache miss, không ảnh hưởng tính năng.
  //
  // CỐ Ý KHÔNG đụng tới các Manager sau (giữ mặc định = không giới hạn) vì
  // code THẬT SỰ phụ thuộc cache đầy đủ/dài hạn của chúng:
  //   - GuildMemberManager: voteSheet.js gọi guild.members.fetch() để nạp
  //     FULL member cache trước khi đọc role.members (auto-vote role sync)
  //     — giới hạn cache này sẽ làm role.members thiếu người ngay sau khi
  //     nạp. AutoReply/index.js cũng dò guild.members.cache.get() trực tiếp
  //     (không fetch) để ghép tên Discord vào memberDirectory.
  //   - ReactionManager: scrim/reactions.js + voteSheet.js đọc
  //     message.reactions.cache.get(emoji) NGAY SAU khi vừa react/fetch —
  //     giới hạn về 0 sẽ khiến cache này luôn rỗng, bot không gỡ được
  //     reaction cũ khi đối thủ scrim đổi từ "đã có" về "đang tìm".
  //   - guild.emojis.cache / guild.roles.cache (utils/emoji.js,
  //     voteSheet.js): tự nhiên đã nhỏ (giới hạn bởi số emoji/role thật của
  //     server, không phải "mọi thứ từng thấy"), không cần đụng tới.
  makeCache: Options.cacheWithLimits({
    // Tin nhắn: đa số bot chỉ cần tin GẦN NHẤT của 1 kênh (reply-lookup,
    // auto reply cooldown...) — 50 tin/kênh là dư dùng, phần còn lại tự
    // fetch lại từ API khi cần (vd channel.messages.fetch(scrimData.messageId)).
    MessageManager: 50,
    // User: bot gặp rất nhiều user qua message/reaction theo thời gian —
    // chỉ cần giữ những người tương tác GẦN ĐÂY, các nơi cần DM (autoDm,
    // dm-position-change...) đều gọi client.users.fetch(id) nên tự lấy lại
    // được kể cả khi đã bị dọn khỏi cache.
    UserManager: 200,
    // Các Manager sau KHÔNG được bot dùng ở đâu cả (grep toàn repo không
    // có chỗ nào đụng threads/bans/invites/presences/stageInstances/
    // scheduledEvents/autoModerationRules) — tắt hẳn để không tốn RAM oan.
    ThreadManager: 0,
    GuildBanManager: 0,
    GuildInviteManager: 0,
    PresenceManager: 0,
    StageInstanceManager: 0,
    GuildScheduledEventManager: 0,
    AutoModerationRuleManager: 0,
  }),

  // Dọn định kỳ thêm 1 lớp nữa (ngoài giới hạn số lượng ở trên): message
  // cache nào quá 1 tiếng không được đụng tới sẽ bị xoá hẳn, kể cả khi kênh
  // đó ít chat (chưa kịp bị đẩy ra do giới hạn 50 tin/kênh) — tránh RAM bị
  // giữ oan bởi các kênh gần như im lặng nhưng bot vẫn lỡ cache lại tin cũ.
  sweepers: {
    ...Options.DefaultSweeperSettings,
    messages: {
      interval: 3600, // quét mỗi 1 tiếng
      lifetime: 3600, // xoá tin nhắn cache đã "sống" quá 1 tiếng
    },
  },
});

module.exports = client;