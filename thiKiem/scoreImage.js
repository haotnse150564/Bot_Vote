// ===== Thí Kiếm: xử lý 1 ảnh cập nhật điểm (rate limit -> Gemini -> ghi sheet) =====
// Tách khỏi index.js. Dùng chung cho cả 2 đường gửi ảnh (modal / dán vào kênh).

const { THIKIEM_RATE_LIMIT_MS, THIKIEM_INGAME_REGISTER_CHANNEL_ID } = require('../config');
const {
  getSeasonConfig,
  getRankEntryByDiscordId,
  upsertRankScore,
} = require('../googleSheets/thiKiemSheet');
// Danh sách thành viên + tên ingame lấy trực tiếp từ tab "Bang" (bang đã có
// sẵn danh sách này, không bắt thành viên đăng ký lại riêng cho Thí Kiếm).
const { getMemberInfoByDiscordId } = require('../googleSheets/memberSheet');
const { analyzeThiKiemScreenshot } = require('./geminiVision');
const { rankSheetMutex } = require('./sharedState');
const { refreshLeaderboardMessage, appendRecentUpdateLine } = require('./board');

// Chuẩn hoá tên mùa giải để so sánh (bỏ khoảng trắng thừa, không phân biệt
// hoa/thường) — PHẢI so cả phần "S1"/"S2" ở cuối (không cắt bỏ), vì các mùa
// giải có thể trùng phần tên chính (vd "Phù Sinh Vạn Tượng") nhưng khác số
// Session, nên chỉ tên đầy đủ mới xác định đúng 1 mùa giải duy nhất.
function normalizeSeasonName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// Đo thời gian từng bước để log 1 dòng tổng kết cho mỗi ảnh — khi người dùng
// báo "xử lý lâu" thì nhìn log Railway là biết chậm ở bước nào (Sheets / tải
// ảnh / Gemini / cập nhật bảng).
function createStopwatch() {
  const start = Date.now();
  let last = start;
  const parts = [];
  return {
    lap(label) {
      const now = Date.now();
      parts.push(`${label} ${now - last}ms`);
      last = now;
    },
    summary() {
      return `${parts.join(' | ')} | TỔNG ${Date.now() - start}ms`;
    },
  };
}

const IMAGE_DOWNLOAD_TIMEOUT_MS = 20 * 1000;

function formatDuration(ms) {
  const totalMinutes = Math.ceil(ms / 60000);
  if (totalMinutes < 60) return `${totalMinutes} phút`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} tiếng ${minutes} phút` : `${hours} tiếng`;
}

// Toàn bộ luồng xử lý 1 ảnh gửi lên (Bước 1-6 trong spec gốc). Trả về 1
// chuỗi kết quả (thành công/lỗi) để reply ephemeral cho người dùng.
async function processThiKiemImage(discordId, attachment) {
  const watch = createStopwatch();
  try {
    return await processThiKiemImageSteps(discordId, attachment, watch);
  } finally {
    console.log(`[ThiKiem] Xử lý ảnh của ${discordId}: ${watch.summary()}`);
  }
}

async function processThiKiemImageSteps(discordId, attachment, watch) {
  // Bước 1 — check rate limit (dựa vào Cập nhật lúc trong sheet chính).
  const existing = await getRankEntryByDiscordId(discordId);
  watch.lap('đọc điểm cũ');
  if (existing && existing.capNhatLuc) {
    const lastUpdate = new Date(existing.capNhatLuc).getTime();
    const elapsed = Date.now() - lastUpdate;
    if (!Number.isNaN(lastUpdate) && elapsed < THIKIEM_RATE_LIMIT_MS) {
      const remaining = THIKIEM_RATE_LIMIT_MS - elapsed;
      return `⏳ Bạn cần đợi thêm ${formatDuration(remaining)} để cập nhật điểm tiếp theo.`;
    }
  }

  // Bước 2 — check tên ingame trong tab "Bang" (nguồn danh sách thành viên
  // duy nhất — không còn lệnh tự đăng ký riêng cho Thí Kiếm nữa).
  const memberInfo = await getMemberInfoByDiscordId(discordId);
  watch.lap('tra ingame');
  if (!memberInfo || !memberInfo.ingame) {
    return `❌ Bạn chưa có tên ingame trong danh sách thành viên Bang. Vui lòng cập nhật thông tin tại <#${THIKIEM_INGAME_REGISTER_CHANNEL_ID}> trước khi gửi ảnh cập nhật điểm.`;
  }
  const ingame = memberInfo.ingame;

  // Bước 3 — gọi Gemini Vision.
  let buffer;
  let mimeType = attachment.contentType || 'image/png';
  try {
    // Có timeout + kiểm tra HTTP status (trước đây không có: link ảnh lỗi/treo
    // thì chờ rất lâu hoặc đọc nhầm nội dung lỗi thành "ảnh").
    const response = await fetch(attachment.url, { signal: AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  } catch (error) {
    console.error('Không tải được ảnh Thí Kiếm từ Discord:', error.message);
    return '❌ Không tải được ảnh bạn vừa gửi, vui lòng thử lại.';
  }
  watch.lap('tải ảnh');

  const result = await analyzeThiKiemScreenshot(buffer, mimeType);
  watch.lap('gemini');

  if (!result.ok) {
    if (result.reason === 'quota') {
      return '⚠️ Hệ thống đọc ảnh đang tạm hết quota, vui lòng thử lại sau ít phút.';
    }
    return '❌ Không đọc được ảnh (lỗi hệ thống), vui lòng thử gửi lại ảnh rõ hơn.';
  }

  // Bước 4 — parse & validate response.
  const data = result.data || {};
  if (!data.is_valid_screenshot) {
    return '❌ Ảnh không hợp lệ. Vui lòng gửi ảnh chụp màn hình mục Thí Kiếm Thiên Hạ.';
  }

  const diemRank = Number.isFinite(data.diem_rank) ? data.diem_rank : parseInt(data.diem_rank, 10);
  if (!Number.isFinite(diemRank)) {
    return '❌ Không đọc được điểm rank từ ảnh, vui lòng gửi lại ảnh rõ hơn.';
  }

  // Bước 4b — check tên mùa giải trong ảnh (kèm S1/S2) có khớp mùa giải
  // đang chạy (Config Mùa Giải) không — chặn ảnh chụp từ mùa giải CŨ (trùng
  // tên chính nhưng khác Session) lỡ bị gửi nhầm sau khi đã sang mùa mới.
  // Chỉ chặn khi ĐỌC ĐƯỢC tên mùa giải từ ảnh và nó KHÁC tên đang cấu hình —
  // nếu Gemini không đọc được (null/rỗng) thì bỏ qua bước này, không chặn
  // oan (đỡ phụ thuộc hoàn toàn vào 1 trường phụ, không quan trọng bằng
  // diem_rank).
  const seasonConfig = await getSeasonConfig();
  watch.lap('config mùa');
  const tenMuaGiaiAnh = data.ten_mua_giai;
  if (tenMuaGiaiAnh && seasonConfig.ten_mua_giai) {
    if (normalizeSeasonName(tenMuaGiaiAnh) !== normalizeSeasonName(seasonConfig.ten_mua_giai)) {
      return `❌ Ảnh này thuộc mùa giải "${tenMuaGiaiAnh}", khác với mùa giải đang diễn ra ("${seasonConfig.ten_mua_giai}"). Vui lòng gửi ảnh chụp mùa giải hiện tại.`;
    }
  }

  // Bước 5 + 6 — so sánh & ghi điểm, tính lại hạng toàn bộ. Kèm className
  // lấy sẵn từ tab "Bang" ở Bước 2 (memberInfo) để ghi vào sheet, phục vụ
  // bảng xếp hạng chia theo Class (formatLeaderboardEmbed). stats gom 14
  // trường thống kê đọc thêm từ bảng "Dữ Liệu Mùa Giải" trong ảnh (Số trận,
  // Hạ gục, 5 kỷ lục, 5 trung bình...) — CHỈ lưu vào sheet (cột G-T), KHÔNG
  // hiển thị lên bảng xếp hạng hay web /rank (theo yêu cầu hiện tại).
  const stats = {
    soTran: data.so_tran,
    soTranThang: data.so_tran_thang,
    haGuc: data.ha_guc,
    biHaGuc: data.bi_ha_guc,
    kyLucHaGuc: data.ky_luc_ha_guc,
    kyLucHoTro: data.ky_luc_ho_tro,
    kyLucSatThuong: data.ky_luc_sat_thuong,
    kyLucChiuSt: data.ky_luc_chiu_st,
    kyLucTriLieu: data.ky_luc_tri_lieu,
    haGucTb: data.ha_guc_tb,
    hoTroTb: data.ho_tro_tb,
    satThuongTb: data.sat_thuong_tb,
    chiuStTb: data.chiu_st_tb,
    triLieuTb: data.tri_lieu_tb,
  };
  const { updated, oldScore } = await rankSheetMutex.runExclusive(() =>
    upsertRankScore(discordId, ingame, diemRank, memberInfo.className, stats)
  );
  watch.lap('ghi sheet');

  if (!updated) {
    return `ℹ️ Điểm mới (${diemRank}) không cao hơn điểm hiện tại (${oldScore}) nên không cập nhật.`;
  }

  const entries = await refreshLeaderboardMessage();
  watch.lap('cập nhật bảng');
  const myEntry = entries.find((e) => e.discordId === String(discordId));
  const hang = myEntry ? myEntry.hang : '?';

  // Ghi thêm 1 dòng vào tin Nhật Ký Cập Nhật (tin cố định #3, tối đa 5 dòng
  // gần nhất) — tự bắt lỗi bên trong, không làm hỏng luồng trả kết quả
  // chính nếu có sự cố (xem thiKiem/board.js -> appendRecentUpdateLine).
  await appendRecentUpdateLine(ingame);
  watch.lap('nhật ký cập nhật');

  // Bước 8 — reply xác nhận.
  return `✅ Đã cập nhật: ${oldScore ?? 0} → ${diemRank}. Hạng hiện tại: #${hang}.`;
}

module.exports = { processThiKiemImage };
