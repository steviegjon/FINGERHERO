// The kid's arm, hand and running fingers.
//
// Gameplay never touches this file. The game calls drawHand(ctx, handState, t) with:
//   handState = { state: 'run'|'jump'|'fall'|'slide'|'land'|'dead', phase (0..1 run cycle),
//                 x, y (feet), vy, squash, deathKind, deathT, stateT, light: {skin, rim, rimA, dark} }
// ProceduralHandRenderer draws everything in code. SpriteHandRenderer draws the hand from
// assets/hand/ when manifest.json names a sheet (see assets/hand/README.md); the arm stays procedural.
import { FRAME } from './config.js';
import { clamp, lerp, rgb, mixRgb, TAU, smoothstep } from './util.js';

const SKIN = { base: '#efb993', shade: '#c98463', light: '#ffe0c6', nail: '#f7d6cc', nailEdge: '#e3ada2', crease: '#b77558' };
const SLEEVE = { base: '#3d6f8f', stripe: '#e9d9b8', cuff: '#2c5670' };
const SHOULDER = { x: -60, y: 960 };
const ARM_MAX = 900;

const UPPER = 21, LOWER = 22; // finger segment lengths (knuckle -> middle joint -> tip)

function ik(hx, hy, fx, fy, a, b, bendSign) {
  let dx = fx - hx, dy = fy - hy;
  let d = Math.hypot(dx, dy);
  const max = a + b - 0.01;
  if (d > max) { dx *= max / d; dy *= max / d; d = max; }
  const base = Math.atan2(dy, dx);
  const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const ang = base - bendSign * Math.acos(cosA);
  const kx = hx + Math.cos(ang) * a, ky = hy + Math.sin(ang) * a;
  return { kx, ky, fx: hx + dx, fy: hy + dy };
}

// Pose: body offset/rotation + per-finger foot targets (relative to the knuckle point).
function pose(hs, t) {
  const st = hs.state;
  const th = hs.phase * TAU;
  const p = {
    bodyDX: 0, bodyDY: 0, rot: 0.08, curl: 0,
    legs: [
      { dx: 4, foot: null },   // index (front)
      { dx: -5, foot: null },  // middle (back)
    ],
    knuckleY: -40,
  };
  const legY = 40; // knuckle -> ground
  if (st === 'run' || st === 'land') {
    const lift = 13, stride = 15;
    p.legs.forEach((L, i) => {
      const a = th + (i ? Math.PI : 0);
      const s = Math.sin(a);
      L.foot = [-stride * Math.cos(a), legY - (s > 0 ? s * lift : 0)];
    });
    p.bodyDY = -1.8 * Math.abs(Math.sin(th * 2));
    p.rot = 0.1;
    if (st === 'land') p.bodyDY += 4;
  } else if (st === 'jump') {
    p.legs[0].foot = [10, 26];
    p.legs[1].foot = [-12, 30];
    p.rot = 0.02;
  } else if (st === 'fall') {
    const w = Math.sin(t * 22) * 3;
    p.legs[0].foot = [9 + w, 41];
    p.legs[1].foot = [-7 - w, 39];
    p.rot = 0.05;
  } else if (st === 'slide') {
    p.slide = true;
  } else if (st === 'dead') {
    const k = hs.deathKind, dt = hs.deathT;
    if (k === 'bug') {
      const e = smoothstep(0, 0.16, dt);
      p.bodyDX = -46 * e - Math.sin(dt * 60) * 3 * (1 - e);
      p.bodyDY = -26 * e + Math.max(0, dt - 0.35) ** 2 * 900;
      p.rot = -0.35 * e;
      p.curl = e;
      p.legs[0].foot = [lerp(6, -4, e), lerp(40, 18, e)];
      p.legs[1].foot = [lerp(-6, -14, e), lerp(40, 16, e)];
    } else if (k === 'hit') {
      const e = smoothstep(0, 0.12, dt);
      p.rot = 0.1 + 0.9 * e;
      p.curl = e;
      p.legs[0].foot = [lerp(8, -18, e), lerp(40, 14, e)];
      p.legs[1].foot = [lerp(-6, -22, e), lerp(40, 10, e)];
      p.bodyDX = -10 * e;
      p.bodyDY = Math.max(0, dt - 0.18) ** 2 * 2600; // arm yanks down out of frame
    } else { // fall: flail
      const w = Math.sin(dt * 40);
      p.legs[0].foot = [12 * w, 38 - 8 * Math.abs(w)];
      p.legs[1].foot = [-12 * w, 36 - 8 * Math.abs(w)];
      p.rot = 0.15 * Math.sin(dt * 25);
    }
  }
  return p;
}

function tint(c, L) {
  // skin under scene light: darker at night, never flat
  return mixRgb(c, '#1a1420', L.dark);
}

function capsule(ctx, pts, w0, w1, fill) {
  // tapered stroke through points (2-3 points), drawn as round-capped segments
  ctx.fillStyle = fill;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const wa = lerp(w0, w1, i / (pts.length - 1)), wb = lerp(w0, w1, (i + 1) / (pts.length - 1));
    const ang = Math.atan2(y1 - y0, x1 - x0);
    const nx = -Math.sin(ang), ny = Math.cos(ang);
    ctx.beginPath();
    ctx.moveTo(x0 + nx * wa / 2, y0 + ny * wa / 2);
    ctx.lineTo(x1 + nx * wb / 2, y1 + ny * wb / 2);
    ctx.arc(x1, y1, wb / 2, ang + Math.PI / 2, ang - Math.PI / 2, true);
    ctx.lineTo(x0 - nx * wa / 2, y0 - ny * wa / 2);
    ctx.arc(x0, y0, wa / 2, ang - Math.PI / 2, ang + Math.PI / 2, true);
    ctx.fill();
  }
}

function drawFinger(ctx, hip, knee, tip, L, back, rimCol) {
  const base = tint(back ? SKIN.shade : SKIN.base, L);
  const lightC = tint(SKIN.light, L);
  const w0 = back ? 10 : 11.5, w1 = back ? 8.5 : 9.5;
  // shadow edge
  capsule(ctx, [hip, knee, tip], w0 + 1.2, w1 + 1.2, rgb(tint(SKIN.crease, L), 0.9));
  capsule(ctx, [hip, knee, tip], w0, w1, rgb(base));
  // soft highlight along the upper/front edge
  const off = (p, q) => { const a = Math.atan2(q[1] - p[1], q[0] - p[0]); return [-Math.sin(a) * 2.2, Math.cos(a) * 2.2]; };
  const o1 = off(hip, knee), o2 = off(knee, tip);
  capsule(ctx, [[hip[0] - o1[0], hip[1] - o1[1]], [knee[0] - o2[0], knee[1] - o2[1]], [tip[0] - o2[0] * 0.6, tip[1] - o2[1] * 0.6]], 3.2, 2.2, rgb(lightC, back ? 0.25 : 0.45));
  // knuckle crease at middle joint
  ctx.strokeStyle = rgb(tint(SKIN.crease, L), 0.7);
  ctx.lineWidth = 1.1;
  const a = Math.atan2(tip[1] - knee[1], tip[0] - knee[0]);
  for (const s of [-2, 1.5]) {
    const cx = knee[0] + Math.cos(a) * s, cy = knee[1] + Math.sin(a) * s;
    ctx.beginPath();
    ctx.moveTo(cx - Math.sin(a) * 3.5, cy + Math.cos(a) * 3.5);
    ctx.lineTo(cx + Math.sin(a) * 2.5, cy - Math.cos(a) * 2.5);
    ctx.stroke();
  }
  // fingernail near the tip (we see the back of the fingers)
  const nx = tip[0] - Math.cos(a) * 5, ny = tip[1] - Math.sin(a) * 5;
  ctx.save();
  ctx.translate(nx, ny);
  ctx.rotate(a);
  ctx.fillStyle = rgb(tint(SKIN.nailEdge, L));
  ctx.beginPath(); ctx.ellipse(0, 0, 5.2, (w1 / 2) * 0.72, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = rgb(tint(SKIN.nail, L));
  ctx.beginPath(); ctx.ellipse(-0.6, -0.4, 4.2, (w1 / 2) * 0.55, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath(); ctx.ellipse(-1.5, -1.2, 1.8, 0.9, 0, 0, TAU); ctx.fill();
  ctx.restore();
  // rim light on the leading edge
  if (rimCol) {
    ctx.strokeStyle = rimCol;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(hip[0] + 4, hip[1]);
    ctx.lineTo(knee[0] + 4.5, knee[1]);
    ctx.lineTo(tip[0] + 3.5, tip[1] - 1);
    ctx.stroke();
  }
}

// The back of the hand (a left hand, fingers down): thumb on the wrist side, ring + pinky curled
// under at the front and held by the thumb. Origin = knuckle line centre.
function drawPalm(ctx, L, curl, rimCol) {
  const base = tint(SKIN.base, L);
  const shade = tint(SKIN.shade, L);
  const light = tint(SKIN.light, L);
  const crease = tint(SKIN.crease, L);
  // curled ring + pinky, tucked at the front-bottom
  for (const [x, y, rx, ry] of [[15, -3, 8, 7.5], [20, -11, 6.5, 6.5]]) {
    const g = ctx.createRadialGradient(x - 2, y - 2, 1, x, y, rx + 1);
    g.addColorStop(0, rgb(mixRgb(base, light, 0.3)));
    g.addColorStop(1, rgb(shade));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0.5, 0, TAU); ctx.fill();
    ctx.strokeStyle = rgb(crease, 0.6);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, rx * 0.6, 0.6, 2.2); ctx.stroke();
  }
  // back of hand: narrower at the wrist, wide across the knuckles
  const g = ctx.createLinearGradient(-24, -38, 18, 2);
  g.addColorStop(0, rgb(mixRgb(shade, base, 0.35)));
  g.addColorStop(0.5, rgb(base));
  g.addColorStop(1, rgb(mixRgb(base, light, 0.4)));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-20, -36);
  ctx.bezierCurveTo(-10, -42, 8, -40, 14, -32);
  ctx.bezierCurveTo(20, -24, 21, -12, 16, -4);
  ctx.bezierCurveTo(11, 3, -8, 5, -15, 0);
  ctx.bezierCurveTo(-23, -6, -27, -26, -20, -36);
  ctx.fill();
  // cylindrical shading across the back of the hand
  const cg = ctx.createLinearGradient(0, -40, 0, 4);
  cg.addColorStop(0, rgb(light, 0.28));
  cg.addColorStop(0.45, rgb(light, 0));
  cg.addColorStop(1, rgb(shade, 0.35));
  ctx.fillStyle = cg;
  ctx.fill();
  // tendons fanning to the two running fingers
  ctx.strokeStyle = rgb(shade, 0.32);
  ctx.lineWidth = 1.3;
  for (const [x0, x1] of [[-12, -5], [-6, 5], [0, 12]]) { ctx.beginPath(); ctx.moveTo(x0 - 4, -33); ctx.quadraticCurveTo(x0 + 1, -20, x1, -6); ctx.stroke(); }
  // knuckle highlights at the leg roots
  for (const [kx, ky] of [[-5, -4], [5, -4]]) {
    const kg = ctx.createRadialGradient(kx - 1, ky - 2, 0, kx, ky, 7.5);
    kg.addColorStop(0, rgb(light, 0.9));
    kg.addColorStop(1, rgb(light, 0));
    ctx.fillStyle = kg;
    ctx.beginPath(); ctx.arc(kx, ky, 7.5, 0, TAU); ctx.fill();
  }
  // thumb along the wrist side, wrapping under toward the curled fingers
  const tg = ctx.createLinearGradient(-30, -26, -6, 8);
  tg.addColorStop(0, rgb(shade));
  tg.addColorStop(1, rgb(base));
  ctx.fillStyle = tg;
  ctx.beginPath();
  ctx.moveTo(-22, -30);
  ctx.bezierCurveTo(-31, -18, -28, -2, -18, 4 + curl * 2);
  ctx.bezierCurveTo(-12, 7, -6, 6, -7, 1);
  ctx.bezierCurveTo(-9, -3, -15, -6, -16, -16);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = rgb(crease, 0.55);
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-16, -16); ctx.bezierCurveTo(-15, -8, -11, -3, -8, 0); ctx.stroke();
  ctx.fillStyle = rgb(tint(SKIN.nail, L), 0.95);
  ctx.beginPath(); ctx.ellipse(-12, 2.5, 3.8, 2.6, 0.25, 0, TAU); ctx.fill();
  if (rimCol) {
    ctx.strokeStyle = rimCol;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-14, -39);
    ctx.bezierCurveTo(-2, -42, 10, -38, 14, -32);
    ctx.bezierCurveTo(19, -25, 21, -15, 18, -8);
    ctx.stroke();
  }
}

function armPath(wx, wy) {
  const sx = SHOULDER.x, sy = SHOULDER.y;
  const dx = wx - sx, dy = wy - sy;
  const d = Math.hypot(dx, dy);
  const nx = dy / d, ny = -dx / d; // perpendicular pointing down-right (elbow side)
  const bend = clamp(ARM_MAX - d, 0, 500) * 0.5 + 30;
  const c1 = [sx + dx * 0.35 - nx * bend, sy + dy * 0.35 - ny * bend];
  const c2 = [sx + dx * 0.72 - nx * bend * 0.7, sy + dy * 0.72 - ny * bend * 0.7];
  const pts = [];
  for (let i = 0; i <= 26; i++) {
    const u = i / 26, v = 1 - u;
    pts.push([
      v * v * v * sx + 3 * v * v * u * c1[0] + 3 * v * u * u * c2[0] + u * u * u * wx,
      v * v * v * sy + 3 * v * v * u * c1[1] + 3 * v * u * u * c2[1] + u * u * u * wy,
    ]);
  }
  return pts;
}

function drawArm(ctx, wx, wy, L, rimCol) {
  const pts = armPath(wx, wy);
  const n = pts.length;
  const widthAt = (u) => lerp(84, 25, Math.pow(u, 0.7));
  const left = [], right = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const w = widthAt(i / (n - 1)) / 2;
    left.push([pts[i][0] - Math.sin(ang) * w, pts[i][1] + Math.cos(ang) * w]);
    right.push([pts[i][0] + Math.sin(ang) * w, pts[i][1] - Math.cos(ang) * w]);
  }
  const poly = (from, to) => {
    ctx.beginPath();
    ctx.moveTo(left[from][0], left[from][1]);
    for (let i = from; i <= to; i++) ctx.lineTo(left[i][0], left[i][1]);
    for (let i = to; i >= from; i--) ctx.lineTo(right[i][0], right[i][1]);
    ctx.closePath();
  };
  // forearm skin, shaded like a cylinder across its width
  const mid = Math.floor(n * 0.7);
  const a0 = pts[mid - 1], a1 = pts[mid + 1];
  const ang = Math.atan2(a1[1] - a0[1], a1[0] - a0[0]);
  const hw = widthAt(0.7) / 2;
  const nx = -Math.sin(ang), ny = Math.cos(ang);
  const g = ctx.createLinearGradient(pts[mid][0] + nx * hw, pts[mid][1] + ny * hw, pts[mid][0] - nx * hw, pts[mid][1] - ny * hw);
  g.addColorStop(0, rgb(tint(SKIN.crease, L)));
  g.addColorStop(0.35, rgb(tint(SKIN.shade, L)));
  g.addColorStop(0.72, rgb(tint(SKIN.base, L)));
  g.addColorStop(0.9, rgb(tint(mixRgb(SKIN.base, SKIN.light, 0.45), L)));
  g.addColorStop(1, rgb(tint(SKIN.base, L)));
  ctx.fillStyle = g;
  poly(0, n - 1);
  ctx.fill();
  ctx.beginPath(); ctx.arc(wx, wy, widthAt(1) / 2, 0, TAU); ctx.fill();
  // rim light along the top edge of the forearm
  if (rimCol) {
    ctx.strokeStyle = rimCol;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = Math.floor(n * 0.45); i < n; i++) i === Math.floor(n * 0.45) ? ctx.moveTo(right[i][0], right[i][1]) : ctx.lineTo(right[i][0], right[i][1]);
    ctx.stroke();
  }
  // t-shirt sleeve near the shoulder, striped
  const sEnd = Math.floor(n * 0.36);
  ctx.fillStyle = rgb(tint(SLEEVE.base, L));
  poly(0, sEnd);
  ctx.fill();
  ctx.save();
  poly(0, sEnd);
  ctx.clip();
  ctx.strokeStyle = rgb(tint(SLEEVE.stripe, L), 0.8);
  ctx.lineWidth = 7;
  for (let i = 2; i < sEnd; i += 3) {
    ctx.beginPath(); ctx.moveTo(left[i][0], left[i][1]); ctx.lineTo(right[i][0], right[i][1]); ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = rgb(tint(SLEEVE.cuff, L));
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(left[sEnd][0], left[sEnd][1]); ctx.lineTo(right[sEnd][0], right[sEnd][1]); ctx.stroke();
}

export class ProceduralHandRenderer {
  draw(ctx, hs, t) {
    const L = hs.light;
    const p = pose(hs, t);
    const rimCol = L.rimA > 0.02 ? rgb(L.rim, L.rimA * 0.75) : null;
    const sq = hs.squash || 0;
    const sx = 1 + sq * 0.55, sy = 1 - sq * 0.55;
    const fx = hs.x + p.bodyDX, fy = hs.y + p.bodyDY;

    if (p.slide) return this.drawSlide(ctx, hs, t, L, rimCol, fx, fy);

    const kx = fx, ky = fy + p.knuckleY * sy;
    // wrist sits at the back-top of the hand
    const cr = Math.cos(p.rot), sr = Math.sin(p.rot);
    const toWorld = (x, y) => [kx + (x * cr - y * sr) * sx, ky + (x * sr + y * cr) * sy];
    const wrist = toWorld(-22, -26);
    drawArm(ctx, wrist[0], wrist[1], L, rimCol);

    // legs: back (middle) finger first
    const legs = p.legs.map((leg, i) => {
      const hip = toWorld(leg.dx, -3);
      const foot = leg.foot ?? [0, 40];
      const f = [fx + foot[0] * sx + leg.dx * 0.3, ky + foot[1] * sy];
      const r = ik(hip[0], hip[1], f[0], f[1], UPPER * sy, LOWER * sy, -1);
      return { hip, knee: [r.kx, r.ky], tip: [r.fx, r.fy], back: i === 1 };
    });
    drawFinger(ctx, legs[1].hip, legs[1].knee, legs[1].tip, L, true, null);

    ctx.save();
    ctx.translate(kx, ky);
    ctx.rotate(p.rot);
    ctx.scale(sx, sy);
    drawPalm(ctx, L, p.curl, rimCol);
    ctx.restore();

    drawFinger(ctx, legs[0].hip, legs[0].knee, legs[0].tip, L, false, rimCol);
  }

  drawSlide(ctx, hs, t, L, rimCol, fx, fy) {
    // fingers lie flat and skim forward; hand low and tilted back
    const kx = fx - 26, ky = fy - 14;
    const wrist = [kx - 26, ky - 10];
    drawArm(ctx, wrist[0], wrist[1], L, rimCol);
    const skim = Math.sin(t * 40) * 0.8;
    drawFinger(ctx, [kx + 2, ky + 2], [kx + 22, ky + 6 + skim], [kx + 42, ky + 9], L, true, null);
    ctx.save();
    ctx.translate(kx, ky);
    ctx.rotate(-1.15);
    ctx.scale(0.8, 0.8);
    drawPalm(ctx, L, 0.4, rimCol);
    ctx.restore();
    drawFinger(ctx, [kx + 4, ky + 6], [kx + 25, ky + 9 - skim], [kx + 46, ky + 12], L, false, rimCol);
  }
}

// Sprite-sheet renderer stub. Reads assets/hand/manifest.json -> sheet JSON -> PNG. Until both have loaded it
// defers to the procedural renderer, so dropping art in later needs no gameplay changes.
export class SpriteHandRenderer {
  constructor(base = 'assets/hand/') {
    this.base = base;
    this.ready = false;
    this.fallback = new ProceduralHandRenderer();
  }
  async load() {
    try {
      // manifest.json always exists (so there's never a 404); it names the sheet when one is added
      const man = await fetch(this.base + 'manifest.json', { cache: 'no-cache' });
      if (!man.ok) return false;
      const { sheet } = await man.json();
      if (!sheet) return false;
      const res = await fetch(this.base + sheet, { cache: 'no-cache' });
      if (!res.ok) return false;
      this.meta = await res.json();
      this.img = new Image();
      this.img.src = this.base + (this.meta.image ?? 'hand.png');
      await this.img.decode();
      this.ready = true;
      return true;
    } catch { return false; }
  }
  draw(ctx, hs, t) {
    if (!this.ready) return this.fallback.draw(ctx, hs, t);
    const anim = this.meta.animations[hs.state] ?? this.meta.animations.run;
    const frames = anim.frames;
    const idx = hs.state === 'run'
      ? Math.floor(hs.phase * frames.length) % frames.length
      : Math.floor((hs.stateT ?? 0) * (anim.fps ?? 12)) % frames.length;
    const [fx, fy, fw, fh] = frames[idx];
    const [ax, ay] = this.meta.anchor ?? [fw / 2, fh];
    drawArm(ctx, hs.x - 20, hs.y - 62, hs.light, null);
    ctx.drawImage(this.img, fx, fy, fw, fh, hs.x - ax, hs.y - ay, fw, fh);
  }
}

let current = new ProceduralHandRenderer();

// Try the sprite sheet; silently keep the procedural hand if it isn't there.
export async function initHandRenderer() {
  const sprite = new SpriteHandRenderer();
  if (await sprite.load()) current = sprite;
  return current;
}

export function drawHand(ctx, state, t) {
  current.draw(ctx, state, t);
}

export { FRAME };
