// Gọi Gemini Vision để đọc ảnh chụp bảng xếp hạng Bang Chiến — cùng cách
// gọi REST + fallback nhiều model như thiKiem/geminiVision.js, chỉ khác là
// prompt được DỰNG ĐỘNG theo đúng tab người dùng đã báo trước (không để AI
// tự đoán tab từ icon — mục 2 spec), và cần đọc CHỈ bảng bên trái (nền
// xanh), bỏ qua bảng bên phải (nền đỏ) + cột "level".
const { GEMINI_API_KEY, GEMINI_MODELS } = require('../config');

const GEMINI_ENDPOINT = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

function buildPrompt(tabName, categoryLabels) {
  const columnList = categoryLabels.map((label, idx) => `${idx + 1}. ${label}`).join('\n');
  return `Bạn là hệ thống trích xuất dữ liệu từ ảnh chụp màn hình bảng xếp hạng game. Ảnh này CHẮC CHẮN thuộc tab "${tabName}" (người dùng đã xác nhận trước, KHÔNG cần đoán lại tab từ icon). Trả lời CHỈ bằng JSON thuần, không kèm markdown code block, không giải thích thêm.

QUY TẮC ĐỌC ẢNH:
- Ảnh có 2 bảng song song: bảng bên TRÁI (nền xanh) là đội cần lấy dữ liệu, bảng bên PHẢI (nền đỏ) là đối thủ — CHỈ đọc bảng bên TRÁI, bỏ qua hoàn toàn bảng bên phải.
- Bỏ qua cột "level" (luôn = 69, không có giá trị).
- Mỗi người chơi có ĐÚNG ${categoryLabels.length} cột số liệu, theo thứ tự cố định sau (trái sang phải):
${columnList}
- Một số ô có thể hiển thị hậu tố "vạn" (đơn vị × 10.000), ví dụ "2235 vạn" nghĩa là 22350000 — PHẢI quy đổi về số nguyên đầy đủ (nhân 10000) trước khi trả về, KHÔNG giữ nguyên dạng "2235 vạn" hay "2235".
- Ô hiển thị "0" thì trả về 0 (số), không bỏ qua/để null.
- Nếu ảnh không hợp lệ (không đọc được bảng xếp hạng nào, ảnh mờ/sai loại), set is_valid_screenshot = false, players = [].

ĐỊNH DẠNG TRẢ VỀ (JSON thuần, không có gì khác):
{
  "is_valid_screenshot": true hoặc false,
  "players": [
    { "name": "Tên người chơi (ingame, giữ nguyên chữ hoa/thường/ký tự đặc biệt như trong ảnh)", "values": [${categoryLabels.map(() => 'số nguyên').join(', ')}] }
  ]
}

Đọc TẤT CẢ người chơi thấy được trong bảng bên trái, không bỏ sót ai, không bịa thêm người không có trong ảnh. Nếu 1 ô số không đọc được rõ, vẫn cố gắng đưa ra số đọc được tốt nhất (không được để trống/null trong mảng values — nếu thực sự không đọc được thì dùng 0), không được bịa số bừa.`;
}

// Prompt cho chế độ TỰ NHẬN DIỆN TAB — dùng khi người dùng gửi ảnh dồn (vd
// 4 tin nhắn x 7 ảnh) mà KHÔNG chọn tab trước mỗi lần gửi (mục "Gửi ảnh tự
// động" — xem bcstat/imagePipeline.js). Khác với buildPrompt() ở trên (tab đã biết
// trước), ở đây Gemini phải TỰ ĐỌC xem ảnh thuộc tab nào rồi mới biết đọc
// mấy cột/theo thứ tự nào.
function buildAutoPrompt(tabCategoryMap) {
  const tabList = Object.keys(tabCategoryMap);
  const tabBlocks = tabList
    .map((tab) => `- "${tab}": ĐÚNG ${tabCategoryMap[tab].length} cột số liệu theo thứ tự: ${tabCategoryMap[tab].join(', ')}`)
    .join('\n');

  return `Bạn là hệ thống trích xuất dữ liệu từ ảnh chụp màn hình bảng xếp hạng game "Bang Chiến". Trả lời CHỈ bằng JSON thuần, không kèm markdown code block, không giải thích thêm.

BƯỚC 1 — XÁC ĐỊNH TAB: Ảnh có 1 sidebar dọc bên phải liệt kê tên các mục (tab), tab ĐANG ĐƯỢC CHỌN sẽ có nền sáng hơn/nổi bật hơn các tab còn lại và thường có icon hình thoi (♦) hoặc mũi tên chỉ vào ngay cạnh nó. Đọc CHÍNH XÁC tên tab đang được chọn đó — PHẢI là 1 trong các tên sau (khớp chính xác chữ, kể cả dấu):
${tabList.map((t) => `"${t}"`).join(', ')}
Nếu không xác định được tab nào đang sáng, hoặc ảnh không phải bảng xếp hạng Bang Chiến, set is_valid_screenshot = false, tab_name = null, players = [].

BƯỚC 2 — ĐỌC BẢNG THEO ĐÚNG TAB đã xác định ở bước 1:
- Ảnh có 2 bảng song song: bảng bên TRÁI (nền xanh) là đội cần lấy dữ liệu, bảng bên PHẢI (nền đỏ) là đối thủ — CHỈ đọc bảng bên TRÁI, bỏ qua hoàn toàn bảng bên phải.
- Bỏ qua cột "level" (luôn = 69, không có giá trị).
- Số cột và thứ tự cột số liệu PHỤ THUỘC vào tab đã xác định ở bước 1, cụ thể từng tab như sau:
${tabBlocks}
- Một số ô có thể hiển thị hậu tố "vạn" (đơn vị × 10.000), ví dụ "2235 vạn" nghĩa là 22350000 — PHẢI quy đổi về số nguyên đầy đủ (nhân 10000) trước khi trả về.
- Ô hiển thị "0" thì trả về 0 (số), không bỏ qua/để null.

ĐỊNH DẠNG TRẢ VỀ (JSON thuần, không có gì khác):
{
  "is_valid_screenshot": true hoặc false,
  "tab_name": "string (đúng 1 trong các tên tab liệt kê ở trên) hoặc null",
  "players": [
    { "name": "Tên người chơi (ingame, giữ nguyên chữ hoa/thường/ký tự đặc biệt như trong ảnh)", "values": [số nguyên, ...ĐÚNG số cột của tab đó] }
  ]
}

Đọc TẤT CẢ người chơi thấy được trong bảng bên trái, không bỏ sót ai, không bịa thêm người không có trong ảnh. Nếu 1 ô số không đọc được rõ, vẫn cố gắng đưa ra số đọc được tốt nhất (không được để trống/null trong mảng values — nếu thực sự không đọc được thì dùng 0), không được bịa số bừa.`;
}

async function callGeminiVisionModel(model, prompt, base64Image, mimeType) {
  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64Image } }],
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

// Phòng trường hợp Gemini lỡ trả string còn dính hậu tố "vạn"/dấu phẩy dù đã
// được yêu cầu quy đổi trong prompt — lớp bảo hiểm cuối, không thay thế yêu
// cầu quy đổi trong prompt. Trả về số nguyên, hoặc 0 nếu không parse được.
function parseVanNumber(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
  const str = String(raw ?? '').trim();
  if (!str) return 0;
  const hasVan = /v[aạ]n/i.test(str);
  const digits = str.replace(/[^\d.]/g, '');
  const num = parseFloat(digits);
  if (Number.isNaN(num)) return 0;
  return Math.round(hasVan ? num * 10000 : num);
}

// tabName: tên tab hiển thị (vd "Chiến Lược"). categoryLabels: mảng nhãn cột
// ĐÚNG THỨ TỰ cho tab đó (xem googleSheets/bcStatSheet.js -> TAB_CATEGORY_KEYS).
// Trả về { ok: true, data: { is_valid_screenshot, players: [{name, values:[...]}] } }
// hoặc { ok: false, reason: 'quota' | 'parse_error' | 'api_error' | 'no_key' }
async function analyzeBcStatScreenshot(imageBuffer, mimeType, tabName, categoryLabels) {
  if (!GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY chưa được cấu hình — không thể đọc ảnh Bang Chiến.');
    return { ok: false, reason: 'no_key' };
  }
  const models = GEMINI_MODELS;
  if (!models.length) {
    console.error('GEMINI_MODELS rỗng — kiểm tra lại config.js.');
    return { ok: false, reason: 'no_key' };
  }

  const prompt = buildPrompt(tabName, categoryLabels);
  const base64Image = imageBuffer.toString('base64');

  for (let i = 0; i < models.length; i += 1) {
    const model = models[i];
    const isLastModel = i === models.length - 1;

    try {
      const result = await callGeminiVisionModel(model, prompt, base64Image, mimeType);

      if (result.ok) {
        try {
          const cleaned = result.text.replace(/^```json\s*|```$/g, '').trim();
          const parsed = JSON.parse(cleaned);
          // Lớp bảo hiểm parseVanNumber cho từng giá trị (xem comment ở hàm).
          if (Array.isArray(parsed.players)) {
            parsed.players = parsed.players.map((p) => ({
              name: String(p.name || '').trim(),
              values: (Array.isArray(p.values) ? p.values : []).map(parseVanNumber),
            }));
          }
          return { ok: true, data: parsed };
        } catch (parseError) {
          console.error('Không parse được JSON từ Gemini Vision (Bang Chiến):', parseError.message, result.text);
          return { ok: false, reason: 'parse_error' };
        }
      }

      console.error(`Gemini Vision lỗi (Bang Chiến, model="${model}"):`, result.status, result.errText);
      if (result.status === 429 && !isLastModel) {
        console.warn(`Model "${model}" hết quota, chuyển sang model dự phòng tiếp theo...`);
        continue;
      }
      if (result.status === 429) return { ok: false, reason: 'quota' };
      return { ok: false, reason: 'api_error' };
    } catch (error) {
      console.error(`Gọi Gemini Vision thất bại (Bang Chiến, model="${model}"):`, error.message);
      if (isLastModel) return { ok: false, reason: 'api_error' };
    }
  }

  return { ok: false, reason: 'api_error' };
}

// Giống analyzeBcStatScreenshot() ở trên, nhưng KHÔNG cần biết trước tab —
// dùng buildAutoPrompt() để Gemini tự đọc tab đang sáng trong ảnh rồi mới
// đọc bảng theo đúng số cột của tab đó. tabCategoryMap: { [tabName]: [label,...] }
// (xem LABEL_BY_KEY + TAB_CATEGORY_KEYS ở bcstat/sessionState.js).
// Trả về { ok: true, data: { is_valid_screenshot, tab_name, players } }
// hoặc { ok: false, reason: 'quota' | 'parse_error' | 'api_error' | 'no_key' | 'unknown_tab' }
async function analyzeBcStatScreenshotAuto(imageBuffer, mimeType, tabCategoryMap) {
  if (!GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY chưa được cấu hình — không thể đọc ảnh Bang Chiến (auto).');
    return { ok: false, reason: 'no_key' };
  }
  const models = GEMINI_MODELS;
  if (!models.length) {
    console.error('GEMINI_MODELS rỗng — kiểm tra lại config.js.');
    return { ok: false, reason: 'no_key' };
  }

  const validTabs = Object.keys(tabCategoryMap);
  const prompt = buildAutoPrompt(tabCategoryMap);
  const base64Image = imageBuffer.toString('base64');

  for (let i = 0; i < models.length; i += 1) {
    const model = models[i];
    const isLastModel = i === models.length - 1;

    try {
      const result = await callGeminiVisionModel(model, prompt, base64Image, mimeType);

      if (result.ok) {
        try {
          const cleaned = result.text.replace(/^```json\s*|```$/g, '').trim();
          const parsed = JSON.parse(cleaned);

          if (!parsed.is_valid_screenshot || !validTabs.includes(parsed.tab_name)) {
            // Ảnh không hợp lệ HOẶC Gemini trả về tên tab không khớp đúng 1
            // trong 4 tab đã biết (vd đọc nhầm chữ, hoặc bịa tên) — coi như
            // không đọc được, KHÔNG cố đoán bừa xem gán vào tab nào.
            return { ok: false, reason: 'unknown_tab' };
          }

          const categoryLabels = tabCategoryMap[parsed.tab_name];
          if (Array.isArray(parsed.players)) {
            parsed.players = parsed.players.map((p) => ({
              name: String(p.name || '').trim(),
              values: (Array.isArray(p.values) ? p.values : [])
                .slice(0, categoryLabels.length)
                .map(parseVanNumber),
            }));
          }
          return { ok: true, data: parsed };
        } catch (parseError) {
          console.error('Không parse được JSON từ Gemini Vision (Bang Chiến, auto):', parseError.message, result.text);
          return { ok: false, reason: 'parse_error' };
        }
      }

      console.error(`Gemini Vision lỗi (Bang Chiến auto, model="${model}"):`, result.status, result.errText);
      if (result.status === 429 && !isLastModel) {
        console.warn(`Model "${model}" hết quota, chuyển sang model dự phòng tiếp theo...`);
        continue;
      }
      if (result.status === 429) return { ok: false, reason: 'quota' };
      return { ok: false, reason: 'api_error' };
    } catch (error) {
      console.error(`Gọi Gemini Vision thất bại (Bang Chiến auto, model="${model}"):`, error.message);
      if (isLastModel) return { ok: false, reason: 'api_error' };
    }
  }

  return { ok: false, reason: 'api_error' };
}

module.exports = { analyzeBcStatScreenshot, analyzeBcStatScreenshotAuto };
