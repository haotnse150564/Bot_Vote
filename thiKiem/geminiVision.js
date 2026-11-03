// Gọi Gemini Vision để đọc thông tin từ ảnh screenshot "Thí Kiếm Thiên Hạ" —
// cùng cách gọi REST + cơ chế fallback nhiều model như AutoReply/aiClient.js,
// chỉ khác là gửi kèm ảnh (inline_data) và ép trả JSON thuần
// (responseMimeType: "application/json").
const { GEMINI_API_KEY, GEMINI_MODELS } = require('../config');

const GEMINI_ENDPOINT = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

const VISION_PROMPT = `Bạn là hệ thống trích xuất dữ liệu từ ảnh chụp màn hình game. Phân tích ảnh được cung cấp và trả lời CHỈ bằng JSON thuần, không kèm markdown code block, không giải thích thêm.

ĐIỀU KIỆN VALIDATE:
- Ảnh hợp lệ CHỈ KHI góc trên cùng bên trái của ảnh hiển thị chữ "Thí Kiếm Thiên Hạ" (có thể có icon kim cương/logo bên cạnh).
- Nếu góc trên bên trái là bất kỳ tên hạng mục nào khác (không phải "Thí Kiếm Thiên Hạ"), set is_valid_screenshot = false và các trường còn lại để null.

CÁC TRƯỜNG CẦN TRÍCH XUẤT (nếu ảnh hợp lệ):
- ten_mua_giai: tên mùa giải, ví dụ "Phù Sinh Vạn Tượng S1" (thường ở dạng "[Tên] S[số]")
- thoi_gian_bat_dau: ngày bắt đầu mùa giải (định dạng DD/MM/YYYY), lấy từ dòng có 2 ngày cách nhau bằng dấu "-"
- thoi_gian_ket_thuc: ngày kết thúc mùa giải (định dạng DD/MM/YYYY)
- cap_rank: cấp bậc rank cao nhất, ví dụ "Thiên Hạ Vô Song" (chỉ mang tính tham khảo, không cần chính xác tuyệt đối)
- diem_rank: SỐ ĐIỂM RANK CAO NHẤT — đây là trường QUAN TRỌNG NHẤT, phải đọc chính xác. Đây là con số xuất hiện ngay sau tên cấp rank, ví dụ trong câu "Rank cao nhất: Thiên Hạ Vô Song 2114 Điểm Rank" thì diem_rank = 2114. Chỉ lấy phần số, bỏ chữ "Điểm Rank".

Ngoài ra, ảnh còn có 1 bảng thống kê gồm 3 hàng số (mỗi hàng có nhãn ở trên, số ở dưới) — trích xuất thêm các trường sau (đọc CHỈ PHẦN SỐ, bỏ hết chữ/đơn vị/dấu ngoặc):
- so_tran: số ở ô "Số trận"
- so_tran_thang: số ở ô "Số trận thắng" — CHỈ lấy số trận (vd trong "73 (60%)" thì so_tran_thang = 73), BỎ phần % trong ngoặc, không tự tính lại
- ha_guc: số ở ô "Hạ gục" (không phải "Kỷ lục hạ gục")
- bi_ha_guc: số ở ô "Bị hạ gục"
- ky_luc_ha_guc: số ở ô "Kỷ lục hạ gục"
- ky_luc_ho_tro: số ở ô "Kỷ lục hỗ trợ"
- ky_luc_sat_thuong: số ở ô "Kỷ lục ST" (có thể ghi dạng "39821K" — giữ nguyên hậu tố K nếu có, trả về dạng string)
- ky_luc_chiu_st: số ở ô "Kỷ lục chịu ST" (giữ hậu tố K nếu có, trả về dạng string)
- ky_luc_tri_lieu: số ở ô "Kỷ lục trị liệu" (giữ hậu tố K nếu có, trả về dạng string)
- ha_guc_tb: số ở ô "Hạ gục TB"
- ho_tro_tb: số ở ô "Hỗ trợ TB"
- sat_thuong_tb: số ở ô "Sát thương TB" (giữ hậu tố K nếu có, trả về dạng string)
- chiu_st_tb: số ở ô "Chịu sát thương TB" (giữ hậu tố K nếu có, trả về dạng string)
- tri_lieu_tb: số ở ô "Trị liệu TB" (giữ hậu tố K nếu có, trả về dạng string)

ĐỊNH DẠNG TRẢ VỀ (JSON thuần, không có gì khác):
{
  "is_valid_screenshot": true hoặc false,
  "ten_mua_giai": "string hoặc null",
  "thoi_gian_bat_dau": "string hoặc null",
  "thoi_gian_ket_thuc": "string hoặc null",
  "cap_rank": "string hoặc null",
  "diem_rank": số nguyên hoặc null,
  "so_tran": số nguyên hoặc null,
  "so_tran_thang": số nguyên hoặc null,
  "ha_guc": số nguyên hoặc null,
  "bi_ha_guc": số nguyên hoặc null,
  "ky_luc_ha_guc": số nguyên hoặc null,
  "ky_luc_ho_tro": số nguyên hoặc null,
  "ky_luc_sat_thuong": "string hoặc null",
  "ky_luc_chiu_st": "string hoặc null",
  "ky_luc_tri_lieu": "string hoặc null",
  "ha_guc_tb": số nguyên hoặc null,
  "ho_tro_tb": số nguyên hoặc null,
  "sat_thuong_tb": "string hoặc null",
  "chiu_st_tb": "string hoặc null",
  "tri_lieu_tb": "string hoặc null"
}

Nếu không chắc chắn đọc được diem_rank chính xác (ảnh mờ, bị che...), vẫn cố gắng đưa ra số đọc được tốt nhất, không được bịa số. Các trường thống kê mới ở trên nếu không thấy/không đọc được thì để null, không bịa số — các trường này không bắt buộc để ảnh hợp lệ (chỉ diem_rank và các trường mùa giải là bắt buộc để is_valid_screenshot = true).`;

// Trước đây fetch Gemini KHÔNG có timeout: nếu Gemini treo kết nối thì người
// dùng chờ tới ~5 phút (timeout mặc định của Node) và khoá `processingUsers`
// suốt thời gian đó ("đang xử lý" mãi). Giờ mỗi lần gọi 1 model tối đa
// GEMINI_VISION_TIMEOUT_MS — quá hạn coi như lỗi và chuyển model dự phòng.
const GEMINI_VISION_TIMEOUT_MS = 40 * 1000;

async function callGeminiVisionModel(model, base64Image, mimeType) {
  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: VISION_PROMPT }, { inline_data: { mime_type: mimeType, data: base64Image } }],
      },
    ],
    generationConfig: { responseMimeType: 'application/json' },
  };

  const response = await fetch(`${GEMINI_ENDPOINT(model)}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(GEMINI_VISION_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errText = await response.text();
    return { ok: false, status: response.status, errText };
  }

  const data = await response.json();
  const candidate = data?.candidates?.[0];
  const text = candidate?.content?.parts?.map((part) => part.text).join('') ?? '';
  return { ok: true, text: text.trim() };
}

// Trả về:
//   { ok: true, data: {...JSON đã parse...} }
//   { ok: false, reason: 'quota' | 'parse_error' | 'api_error' | 'no_key' }
async function analyzeThiKiemScreenshot(imageBuffer, mimeType) {
  if (!GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY chưa được cấu hình — không thể đọc ảnh Thí Kiếm.');
    return { ok: false, reason: 'no_key' };
  }

  const models = GEMINI_MODELS;
  if (!models.length) {
    console.error('GEMINI_MODELS rỗng — kiểm tra lại config.js.');
    return { ok: false, reason: 'no_key' };
  }

  const base64Image = imageBuffer.toString('base64');

  for (let i = 0; i < models.length; i += 1) {
    const model = models[i];
    const isLastModel = i === models.length - 1;

    try {
      const result = await callGeminiVisionModel(model, base64Image, mimeType);

      if (result.ok) {
        try {
          // Phòng trường hợp model vẫn lỡ bọc ```json ... ``` dù đã ép
          // responseMimeType — bóc lớp markdown thừa trước khi parse.
          const cleaned = result.text.replace(/^```json\s*|```$/g, '').trim();
          const parsed = JSON.parse(cleaned);
          return { ok: true, data: parsed };
        } catch (parseError) {
          console.error('Không parse được JSON từ Gemini Vision:', parseError.message, result.text);
          return { ok: false, reason: 'parse_error' };
        }
      }

      console.error(`Gemini Vision lỗi (model="${model}"):`, result.status, result.errText);

      if (result.status === 429 && !isLastModel) {
        console.warn(`Model "${model}" hết quota, chuyển sang model dự phòng tiếp theo...`);
        continue;
      }
      if (result.status === 429) {
        return { ok: false, reason: 'quota' };
      }
      return { ok: false, reason: 'api_error' };
    } catch (error) {
      console.error(`Gọi Gemini Vision thất bại (model="${model}"):`, error.message);
      if (isLastModel) return { ok: false, reason: 'api_error' };
    }
  }

  return { ok: false, reason: 'api_error' };
}

module.exports = { analyzeThiKiemScreenshot };
