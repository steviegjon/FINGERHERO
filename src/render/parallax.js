// Background silhouette layers with atmospheric perspective, plus the motion-blurred foreground.
// Each layer scrolls at a fraction of world speed. Its content is generated in "pieces" tagged with
// the biome that was coming up when the piece scrolled in, so biome changes sweep in naturally
// (far layers change later than near ones), and colours cross-fade on top of that.
import { VIEW, FRAME, SPEED } from '../config.js';
import { BIOMES } from '../world/biomes.js';
import { RNG, rgb, mixRgb, hexToRgb, noise1, hash1, clamp, lerp, smoothstep, TAU } from '../util.js';
import { atmos } from './sky.js';

const BOTTOM = FRAME.sill + 40;

// Layer definitions (far -> near). kinds[biome] chooses the ridge + item style.
export const LAYERS = [
  { p: 0.03, fog: 0.72, base: 430, kinds: { country: 'hills', town: 'hills', highway: 'mountains', city: 'skylineFar' } },
  { p: 0.075, fog: 0.54, base: 492, kinds: { country: 'farms', town: 'steeple', highway: 'billboards', city: 'skylineMid' } },
  { p: 0.17, fog: 0.34, base: 538, kinds: { country: 'treeline', town: 'storefronts', highway: 'treeline', city: 'rowhouses' } },
  { p: 0.34, fog: 0.17, base: 578, kinds: { country: 'bushes', town: 'hedges', highway: 'guardrailBack', city: 'lowwalls' } },
];

function ridge(kind, X, base) {
  switch (kind) {
    case 'hills': return base - 70 * noise1(X / 420) - 26 * noise1(X / 130 + 9);
    case 'mountains': {
      const a = Math.abs(noise1(X / 260) * 2 - 1), b = Math.abs(noise1(X / 90 + 3) * 2 - 1);
      return base - 40 - 150 * (1 - a) - 40 * (1 - b);
    }
    case 'skylineFar': case 'skylineMid': return base + 8;
    case 'farms': case 'steeple': case 'billboards': return base - 14 * noise1(X / 300) - 6 * noise1(X / 70);
    case 'treeline': return base - 16 - 20 * noise1(X / 60) - 14 * noise1(X / 23 + 5) - 18 * noise1(X / 400);
    case 'storefronts': case 'rowhouses': return base;
    case 'bushes': return base - 10 * noise1(X / 40) - 8 * noise1(X / 17 + 2);
    case 'hedges': return base - 6 - 10 * noise1(X / 34);
    case 'guardrailBack': case 'lowwalls': return base + 4 - 3 * noise1(X / 200);
    default: return base;
  }
}

export class Parallax {
  constructor(seed) {
    this.rng = new RNG(seed ^ 0x5eed);
    this.layers = LAYERS.map((def, i) => ({ def, i, offset: 0, pieces: [], tint: null }));
    this.fore = { offset: 0 };
    this.streaks = [];
    for (let i = 0; i < 26; i++) this.streaks.push({ x: this.rng.float(0, VIEW.W * 2), y: this.rng.float(FRAME.top + 30, FRAME.sill - 10), len: this.rng.float(60, 220), sp: this.rng.float(1.2, 2.4), a: this.rng.float(0.3, 1) });
  }

  // biomeAhead(): id of the biome currently scrolling in at the right edge
  update(dt, speed, biomeAhead) {
    for (const L of this.layers) {
      L.offset += speed * L.def.p * dt;
      this.ensure(L, biomeAhead);
    }
    this.fore.offset += speed * 1.6 * dt;
    for (const s of this.streaks) s.x -= speed * s.sp * dt;
    for (const s of this.streaks) if (s.x + s.len < 0) { s.x += VIEW.W * 2 + this.rng.float(0, 400); s.y = this.rng.float(FRAME.top + 30, FRAME.sill - 10); }
  }

  ensure(L, biomeAhead) {
    const r = this.rng;
    const right = L.offset + VIEW.W + 200;
    if (!L.pieces.length) L.pieces.push({ x0: L.offset - 400, x1: L.offset - 400, biome: biomeAhead(), items: [] });
    while (L.pieces[L.pieces.length - 1].x1 < right) {
      const last = L.pieces[L.pieces.length - 1];
      const biome = biomeAhead();
      const w = r.float(500, 900);
      const piece = { x0: last.x1, x1: last.x1 + w, biome, items: [] };
      this.populate(L, piece);
      L.pieces.push(piece);
    }
    while (L.pieces.length > 2 && L.pieces[1].x1 < L.offset - 300) L.pieces.shift();
  }

  populate(L, piece) {
    const r = this.rng;
    const kind = L.def.kinds[piece.biome];
    const add = (type, x, o = {}) => piece.items.push({ type, x, seed: r.int(0, 1e6), ...o });
    let x = piece.x0 + r.float(20, 120);
    const end = piece.x1;
    switch (kind) {
      case 'skylineFar':
        while (x < end) { const w = r.float(40, 90); add('tower', x, { w, h: r.float(110, 280), roof: r.int(0, 3) }); x += w + r.float(-10, 8); }
        break;
      case 'skylineMid':
        while (x < end) { const w = r.float(50, 110); add('tower', x, { w, h: r.float(90, 230), roof: r.int(0, 3) }); x += w + r.float(6, 40); }
        break;
      case 'farms':
        while (x < end) {
          const t = r.pick(['barn', 'silo', 'barn', 'windmill', 'house', 'none', 'none']);
          if (t !== 'none') add(t, x, { s: r.float(0.8, 1.2) });
          x += r.float(140, 320);
        }
        break;
      case 'steeple':
        while (x < end) {
          const t = r.pick(['church', 'watertower', 'house', 'house', 'silo', 'none']);
          if (t !== 'none') add(t, x, { s: r.float(0.85, 1.15) });
          x += r.float(130, 300);
        }
        break;
      case 'billboards':
        while (x < end) {
          const t = r.pick(['billboard', 'pylon', 'none', 'pylon']);
          if (t !== 'none') add(t, x, { s: r.float(0.9, 1.2), text: r.int(0, 4) });
          x += r.float(220, 420);
        }
        break;
      case 'treeline':
        while (x < end) { if (r.chance(0.4)) add('poplar', x, { s: r.float(0.8, 1.3) }); x += r.float(50, 160); }
        break;
      case 'storefronts':
        while (x < end) { const w = r.float(60, 120); add('shop', x, { w, h: r.float(34, 70), awning: r.chance(0.5) }); x += w + r.float(4, 30); }
        break;
      case 'rowhouses':
        while (x < end) { const w = r.float(50, 90); add('row', x, { w, h: r.float(60, 120) }); x += w + r.float(0, 6); }
        break;
      case 'bushes':
        while (x < end) { if (r.chance(0.35)) add('tuft', x, { s: r.float(0.7, 1.3) }); x += r.float(40, 110); }
        break;
      case 'hedges':
        while (x < end) { if (r.chance(0.5)) add('lamp', x, { s: 1 }); x += r.float(160, 300); }
        break;
      case 'guardrailBack':
        while (x < end) { add('post', x); x += 46; }
        break;
      case 'lowwalls':
        while (x < end) { if (r.chance(0.6)) add('lamp', x, { s: 1.3 }); x += r.float(120, 220); }
        break;
      default: break;
    }
  }

  pieceAt(L, X) {
    for (const p of L.pieces) if (X >= p.x0 && X < p.x1) return p;
    return L.pieces[L.pieces.length - 1];
  }

  drawLayer(ctx, P, i, t) {
    const L = this.layers[i];
    if (!L.pieces.length) return;
    const def = L.def;
    // colour: biome tint at screen centre, cross-faded over time
    const centre = this.pieceAt(L, L.offset + VIEW.W * 0.5);
    const target = hexToRgb(BIOMES[centre.biome].tint);
    L.tint = L.tint ? mixRgb(L.tint, target, 0.02) : target;
    const silBase = mixRgb(P.lane, L.tint, 0.55);
    const col = atmos(P, silBase, def.fog);
    const colStr = rgb(col);

    // continuous ridge, blended across biome boundaries
    ctx.fillStyle = colStr;
    ctx.beginPath();
    ctx.moveTo(-10, BOTTOM);
    const blendW = 260;
    for (let sx = -10; sx <= VIEW.W + 10; sx += 8) {
      const X = L.offset + sx;
      const p = this.pieceAt(L, X);
      const k = def.kinds[p.biome];
      let y = ridge(k, X, def.base);
      const idx = L.pieces.indexOf(p);
      if (idx > 0 && X - p.x0 < blendW) {
        const prev = L.pieces[idx - 1];
        const pk = def.kinds[prev.biome];
        if (pk !== k) y = lerp(ridge(pk, X, def.base), y, smoothstep(0, blendW, X - p.x0));
      }
      ctx.lineTo(sx, y);
    }
    ctx.lineTo(VIEW.W + 10, BOTTOM);
    ctx.closePath();
    ctx.fill();

    // items
    for (const p of L.pieces) {
      if (p.x1 < L.offset - 200 || p.x0 > L.offset + VIEW.W + 200) continue;
      const k = def.kinds[p.biome];
      for (const it of p.items) {
        const sx = it.x - L.offset;
        if (sx < -320 || sx > VIEW.W + 120) continue;
        const gy = ridge(k, it.x, def.base);
        drawItem(ctx, it, sx, gy, colStr, col, P, def, t);
      }
    }
  }

  // Nearest foreground, whipping past with horizontal motion blur.
  drawForeground(ctx, P, biomeId, speed) {
    const kind = BIOMES[biomeId].fore;
    const blur = clamp(speed * 0.045, 6, 46);
    const col = mixRgb(P.lane, '#000000', 0.35);
    const off = this.fore.offset;
    const spacing = { fence: 118, hedge: 150, guardrail: 84, posts: 170 }[kind] ?? 120;
    const first = Math.floor((off - 60) / spacing);
    ctx.save();
    // long continuous element (rails / hedge body) as a soft band
    if (kind === 'fence' || kind === 'guardrail') {
      const y = kind === 'fence' ? 574 : 582;
      ctx.fillStyle = rgb(col, 0.8);
      ctx.fillRect(FRAME.left, y, FRAME.right - FRAME.left, kind === 'fence' ? 4 : 11);
      if (kind === 'fence') ctx.fillRect(FRAME.left, y + 18, FRAME.right - FRAME.left, 3);
      else { ctx.fillStyle = rgb(mixRgb(col, P.rim, 0.25 * P.rimA), 0.6); ctx.fillRect(FRAME.left, y, FRAME.right - FRAME.left, 2); }
    }
    if (kind === 'hedge') {
      ctx.fillStyle = rgb(col, 0.85);
      ctx.fillRect(FRAME.left, 590, FRAME.right - FRAME.left, 30);
    }
    for (let n = first; n < first + VIEW.W / spacing + 3; n++) {
      const x = n * spacing - off + hash1(n) * spacing * 0.3;
      for (let b = 0; b < 4; b++) {
        const a = [0.8, 0.35, 0.18, 0.08][b];
        const dx = (b * blur) / 3;
        ctx.fillStyle = rgb(col, a);
        if (kind === 'fence') ctx.fillRect(x + dx, 556, 9, 60);
        else if (kind === 'guardrail') ctx.fillRect(x + dx, 578, 8, 40);
        else if (kind === 'hedge') { ctx.beginPath(); ctx.ellipse(x + dx, 590, 46 + hash1(n + 3) * 20, 22, 0, 0, TAU); ctx.fill(); }
        else { ctx.fillRect(x + dx, 520, 7, 100); if (b === 0) ctx.fillRect(x - 10, 518, 27, 4); }
      }
      // grass tufts
      if (kind !== 'hedge') {
        ctx.fillStyle = rgb(col, 0.5);
        const gx = x + spacing * 0.5;
        ctx.beginPath();
        ctx.moveTo(gx - 16, 616);
        ctx.quadraticCurveTo(gx - 4 + blur * 0.3, 596, gx + 4 + blur * 0.5, 588);
        ctx.quadraticCurveTo(gx + 4, 600, gx + 14, 616);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawStreaks(ctx, speed) {
    const f = clamp((speed - SPEED.start * 0.95) / (SPEED.max - SPEED.start), 0, 1);
    if (f <= 0.02) return;
    ctx.save();
    for (const s of this.streaks) {
      const a = 0.09 * f * s.a;
      const g = ctx.createLinearGradient(s.x, 0, s.x + s.len * (0.6 + f), 0);
      g.addColorStop(0, `rgba(255,248,235,0)`);
      g.addColorStop(0.5, `rgba(255,248,235,${a.toFixed(3)})`);
      g.addColorStop(1, `rgba(255,248,235,0)`);
      ctx.fillStyle = g;
      ctx.fillRect(s.x, s.y, s.len * (0.6 + f), 1.2);
    }
    ctx.restore();
  }
}

// ---- items ---------------------------------------------------------------
function litWindows(ctx, x, y, w, h, seed, P, cols, rows, alphaScale = 1) {
  const lit = P.windowLit;
  if (lit < 0.03) return;
  const cw = w / cols, rh = h / rows;
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
    const hsh = hash1(seed * 0.013 + c * 7.1 + r * 13.7);
    if (hsh > lit) continue;
    const warm = hash1(seed + c + r * 3) > 0.3;
    ctx.fillStyle = warm ? `rgba(255,205,120,${(0.85 * alphaScale).toFixed(3)})` : `rgba(190,215,255,${(0.7 * alphaScale).toFixed(3)})`;
    ctx.fillRect(x + c * cw + cw * 0.28, y + r * rh + rh * 0.25, Math.max(1, cw * 0.44), Math.max(1, rh * 0.45));
  }
}

function drawItem(ctx, it, x, gy, colStr, col, P, def, t) {
  const s = it.s ?? 1;
  ctx.fillStyle = colStr;
  const near = def.fog < 0.3;
  const winAlpha = 1 - def.fog * 0.6;
  switch (it.type) {
    case 'tower': {
      const y = gy - it.h;
      ctx.fillRect(x, y, it.w, it.h + 20);
      if (it.roof === 1) ctx.fillRect(x + it.w * 0.4, y - 26, 3, 26);
      if (it.roof === 2) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + it.w / 2, y - 24); ctx.lineTo(x + it.w, y); ctx.fill(); }
      litWindows(ctx, x + 3, y + 6, it.w - 6, it.h - 10, it.seed, P, Math.max(2, Math.round(it.w / 12)), Math.max(3, Math.round(it.h / 14)), winAlpha);
      // aircraft warning light
      if (it.roof === 1 && P.night > 0.3 && Math.sin(t * 3 + it.seed) > 0.6) { ctx.fillStyle = 'rgba(255,60,50,0.9)'; ctx.fillRect(x + it.w * 0.4 - 1, y - 28, 5, 4); }
      break;
    }
    case 'barn': {
      const w = 64 * s, h = 34 * s;
      ctx.fillRect(x, gy - h, w, h + 6);
      ctx.beginPath();
      ctx.moveTo(x - 4, gy - h);
      ctx.lineTo(x + w * 0.18, gy - h - 16 * s);
      ctx.lineTo(x + w / 2, gy - h - 24 * s);
      ctx.lineTo(x + w * 0.82, gy - h - 16 * s);
      ctx.lineTo(x + w + 4, gy - h);
      ctx.fill();
      litWindows(ctx, x + w * 0.4, gy - h * 0.8, w * 0.2, h * 0.3, it.seed, P, 1, 1, winAlpha);
      break;
    }
    case 'silo': {
      const w = 20 * s, h = 76 * s;
      ctx.fillRect(x, gy - h, w, h + 6);
      ctx.beginPath(); ctx.arc(x + w / 2, gy - h, w / 2, Math.PI, 0); ctx.fill();
      break;
    }
    case 'windmill': {
      const h = 70 * s;
      ctx.beginPath(); ctx.moveTo(x - 7 * s, gy); ctx.lineTo(x - 2, gy - h); ctx.lineTo(x + 2, gy - h); ctx.lineTo(x + 7 * s, gy); ctx.fill();
      ctx.save(); ctx.translate(x, gy - h); ctx.rotate(t * 0.8 + it.seed);
      for (let k = 0; k < 6; k++) { ctx.rotate(TAU / 6); ctx.fillRect(0, -1.5, 24 * s, 3); }
      ctx.restore();
      break;
    }
    case 'house': {
      const w = 44 * s, h = 24 * s;
      ctx.fillRect(x, gy - h, w, h + 6);
      ctx.beginPath(); ctx.moveTo(x - 4, gy - h); ctx.lineTo(x + w / 2, gy - h - 18 * s); ctx.lineTo(x + w + 4, gy - h); ctx.fill();
      ctx.fillRect(x + w * 0.7, gy - h - 16 * s, 5, 12 * s);
      litWindows(ctx, x + 4, gy - h + 5, w - 8, h - 10, it.seed, P, 3, 1, winAlpha);
      break;
    }
    case 'church': {
      const w = 50 * s, h = 34 * s;
      ctx.fillRect(x, gy - h, w, h + 6);
      ctx.beginPath(); ctx.moveTo(x - 3, gy - h); ctx.lineTo(x + w / 2, gy - h - 16 * s); ctx.lineTo(x + w + 3, gy - h); ctx.fill();
      const tx = x + w + 2;
      ctx.fillRect(tx, gy - h - 30 * s, 16 * s, h + 30 * s + 6);
      ctx.beginPath(); ctx.moveTo(tx - 2, gy - h - 30 * s); ctx.lineTo(tx + 8 * s, gy - h - 74 * s); ctx.lineTo(tx + 16 * s + 2, gy - h - 30 * s); ctx.fill();
      litWindows(ctx, x + 6, gy - h + 8, w - 12, h - 14, it.seed, P, 3, 1, winAlpha);
      break;
    }
    case 'watertower': {
      const h = 64 * s, tw = 36 * s;
      ctx.fillRect(x + 4, gy - h, 3, h + 4); ctx.fillRect(x + tw - 7, gy - h, 3, h + 4);
      ctx.fillRect(x + tw * 0.45, gy - h, 3, h + 4);
      ctx.beginPath(); ctx.ellipse(x + tw / 2, gy - h - 12 * s, tw / 2 + 3, 16 * s, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + 2, gy - h - 24 * s); ctx.lineTo(x + tw / 2, gy - h - 38 * s); ctx.lineTo(x + tw - 2, gy - h - 24 * s); ctx.fill();
      break;
    }
    case 'billboard': {
      const w = 110 * s, h = 46 * s, py = gy - 50 * s;
      ctx.fillRect(x + w * 0.2, py, 4, 50 * s + 4); ctx.fillRect(x + w * 0.75, py, 4, 50 * s + 4);
      ctx.fillRect(x, py - h, w, h);
      // faint invented panel artwork
      ctx.fillStyle = rgb(mixRgb(col, P.horizon, 0.28));
      ctx.fillRect(x + 4, py - h + 4, w - 8, h - 8);
      ctx.fillStyle = rgb(mixRgb(col, P.horizon, 0.08));
      if (it.text % 2 === 0) { ctx.beginPath(); ctx.arc(x + w * 0.25, py - h / 2, h * 0.28, 0, TAU); ctx.fill(); }
      ctx.fillRect(x + w * 0.45, py - h * 0.62, w * 0.44, 5);
      ctx.fillRect(x + w * 0.45, py - h * 0.42, w * 0.3, 4);
      if (P.night > 0.4) { ctx.fillStyle = 'rgba(255,240,200,0.12)'; ctx.fillRect(x, py - h, w, h); }
      break;
    }
    case 'pylon': {
      const h = 120 * s;
      ctx.beginPath(); ctx.moveTo(x - 12 * s, gy); ctx.lineTo(x - 2, gy - h); ctx.lineTo(x + 2, gy - h); ctx.lineTo(x + 12 * s, gy); ctx.closePath(); ctx.fill();
      ctx.fillRect(x - 20 * s, gy - h + 12, 40 * s, 3); ctx.fillRect(x - 15 * s, gy - h + 30, 30 * s, 3);
      break;
    }
    case 'poplar': {
      const h = 60 * s;
      ctx.beginPath(); ctx.ellipse(x, gy - h * 0.55, 9 * s, h * 0.55, 0, 0, TAU); ctx.fill();
      break;
    }
    case 'shop': {
      ctx.fillRect(x, gy - it.h, it.w, it.h + 6);
      ctx.fillRect(x - 2, gy - it.h - 5, it.w + 4, 5);
      if (it.awning) { ctx.beginPath(); ctx.moveTo(x + 4, gy - it.h * 0.45); ctx.lineTo(x + it.w - 4, gy - it.h * 0.45); ctx.lineTo(x + it.w, gy - it.h * 0.3); ctx.lineTo(x, gy - it.h * 0.3); ctx.fill(); }
      litWindows(ctx, x + 4, gy - it.h * 0.95, it.w - 8, it.h * 0.45, it.seed, P, Math.max(2, Math.round(it.w / 20)), 2, winAlpha);
      if (P.windowLit > 0.3) { ctx.fillStyle = `rgba(255,200,120,${(0.5 * P.windowLit).toFixed(3)})`; ctx.fillRect(x + it.w * 0.2, gy - it.h * 0.25, it.w * 0.6, it.h * 0.22); }
      break;
    }
    case 'row': {
      ctx.fillRect(x, gy - it.h, it.w, it.h + 6);
      ctx.fillRect(x - 2, gy - it.h - 4, it.w + 4, 4);
      litWindows(ctx, x + 4, gy - it.h + 6, it.w - 8, it.h - 16, it.seed, P, Math.max(2, Math.round(it.w / 16)), Math.max(2, Math.round(it.h / 22)), winAlpha);
      break;
    }
    case 'tuft': {
      ctx.beginPath(); ctx.ellipse(x, gy + 2, 22 * s, 12 * s, 0, Math.PI, 0); ctx.fill();
      break;
    }
    case 'lamp': {
      const h = 64 * s;
      ctx.fillRect(x, gy - h, 3, h + 4);
      ctx.fillRect(x - 8, gy - h, 14, 3);
      if (P.night > 0.25) {
        const g = ctx.createRadialGradient(x - 4, gy - h + 3, 0, x - 4, gy - h + 3, 40);
        g.addColorStop(0, `rgba(255,200,120,${(0.55 * P.night).toFixed(3)})`);
        g.addColorStop(1, 'rgba(255,200,120,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - 44, gy - h - 37, 80, 80);
        ctx.fillStyle = colStr;
      }
      break;
    }
    case 'post': {
      ctx.fillRect(x, gy - 14, 4, 18);
      if (near) { ctx.fillRect(x - 23, gy - 13, 46, 5); }
      break;
    }
    default: break;
  }
}
