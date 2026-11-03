// Gọi Gemini Vision để đọc "Sảnh Vinh Danh Bang Chiến" — đọc mục "Danh hiệu
// vinh quang" trong ảnh kết quả Bang Chiến (ảnh "Chiến Thắng" đầy đủ HOẶC
// ảnh chỉ crop riêng khung "Danh hiệu vinh quang", cả 2 dạng đều hợp lệ,
// miễn còn thấy tiêu đề "Danh hiệu vinh quang").
//
// Không hardcode cứng tên 10 hạng mục trong prompt — để Gemini tự đọc ĐÚNG
// text hiển thị trong ảnh (đọc theo thứ tự trên xuống dưới, trái sang
// phải), vì tên hạng mục tuy không đổi giữa các trận nhưng nếu sau này game
// cập nhật/đổi tên hạng mục thì bot vẫn tự thích ứng mà không cần sửa code.
// Cùng cách gọi REST + cơ chế fallback nhiều model như thiKiem/geminiVision.js.
const { GEMINI_API_KEY, GEMINI_MODELS } = require('../config');

const GEMINI_ENDPOINT = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

const VISION_PROMPT = `Bạn là hệ thống trích xuất dữ liệu từ ảnh chụp màn hình game. Phân tích ảnh được cung cấp và trả lời CHỈ bằng JSON thuần, không kèm markdown code block, không giải thích thêm.

ĐIỀU KIỆN VALIDATE:
- Ảnh hợp lệ CHỈ KHI trong ảnh có khung/mục tiêu đề "Danh hiệu vinh quang" (có thể kèm icon dấu chấm hỏi bên cạnh). Ảnh có thể là toàn bộ màn hình kết quả "Chiến Thắng" (có khung Danh hiệu vinh quang nằm bên phải) HOẶC chỉ là ảnh crop riêng đúng khung "Danh hiệu vinh quang" — cả 2 dạng đều hợp lệ.
- Nếu ảnh KHÔNG có khung "Danh hiệu vinh quang" nào, set is_valid_screenshot = false và entries = [].

CÁCH ĐỌC KHUNG "Danh hiệu vinh quang":
- Khung này gồm nhiều Ô, mỗi Ô có: 1 icon/huy hiệu, 1 TÊN HẠNG MỤC (chữ màu vàng/trắng, in đậm, vd "Quần Long Chi Thủ", "Bất Khả Chiến Bại"...) và ngay bên dưới là TÊN NGƯỜI CHƠI đạt được hạng mục đó (vd "Bún Bò", "Mameo"...).
- Đọc TUẦN TỰ từng Ô theo thứ tự hiển thị: từ trên xuống dưới, trong cùng 1 hàng thì từ trái sang phải. Đọc ĐỦ MỌI Ô nhìn thấy được trong khung (thường là 10 ô, nhưng cứ đọc đúng số ô thực tế nhìn thấy, không tự bịa thêm hay bớt).
- Với MỖI Ô, trích xuất:
  - danh_hieu: tên hạng mục (chữ in đậm, KHÔNG kèm tên người chơi)
  - ingame: tên người chơi hiển thị ngay dưới tên hạng mục đó (giữ nguyên chữ hoa/thường/khoảng trắng/ký tự đặc biệt như trong ảnh, KHÔNG tự sửa chính tả)
- Nếu 1 Ô bị mờ/che khuất không đọc được rõ TÊN NGƯỜI CHƠI nhưng vẫn đọc được TÊN HẠNG MỤC, vẫn thêm vào entries với ingame = null (không bịa tên).

ĐỊNH DẠNG TRẢ VỀ (JSON thuần, không có gì khác):
{
  "is_valid_screenshot": true hoặc false,
  "entries": [
    { "danh_hieu": "string", "ingame": "string hoặc null" }
  ]
}`;

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
//   { ok: true, data: { is_valid_screenshot, entries } }
//   { ok: false, reason: 'quota' | 'parse_error' | 'api_error' | 'no_key' }
async function analyzeVinhDanhScreenshot(imageBuffer, mimeType) {
  if (!GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY chưa được cấu hình — không thể đọc ảnh Vinh Danh Bang Chiến.');
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
          const cleaned = result.text.replace(/^```json\s*|```$/g, '').trim();
          const parsed = JSON.parse(cleaned);
          return { ok: true, data: parsed };
        } catch (parseError) {
          console.error('Không parse được JSON từ Gemini Vision (Vinh Danh Bang Chiến):', parseError.message, result.text);
          return { ok: false, reason: 'parse_error' };
        }
      }

      console.error(`Gemini Vision lỗi (Vinh Danh Bang Chiến, model="${model}"):`, result.status, result.errText);

      if (result.status === 429 && !isLastModel) {
        console.warn(`Model "${model}" hết quota, chuyển sang model dự phòng tiếp theo...`);
        continue;
      }
      if (result.status === 429) {
        return { ok: false, reason: 'quota' };
      }
      return { ok: false, reason: 'api_error' };
    } catch (error) {
      console.error(`Gọi Gemini Vision thất bại (Vinh Danh Bang Chiến, model="${model}"):`, error.message);
      if (isLastModel) return { ok: false, reason: 'api_error' };
    }
  }

  return { ok: false, reason: 'api_error' };
}

module.exports = { analyzeVinhDanhScreenshot };
