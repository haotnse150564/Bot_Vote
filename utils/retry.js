// ===== Retry helper cho lỗi "Quota exceeded" (Google Sheets API) =====
// Google Sheets API (free tier) giới hạn 60 read request/phút/user. Lúc bot
// vừa deploy, RẤT NHIỀU bước trong ClientReady (index.js) gọi Sheets API
// dồn dập gần như cùng lúc (ensureXSheetsExists, loadState,
// loadChatChannelAllows, loadNoticeBoardNotices, loadAutoDm..., load
// Broadcast..., loadFeedbackSubmissions...) NÊN tới lượt các bước gọi SAU
// CÙNG (đăng lại 3 tin cố định của Sảnh Vinh Danh / Đua Rank Thí Kiếm) dễ
// bị dính quota dù credentials vẫn hoàn toàn ổn — quota này chỉ là giới
// hạn TẠM THỜI theo từng phút (rolling window), tự hết sau khoảng 1 phút,
// nên chỉ cần ĐỢI rồi GỌI LẠI là xong, không cần can thiệp gì thêm (đúng ý
// bạn: "chờ vài phút cho tới khi lấy được dữ liệu").
function isQuotaExceededError(error) {
  const message = String((error && error.message) || error || '');
  return /quota exceeded/i.test(message) || /RESOURCE_EXHAUSTED/i.test(message) || error?.code === 429;
}

// Gọi lại fn() tối đa `attempts` lần khi gặp ĐÚNG lỗi quota Google Sheets —
// lỗi khác (sai quyền, sai ID, mất mạng...) thì NÉM LUÔN ngay lần đầu,
// không đợi vô ích (đợi cũng không giải quyết được các lỗi đó). Delay tăng
// dần theo số lần thử (mặc định 30s/60s/90s/120s, tổng ~5 phút cho 5 lần
// thử) thay vì cố định — vừa đủ "vài phút" để quota tự reset, vừa không
// spam thêm request trong lúc vẫn còn nghẽn.
const status = require('../monitoring/status');

async function retryOnQuotaExceeded(fn, { attempts = 5, baseDelayMs = 30_000, label = '' } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (isQuotaExceededError(error)) status.recordSheetError(`Quota Sheets${label ? `: ${label}` : ''}`, error);
      if (!isQuotaExceededError(error) || attempt === attempts) throw error;
      const delayMs = baseDelayMs * attempt;
      console.warn(
        `⏳ ${label || 'Thao tác Google Sheets'} bị quota (lần ${attempt}/${attempts}), thử lại sau ${Math.round(
          delayMs / 1000
        )}s...`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

module.exports = { isQuotaExceededError, retryOnQuotaExceeded };
