// ===== welcome/card.js — vẽ ảnh CHÀO thành viên mới và ảnh TẠM BIỆT khi rời server (sharp raster hoá SVG, cùng cách với level/card.js) =====
// mode 'welcome' = "CHÀO MỪNG <tên> đến với Nhất Mộng"; mode 'farewell' = "TẠM BIỆT <tên> rời Nhất Mộng" (chỉ cảnh hoàng hôn / đêm trăng).
// Phong cách vui tươi, chất kiếm hiệp cổ trang, thỉnh thoảng đổi sang "tu tiên" (cảnh đêm, đảo bay, linh khí).
// Mỗi lần vẽ chọn ngẫu nhiên 1 trong 3 cảnh: bình minh / hoàng hôn (kiếm hiệp) hoặc đêm trăng (tu tiên, ~1/4 số lần).
// Font: Noto Sans CJK bundle ở assets/fonts (nạp qua FONTCONFIG_PATH ở index.js) nên chữ Hán 兄弟 không bị ô vuông.
// librsvg KHÔNG hỗ trợ dominant-baseline nên canh chữ bằng y (baseline) tính tay. Lỗi bất kỳ -> ném ra, phía gọi tự gửi tin chữ.
const sharp = require('sharp');
const { WELCOME_AVATAR_TIMEOUT_MS } = require('../config');

const FONT = "'Noto Sans CJK SC', 'DejaVu Sans', 'Noto Sans', Arial, sans-serif";
const W = 1200;
const H = 500;

// Giấy cuộn (nơi ghi chữ) — các cảnh vẽ quanh nó nên cần biết để tránh rải cánh hoa/lấp lánh lên chữ.
const PAPER = { x: 392, y: 108, w: 736, h: 304 };
const CX = PAPER.x + PAPER.w / 2; // tâm chữ

const QUIPS = [
  'Rượu một chén, bang một nhà!',
  'Giang hồ lắm nẻo, bang ta một nhà!',
  'Cùng nhau luyện công, cùng nhau cày kèo!',
  'Huynh đệ đến rồi, mở tiệc thôi!',
  'Tu luyện mệt thì ghé đây nghỉ chân nhé!',
  'Có bang là có chỗ dựa, có huynh đệ là có rượu!',
];

const FAREWELL_QUIPS = [
  'Giang hồ lắm nẻo, hẹn ngày tái ngộ!',
  'Núi cao sông dài, hẹn gặp lại huynh đệ!',
  'Đường xa gió bụi, bảo trọng nhé!',
  'Cửa Nhất Mộng luôn rộng mở, khi nào rảnh ghé chơi!',
  'Một chén rượu tiễn, ngày sau gặp lại!',
];

const PALETTES = {
  dawn: {
    night: false,
    sky: ['#7fd0e8', '#ffe3b8', '#ffc3a0'],
    sun: ['#fffbe0', '#ffd45e'],
    far: '#a9d3c8',
    mid: '#69aca0',
    near: '#2f7670',
    ground: '#215852',
    mist: '#ffffff',
    quip: '#fff3d6',
  },
  sunset: {
    night: false,
    sky: ['#5b6dc8', '#f58a7b', '#ffd27a'],
    sun: ['#fff4c2', '#ffb74a'],
    far: '#c79bb9',
    mid: '#8a63a3',
    near: '#473e7a',
    ground: '#322c5e',
    mist: '#ffd9c4',
    quip: '#ffeccc',
  },
  night: {
    night: true,
    sky: ['#120f45', '#3a2a85', '#8d5bb5'],
    sun: ['#ffffff', '#fff1c0'],
    far: '#6c5aa8',
    mid: '#46408a',
    near: '#262259',
    ground: '#191645',
    mist: '#b9a8ff',
    quip: '#e9e2ff',
  },
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

// Bỏ emoji / chữ kiểu toán học (𝓝𝓪𝓶𝓮) mà font bundle không có -> tránh ô vuông; rỗng thì dùng tên mặc định.
function cleanName(name, fallback = 'Huynh đệ mới') {
  const s = String(name || '')
    .replace(/[\u{1D400}-\u{1D7FF}\u{1F000}-\u{1FFFF}\u{2190}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200B}-\u{200F}\u{2060}\u{E0000}-\u{E007F}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s || fallback;
}

// "Độ rộng" tên: chữ Hán/Hàn/Nhật tính 2, chữ Latin tính 1. Cắt bớt để không tràn giấy cuộn.
function clipName(name, maxWeight = 30, fallback = 'Huynh đệ mới') {
  let w = 0;
  let out = '';
  for (const ch of cleanName(name, fallback)) {
    const cw = ch.charCodeAt(0) > 0x2e7f ? 2 : 1;
    if (w + cw > maxWeight) return { text: `${out}…`, weight: w };
    w += cw;
    out += ch;
  }
  return { text: out, weight: w };
}

function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function fetchAvatarDataUri(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(WELCOME_AVATAR_TIMEOUT_MS) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // Chuẩn hoá về PNG vuông 256 (avatar có thể là webp/gif) để librsvg đọc chắc chắn.
    const png = await sharp(buf).resize(256, 256, { fit: 'cover' }).png().toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch (_) {
    return null; // không có avatar vẫn vẽ ảnh chào bình thường (vòng tròn trống)
  }
}

const insidePaper = (x, y, pad = 14) => x > PAPER.x - pad - 30 && x < PAPER.x + PAPER.w + pad + 30 && y > PAPER.y - pad && y < PAPER.y + PAPER.h + pad + 14;

// ---------- Các mảnh vẽ nhỏ ----------

function cloud(x, y, s, fill, opacity = 1) {
  return (
    `<g transform="translate(${x} ${y}) scale(${s})" fill="${fill}" opacity="${opacity}">` +
    '<ellipse cx="60" cy="40" rx="64" ry="16"/><circle cx="28" cy="30" r="20"/><circle cx="62" cy="19" r="27"/><circle cx="96" cy="30" r="20"/>' +
    '</g>'
  );
}

// Mây "tường vân" — mây trắng có vòng xoáy, dùng làm bệ đỡ avatar.
function swirlCloud(x, y, s, tint) {
  return (
    `<g transform="translate(${x} ${y}) scale(${s})">` +
    `<g fill="#ffffff" stroke="${tint}" stroke-width="1.2" stroke-opacity=".55">` +
    '<ellipse cx="60" cy="40" rx="64" ry="16"/><circle cx="28" cy="30" r="20"/><circle cx="62" cy="19" r="27"/><circle cx="96" cy="30" r="20"/>' +
    '</g>' +
    `<g fill="none" stroke="${tint}" stroke-width="1.6" stroke-linecap="round" opacity=".8">` +
    '<path d="M18 36 q-7 -9 2 -12 q9 -2 9 6 q-1 6 -7 5"/><path d="M58 22 q-8 -10 2 -14 q10 -3 11 6 q-1 7 -8 6"/><path d="M92 37 q-7 -9 2 -12 q9 -2 9 6 q-1 6 -7 5"/>' +
    '</g></g>'
  );
}

function lantern(x, y, s) {
  return (
    `<line x1="${x}" y1="0" x2="${x}" y2="${y - 4 * s}" stroke="#7a3b1a" stroke-width="3"/>` +
    `<g transform="translate(${x} ${y}) scale(${s})">` +
    '<rect x="-15" y="-5" width="30" height="9" rx="3" fill="#e9b73a"/>' +
    '<ellipse cx="0" cy="30" rx="27" ry="30" fill="url(#lanternGrad)"/>' +
    '<ellipse cx="0" cy="30" rx="13" ry="30" fill="none" stroke="#ffd36b" stroke-opacity=".55" stroke-width="2"/>' +
    '<rect x="-13" y="58" width="26" height="8" rx="3" fill="#e9b73a"/>' +
    '<path d="M0 66 V90" stroke="#d62d20" stroke-width="3"/><circle cx="0" cy="92" r="4" fill="#e9b73a"/>' +
    '<path d="M-12 24 q4 -6 9 0 M3 24 q4 -6 9 0" fill="none" stroke="#5a1a10" stroke-width="2.6" stroke-linecap="round"/>' +
    '<path d="M-8 37 q8 9 16 0" fill="none" stroke="#5a1a10" stroke-width="2.6" stroke-linecap="round"/>' +
    '<circle cx="-17" cy="35" r="4.5" fill="#ff9d9d" opacity=".75"/><circle cx="17" cy="35" r="4.5" fill="#ff9d9d" opacity=".75"/>' +
    '</g>'
  );
}

function pagoda(x, baseY, s, body, roof) {
  let out = `<g transform="translate(${x} ${baseY}) scale(${s})">`;
  let y = 0;
  const tiers = [{ hw: 24, h: 16 }, { hw: 19, h: 15 }, { hw: 14, h: 14 }];
  for (const t of tiers) {
    out += `<rect x="${-t.hw + 3}" y="${y - t.h}" width="${(t.hw - 3) * 2}" height="${t.h}" fill="${body}"/>`;
    out += `<path d="M${-t.hw - 12} ${y - t.h + 2} Q${-t.hw + 2} ${y - t.h + 1} 0 ${y - t.h - 12} Q${t.hw - 2} ${y - t.h + 1} ${t.hw + 12} ${y - t.h + 2} Q0 ${y - t.h + 8} ${-t.hw - 12} ${y - t.h + 2}Z" fill="${roof}"/>`;
    y -= t.h + 9;
  }
  out += `<path d="M0 ${y - 4} V${y - 22}" stroke="${roof}" stroke-width="3"/><circle cx="0" cy="${y - 24}" r="3" fill="${roof}"/></g>`;
  return out;
}

function bamboo(x, top, bottom, leafColor, stalkColor, rnd) {
  let out = `<line x1="${x}" y1="${bottom}" x2="${x}" y2="${top}" stroke="${stalkColor}" stroke-width="9" stroke-linecap="round"/>`;
  for (let y = bottom - 40; y > top + 10; y -= 46) {
    out += `<line x1="${x - 6}" y1="${y}" x2="${x + 6}" y2="${y}" stroke="#16403a" stroke-width="2.5"/>`;
  }
  for (let i = 0; i < 4; i++) {
    const ly = top + 14 + i * 34 + rnd() * 10;
    const dir = i % 2 ? 1 : -1;
    out += `<ellipse cx="${x + dir * 20}" cy="${ly}" rx="22" ry="5.5" fill="${leafColor}" transform="rotate(${dir * -24} ${x + dir * 20} ${ly})"/>`;
  }
  return out;
}

function sword(x, y, rot, glow) {
  return (
    `<g transform="translate(${x} ${y}) rotate(${rot})">` +
    '<polygon points="-70,-5 -330,0 -70,5" fill="url(#trailGrad)"/>' +
    (glow ? `<polygon points="0,-9 150,-8 196,0 150,8 0,9" fill="${glow}" opacity=".55" filter="url(#blur6)"/>` : '') +
    '<polygon points="0,-6 150,-5 192,0 150,5 0,6" fill="url(#bladeGrad)" stroke="#8da3c4" stroke-width="1"/>' +
    '<line x1="4" y1="0" x2="176" y2="0" stroke="#7d92b3" stroke-width="1.4"/>' +
    '<rect x="-14" y="-17" width="11" height="34" rx="4" fill="#e9b73a" stroke="#a7791a" stroke-width="1"/>' +
    '<rect x="-54" y="-5.5" width="40" height="11" rx="5" fill="#8a2a22"/>' +
    '<path d="M-48 -5 l5 11 M-40 -5 l5 11 M-32 -5 l5 11 M-24 -5 l5 11" stroke="#d96a4a" stroke-width="1.6"/>' +
    '<circle cx="-58" cy="0" r="7.5" fill="#e9b73a" stroke="#a7791a" stroke-width="1"/>' +
    '<path d="M-60 5 q-14 14 -5 34" fill="none" stroke="#d62d20" stroke-width="4" stroke-linecap="round"/>' +
    '<path d="M-66 38 l5 12 l5 -12z" fill="#d62d20"/>' +
    '</g>'
  );
}

function sparkle(x, y, r, fill, opacity = 0.95) {
  const a = r * 0.28;
  return `<path d="M${x} ${y - r} Q${x + a} ${y - a} ${x + r} ${y} Q${x + a} ${y + a} ${x} ${y + r} Q${x - a} ${y + a} ${x - r} ${y} Q${x - a} ${y - a} ${x} ${y - r}Z" fill="${fill}" opacity="${opacity}"/>`;
}

function petal(x, y, r, rot, fill) {
  return `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.55}" fill="${fill}" opacity=".88" transform="rotate(${rot} ${x} ${y})"/>`;
}

function floatingIsland(x, y, s, top, rock, withPagoda) {
  return (
    `<g transform="translate(${x} ${y}) scale(${s})">` +
    `<path d="M-72 0 Q-46 62 -8 118 Q6 98 12 80 Q50 50 72 0Z" fill="${rock}"/>` +
    `<path d="M-14 6 Q-12 60 -22 96" fill="none" stroke="#bfeaff" stroke-width="5" stroke-linecap="round" opacity=".7"/>` +
    `<ellipse cx="0" cy="0" rx="74" ry="15" fill="${top}"/>` +
    (withPagoda ? pagoda(8, -4, 0.9, '#e8d9c0', '#c0392b') : '<circle cx="-14" cy="-14" r="13" fill="#4fae86"/><circle cx="6" cy="-20" r="15" fill="#5fc197"/>') +
    '</g>'
  );
}

// ---------- Cảnh nền theo kiểu ----------

function sceneSvg(kind, rnd) {
  const p = PALETTES[kind];
  const night = p.night;
  let s = '';

  // Trời + mặt trời/trăng
  s += `<rect width="${W}" height="${H}" fill="url(#skyGrad)"/>`;
  if (night) {
    for (let i = 0; i < 46; i++) {
      const x = rnd() * W;
      const y = rnd() * 280;
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.8 + rnd() * 1.6).toFixed(1)}" fill="#fff" opacity="${(0.35 + rnd() * 0.6).toFixed(2)}"/>`;
    }
  }
  s += `<circle cx="760" cy="82" r="76" fill="url(#sunGlow)"/>`;
  s += `<circle cx="760" cy="82" r="${night ? 44 : 46}" fill="url(#sunGrad)"/>`;
  if (night) s += '<circle cx="748" cy="70" r="9" fill="#e8dcae" opacity=".55"/><circle cx="774" cy="94" r="6" fill="#e8dcae" opacity=".5"/>';

  // Mây xa
  s += cloud(70, 78, 0.8, '#ffffff', night ? 0.16 : 0.75);
  s += cloud(960, 128, 0.7, '#ffffff', night ? 0.14 : 0.7);
  s += cloud(520, 128, 0.55, '#ffffff', night ? 0.12 : 0.6);

  // Núi xa + "đỉnh kiếm" cao có chùa (kiếm hiệp)
  s += `<path d="M0 300 Q70 230 150 285 T300 262 Q380 215 460 275 T620 258 Q700 205 790 270 T950 255 Q1040 215 1110 272 T1200 258 L1200 ${H} L0 ${H}Z" fill="${p.far}"/>`;
  if (!night) {
    s += `<path d="M1030 330 L1056 150 Q1058 98 1086 90 Q1114 98 1116 150 L1146 330Z" fill="${p.far}"/><ellipse cx="1086" cy="91" rx="36" ry="8" fill="${p.mid}"/>`;
    s += pagoda(1086, 86, 0.78, '#f4e4c4', '#c0392b');
  }

  // Sương + núi giữa
  s += `<ellipse cx="300" cy="300" rx="360" ry="22" fill="${p.mist}" opacity="${night ? 0.1 : 0.4}" filter="url(#blur6)"/>`;
  s += `<path d="M0 360 Q90 300 190 350 T370 335 Q460 290 540 345 T720 330 Q820 285 900 340 T1080 328 Q1150 300 1200 340 L1200 ${H} L0 ${H}Z" fill="${p.mid}"/>`;

  // Đảo bay (tu tiên)
  if (night) {
    s += floatingIsland(96, 70, 0.7, '#7ed6a0', '#5a4a92', false);
    s += floatingIsland(1078, 62, 0.82, '#86dfaa', '#5a4a92', true);
    s += floatingIsland(520, 36, 0.4, '#7ed6a0', '#5a4a92', false);
  }

  s += `<ellipse cx="900" cy="372" rx="380" ry="18" fill="${p.mist}" opacity="${night ? 0.08 : 0.32}" filter="url(#blur6)"/>`;
  s += `<path d="M0 430 Q120 385 250 425 T500 420 Q640 380 760 425 T1000 418 Q1110 392 1200 425 L1200 ${H} L0 ${H}Z" fill="${p.near}"/>`;
  s += `<path d="M0 470 Q200 440 420 468 T820 466 T1200 462 L1200 ${H} L0 ${H}Z" fill="${p.ground}"/>`;

  // Tre (kiếm hiệp)
  if (!night) {
    const leaf = '#4fae6a';
    const stalk = '#3f9a5c';
    s += bamboo(20, 210, 500, leaf, stalk, rnd) + bamboo(50, 262, 500, leaf, stalk, rnd);
    s += bamboo(1176, 220, 500, leaf, stalk, rnd) + bamboo(1148, 290, 500, leaf, stalk, rnd);
  }

  // Lồng đèn cười (kiếm hiệp) — dây treo từ mép trên
  if (!night) {
    s += lantern(40, 40, 0.8) + lantern(1166, 36, 0.8) + lantern(112, 14, 0.5);
  }

  return s;
}

// ---------- Ghép ảnh ----------

function buildSvg({ kind, avatar, name, quip, seed, mode = 'welcome' }) {
  const farewell = mode === 'farewell';
  const rnd = makeRng(seed);
  const p = PALETTES[kind];
  const night = p.night;
  const nameInfo = name;
  const nameSize = Math.max(32, Math.min(60, Math.floor(640 / (nameInfo.weight * 0.58 || 1))));
  const AX = 210;
  const AY = 232;
  const AR = 98;

  let s = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  s +=
    '<defs>' +
    `<linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.sky[0]}"/><stop offset=".55" stop-color="${p.sky[1]}"/><stop offset="1" stop-color="${p.sky[2]}"/></linearGradient>` +
    `<radialGradient id="sunGrad"><stop offset="0" stop-color="${p.sun[0]}"/><stop offset="1" stop-color="${p.sun[1]}"/></radialGradient>` +
    `<radialGradient id="sunGlow"><stop offset="0" stop-color="${p.sun[1]}" stop-opacity=".55"/><stop offset="1" stop-color="${p.sun[1]}" stop-opacity="0"/></radialGradient>` +
    '<radialGradient id="auraGrad"><stop offset=".55" stop-color="#7ff3ff" stop-opacity=".0"/><stop offset=".8" stop-color="#7ff3ff" stop-opacity=".55"/><stop offset="1" stop-color="#7ff3ff" stop-opacity="0"/></radialGradient>' +
    '<radialGradient id="haloGrad"><stop offset=".6" stop-color="#fff3b0" stop-opacity="0"/><stop offset=".85" stop-color="#fff3b0" stop-opacity=".7"/><stop offset="1" stop-color="#fff3b0" stop-opacity="0"/></radialGradient>' +
    '<radialGradient id="lanternGrad" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#ff7a5c"/><stop offset="1" stop-color="#d62d20"/></radialGradient>' +
    '<linearGradient id="bladeGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#aebfd8"/></linearGradient>' +
    '<linearGradient id="trailGrad" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="#ffffff" stop-opacity=".85"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>' +
    '<linearGradient id="paperGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbefcf"/><stop offset="1" stop-color="#f0d9a2"/></linearGradient>' +
    '<linearGradient id="rollGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7a4a24"/><stop offset=".45" stop-color="#c58a4a"/><stop offset="1" stop-color="#6e4020"/></linearGradient>' +
    '<linearGradient id="redGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#c0261b"/><stop offset=".5" stop-color="#e0452d"/><stop offset="1" stop-color="#b3201a"/></linearGradient>' +
    '<filter id="blur6" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="6"/></filter>' +
    '<filter id="blur10" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="10"/></filter>' +
    `<clipPath id="avClip"><circle cx="${AX}" cy="${AY}" r="${AR}"/></clipPath>` +
    '</defs>';

  s += sceneSvg(kind, rnd);

  // Kiếm bay ngang mặt trời/trăng
  s += sword(560, 64, -7, night ? '#7ff3ff' : '#fff6c4');

  // Hào quang + avatar
  if (night) s += `<circle cx="${AX}" cy="${AY}" r="${AR + 62}" fill="url(#auraGrad)"/>`;
  s += `<circle cx="${AX}" cy="${AY}" r="${AR + 44}" fill="url(#haloGrad)"/>`;
  s += `<circle cx="${AX}" cy="${AY}" r="${AR + 22}" fill="none" stroke="${night ? '#9ff6ff' : '#fff3b0'}" stroke-width="3" stroke-dasharray="3 12" stroke-linecap="round" opacity=".95"/>`;
  s += `<circle cx="${AX}" cy="${AY}" r="${AR + 11}" fill="#fff" opacity=".9"/>`;
  s += `<circle cx="${AX}" cy="${AY}" r="${AR + 11}" fill="none" stroke="#e9b73a" stroke-width="5"/>`;
  s += `<circle cx="${AX}" cy="${AY}" r="${AR}" fill="#e8d7b0"/>`;
  if (avatar) {
    s += `<image href="${avatar}" xlink:href="${avatar}" x="${AX - AR}" y="${AY - AR}" width="${AR * 2}" height="${AR * 2}" clip-path="url(#avClip)" preserveAspectRatio="xMidYMid slice"/>`;
  } else {
    s += `<text x="${AX}" y="${AY + 26}" font-family="${FONT}" font-size="80" font-weight="bold" fill="#b08a4a" text-anchor="middle">夢</text>`;
  }
  s += `<circle cx="${AX}" cy="${AY}" r="${AR}" fill="none" stroke="#a7791a" stroke-width="2.5"/>`;
  // Dải lụa đỏ quanh hào quang + lấp lánh
  s += sparkle(AX - AR - 26, AY - 70, 13, '#fff7c2') + sparkle(AX + AR + 30, AY - 40, 10, '#fff7c2') + sparkle(AX + 74, AY - AR - 20, 8, '#fff7c2');

  // Mây đỡ avatar (đứng trên mây — tu tiên)
  s += swirlCloud(AX - 152, 352, 2.4, night ? '#8f82d8' : '#7fb6cf');
  s += cloud(AX + 96, 410, 0.9, '#ffffff', 0.95);

  // Bóng đổ + giấy cuộn
  s += `<rect x="${PAPER.x - 4}" y="${PAPER.y + 12}" width="${PAPER.w + 8}" height="${PAPER.h}" rx="10" fill="#000" opacity=".28" filter="url(#blur10)"/>`;
  s += `<rect x="${PAPER.x}" y="${PAPER.y}" width="${PAPER.w}" height="${PAPER.h}" fill="url(#paperGrad)" stroke="#9a6b32" stroke-width="2"/>`;
  s += `<rect x="${PAPER.x + 12}" y="${PAPER.y + 12}" width="${PAPER.w - 24}" height="${PAPER.h - 24}" rx="4" fill="none" stroke="#c9972f" stroke-width="2" stroke-dasharray="7 5" opacity=".85"/>`;
  // Hoạ tiết góc
  for (const [cx, cy] of [[PAPER.x + 30, PAPER.y + 30], [PAPER.x + PAPER.w - 30, PAPER.y + 30], [PAPER.x + 30, PAPER.y + PAPER.h - 30], [PAPER.x + PAPER.w - 30, PAPER.y + PAPER.h - 30]]) {
    s += `<circle cx="${cx}" cy="${cy}" r="6" fill="#c0392b" opacity=".85"/>${sparkle(cx, cy, 11, '#e9b73a', 0.95)}`;
  }
  // 2 trục cuộn
  for (const rx of [PAPER.x - 20, PAPER.x + PAPER.w - 8]) {
    s += `<rect x="${rx}" y="${PAPER.y - 14}" width="28" height="${PAPER.h + 28}" rx="14" fill="url(#rollGrad)" stroke="#4a2a12" stroke-width="2"/>`;
    s += `<circle cx="${rx + 14}" cy="${PAPER.y - 14}" r="9" fill="#e9b73a" stroke="#a7791a" stroke-width="1.5"/><circle cx="${rx + 14}" cy="${PAPER.y + PAPER.h + 14}" r="9" fill="#e9b73a" stroke="#a7791a" stroke-width="1.5"/>`;
  }

  // Chữ trên giấy
  const yHead = PAPER.y + 70;
  const yName = yHead + 28 + Math.round(nameSize * 0.8);
  const yTail = yName + 30 + 46;
  s += `<text x="${CX}" y="${yHead}" font-family="${FONT}" font-size="24" font-weight="bold" letter-spacing="7" fill="#b3261e" text-anchor="middle">${farewell ? 'TẠM BIỆT' : 'CHÀO MỪNG'}</text>`;
  s += `<text x="${CX}" y="${yName}" font-family="${FONT}" font-size="${nameSize}" font-weight="bold" fill="#2b1d12" text-anchor="middle">${esc(nameInfo.text)}</text>`;
  s += `<line x1="${CX - 230}" y1="${yTail - 50}" x2="${CX - 18}" y2="${yTail - 50}" stroke="#c9972f" stroke-width="2"/><line x1="${CX + 18}" y1="${yTail - 50}" x2="${CX + 230}" y2="${yTail - 50}" stroke="#c9972f" stroke-width="2"/>`;
  s += `<path d="M${CX} ${yTail - 58} L${CX + 9} ${yTail - 50} L${CX} ${yTail - 42} L${CX - 9} ${yTail - 50}Z" fill="#c0392b"/>`;
  s += `<text x="${CX}" y="${yTail}" font-family="${FONT}" font-size="42" fill="#5a3b22" text-anchor="middle">${farewell ? 'rời' : 'đến với'} <tspan font-weight="bold" fill="#b3261e">Nhất Mộng</tspan></text>`;
  // Ấn đỏ 一夢 (Nhất Mộng)
  const sx = PAPER.x + PAPER.w - 92;
  const sy = PAPER.y + PAPER.h - 100;
  s += `<g transform="rotate(5 ${sx + 28} ${sy + 30})"><rect x="${sx}" y="${sy}" width="56" height="62" rx="5" fill="#c8281e"/><rect x="${sx + 4}" y="${sy + 4}" width="48" height="54" rx="3" fill="none" stroke="#f9d9c8" stroke-width="1.5"/>` +
    `<text x="${sx + 28}" y="${sy + 28}" font-family="${FONT}" font-size="23" font-weight="bold" fill="#fde9dc" text-anchor="middle">一</text><text x="${sx + 28}" y="${sy + 52}" font-family="${FONT}" font-size="23" font-weight="bold" fill="#fde9dc" text-anchor="middle">夢</text></g>`;

  // Câu vui góc dưới
  s += `<text x="${CX}" y="476" font-family="${FONT}" font-size="22" font-weight="bold" fill="${p.quip}" text-anchor="middle" opacity=".95">${esc(quip)}</text>`;

  // Hoa đào / linh khí bay lả tả (tránh giấy cuộn để không đè chữ)
  const petalColors = night ? ['#c9f6ff', '#e8dcff', '#ffffff'] : ['#ffb7c5', '#ff9fb4', '#ffd0da'];
  let placed = 0;
  for (let i = 0; i < 80 && placed < 16; i++) {
    const x = Math.round(rnd() * W);
    const y = Math.round(rnd() * (H - 40));
    const r = 5 + rnd() * 4;
    const rot = Math.round(rnd() * 180);
    const c = petalColors[Math.floor(rnd() * petalColors.length)];
    if (insidePaper(x, y)) continue;
    if (Math.hypot(x - AX, y - AY) < AR + 12) continue;
    s += night ? `<circle cx="${x}" cy="${y}" r="${(r * 0.55).toFixed(1)}" fill="${c}" opacity=".9" filter="url(#blur6)"/><circle cx="${x}" cy="${y}" r="${(r * 0.32).toFixed(1)}" fill="#fff"/>` : petal(x, y, r, rot, c);
    placed++;
  }
  placed = 0;
  for (let i = 0; i < 60 && placed < 7; i++) {
    const x = Math.round(rnd() * W);
    const y = Math.round(rnd() * (H - 60));
    if (insidePaper(x, y, 24)) continue;
    if (Math.hypot(x - AX, y - AY) < AR + 16) continue;
    s += sparkle(x, y, 6 + rnd() * 7, night ? '#ffffff' : '#fff4b8');
    placed++;
  }

  s += '</svg>';
  return s;
}

// displayName: tên hiển thị trong server. avatarUrl: URL avatar (png).
// mode: 'welcome' (mặc định) | 'farewell'. opts.kind / opts.quip / opts.seed để ép cảnh/câu (dùng khi thử).
async function renderWelcomeCard({ displayName, avatarUrl, kind, quip, seed, mode = 'welcome' }) {
  const farewell = mode === 'farewell';
  const avatar = await fetchAvatarDataUri(avatarUrl);
  const roll = Math.random();
  const fallbackKind = farewell ? (roll < 0.5 ? 'night' : 'sunset') : roll < 0.25 ? 'night' : roll < 0.65 ? 'dawn' : 'sunset';
  const picked = PALETTES[kind] ? kind : fallbackKind;
  const quips = farewell ? FAREWELL_QUIPS : QUIPS;
  const svg = buildSvg({
    kind: picked,
    mode,
    avatar,
    name: clipName(displayName, 30, farewell ? 'Một huynh đệ' : 'Huynh đệ mới'),
    quip: quip || quips[Math.floor(Math.random() * quips.length)],
    seed: Number.isFinite(seed) ? seed : Math.floor(Math.random() * 2 ** 31),
  });
  return sharp(Buffer.from(svg)).png({ compressionLevel: 8 }).toBuffer();
}

module.exports = { renderWelcomeCard, clipName, cleanName, FAREWELL_QUIPS };
