// Sky gradient, sun/moon, stars, clouds, and the time-of-day palette every other renderer reads.
import { VIEW, FRAME, TIME_OF_DAY } from '../config.js';
import { mixRgb, rgb, hexToRgb, smoothstep, clamp, RNG, TAU, lerp } from '../util.js';

// Keyframes around the cycle: golden hour -> dusk -> night -> dawn -> golden hour.
// Every colour here is art-directable.
const KEYS = [
  {
    at: 0.0, name: 'golden',
    skyTop: '#44628f', skyMid: '#d99a6c', horizon: '#ffd49a',
    sun: '#fff2c8', sunGlow: '#ffc27a', sunX: 0.78, sunY: 0.56, sunR: 34, moon: 0,
    ambient: 1.0, fog: '#f0c49a', rim: '#ffc57a', rimA: 0.95, night: 0, cloud: '#fbe0bf', cloudShade: '#b98a86',
    lane: '#2a2320', windowLit: 0.05,
  },
  {
    at: 0.2, name: 'late golden',
    skyTop: '#394f80', skyMid: '#c8806a', horizon: '#ffb57a',
    sun: '#ffe0a8', sunGlow: '#ff9d5c', sunX: 0.72, sunY: 0.74, sunR: 38, moon: 0,
    ambient: 0.9, fog: '#e7a784', rim: '#ffac68', rimA: 0.95, night: 0.05, cloud: '#ffc79d', cloudShade: '#a77082',
    lane: '#271f1e', windowLit: 0.12,
  },
  {
    at: 0.32, name: 'dusk',
    skyTop: '#1f2448', skyMid: '#6e4a78', horizon: '#ee8a5e',
    sun: '#ff9a62', sunGlow: '#ff6e4a', sunX: 0.66, sunY: 0.95, sunR: 40, moon: 0.2,
    ambient: 0.66, fog: '#a8687a', rim: '#ff9670', rimA: 0.75, night: 0.35, cloud: '#c07888', cloudShade: '#4a3558',
    lane: '#1b1719', windowLit: 0.45,
  },
  {
    at: 0.5, name: 'night',
    skyTop: '#060a18', skyMid: '#111a36', horizon: '#26335a',
    sun: '#ff8050', sunGlow: '#000000', sunX: 0.6, sunY: 1.3, sunR: 30, moon: 1,
    ambient: 0.42, fog: '#27314f', rim: '#9db4e6', rimA: 0.55, night: 1, cloud: '#2b3556', cloudShade: '#101628',
    lane: '#0d0f16', windowLit: 0.7,
  },
  {
    at: 0.66, name: 'late night',
    skyTop: '#070b1c', skyMid: '#18203f', horizon: '#3a3f66',
    sun: '#ff8050', sunGlow: '#000000', sunX: 0.3, sunY: 1.3, sunR: 30, moon: 0.85,
    ambient: 0.45, fog: '#2e3656', rim: '#a8b8e8', rimA: 0.55, night: 0.95, cloud: '#303a5e', cloudShade: '#121830',
    lane: '#0e1018', windowLit: 0.55,
  },
  {
    at: 0.8, name: 'dawn',
    skyTop: '#2c3d6e', skyMid: '#a08bb8', horizon: '#ffbf9e',
    sun: '#ffe2bd', sunGlow: '#ffb48a', sunX: 0.22, sunY: 0.82, sunR: 34, moon: 0.1,
    ambient: 0.8, fog: '#d6aeb2', rim: '#ffd0a6', rimA: 0.85, night: 0.2, cloud: '#f6c9c0', cloudShade: '#8c7aa0',
    lane: '#211d22', windowLit: 0.2,
  },
  {
    at: 1.0, name: 'golden',
    skyTop: '#44628f', skyMid: '#d99a6c', horizon: '#ffd49a',
    sun: '#fff2c8', sunGlow: '#ffc27a', sunX: 0.78, sunY: 0.56, sunR: 34, moon: 0,
    ambient: 1.0, fog: '#f0c49a', rim: '#ffc57a', rimA: 0.95, night: 0, cloud: '#fbe0bf', cloudShade: '#b98a86',
    lane: '#2a2320', windowLit: 0.05,
  },
];

const COLOR_KEYS = ['skyTop', 'skyMid', 'horizon', 'sun', 'sunGlow', 'fog', 'rim', 'cloud', 'cloudShade', 'lane'];
const NUM_KEYS = ['sunX', 'sunY', 'sunR', 'moon', 'ambient', 'rimA', 'night', 'windowLit'];

export function paletteAt(phase) {
  phase = ((phase % 1) + 1) % 1;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].at <= phase) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = smoothstep(0, 1, (phase - a.at) / (b.at - a.at));
  const P = { phase, name: t < 0.5 ? a.name : b.name };
  for (const k of COLOR_KEYS) P[k] = mixRgb(a[k], b[k], t);
  for (const k of NUM_KEYS) P[k] = lerp(a[k], b[k], t);
  return P;
}

// Mix a silhouette colour toward the fog colour (atmospheric perspective) and scale by ambient.
export function atmos(P, base, fog) {
  const c = hexToRgb(base);
  const lit = [c[0] * P.ambient, c[1] * P.ambient, c[2] * P.ambient];
  return mixRgb(lit, P.fog, fog);
}

export class Sky {
  constructor(seed = 7) {
    const r = new RNG(seed);
    this.stars = [];
    for (let i = 0; i < 170; i++) {
      this.stars.push({ x: r.float(0, VIEW.W), y: r.float(FRAME.top, 430) ** 1 * 1, s: r.float(0.5, 1.7), tw: r.float(0.5, 3), ph: r.float(0, TAU) });
    }
    this.clouds = [];
    for (let i = 0; i < 7; i++) {
      const puffs = [];
      const n = r.int(5, 9);
      for (let j = 0; j < n; j++) puffs.push({ dx: r.float(-90, 90), dy: r.float(-14, 10), rx: r.float(30, 70), ry: r.float(14, 26) });
      this.clouds.push({ x: r.float(0, VIEW.W * 1.6), y: r.float(90, 290), puffs, speed: r.float(4, 10), scale: r.float(0.7, 1.4) });
    }
    this.scroll = 0;
  }

  update(dt, worldSpeed) {
    this.scroll += dt * (6 + worldSpeed * 0.012);
  }

  draw(ctx, P, t) {
    const top = FRAME.top - 10, bottom = FRAME.sill + 20;
    const g = ctx.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0, rgb(P.skyTop));
    g.addColorStop(0.52, rgb(P.skyMid));
    g.addColorStop(0.9, rgb(P.horizon));
    g.addColorStop(1, rgb(P.horizon));
    ctx.fillStyle = g;
    ctx.fillRect(0, top, VIEW.W, bottom - top);

    // stars
    const starA = clamp((P.night - 0.3) / 0.7, 0, 1);
    if (starA > 0) {
      for (const s of this.stars) {
        const a = starA * (0.55 + 0.45 * Math.sin(t * s.tw + s.ph));
        ctx.fillStyle = `rgba(235,240,255,${a.toFixed(3)})`;
        ctx.fillRect(s.x, s.y, s.s, s.s);
      }
    }

    // sun glow + disc
    const sx = P.sunX * VIEW.W, sy = FRAME.top + P.sunY * (FRAME.sill - FRAME.top);
    if (sy < FRAME.sill + 120) {
      const glowR = 260;
      const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowR);
      sg.addColorStop(0, rgb(P.sunGlow, 0.55));
      sg.addColorStop(0.35, rgb(P.sunGlow, 0.18));
      sg.addColorStop(1, rgb(P.sunGlow, 0));
      ctx.fillStyle = sg;
      ctx.fillRect(sx - glowR, sy - glowR, glowR * 2, glowR * 2);
      ctx.fillStyle = rgb(P.sun, 0.95);
      ctx.beginPath();
      ctx.arc(sx, sy, P.sunR, 0, TAU);
      ctx.fill();
    }

    // moon
    if (P.moon > 0.01) {
      const mx = VIEW.W * 0.24, my = 150;
      const mg = ctx.createRadialGradient(mx, my, 0, mx, my, 120);
      mg.addColorStop(0, `rgba(200,215,255,${(0.22 * P.moon).toFixed(3)})`);
      mg.addColorStop(1, 'rgba(200,215,255,0)');
      ctx.fillStyle = mg;
      ctx.fillRect(mx - 120, my - 120, 240, 240);
      ctx.fillStyle = `rgba(238,240,250,${(0.95 * P.moon).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(mx, my, 20, 0, TAU);
      ctx.fill();
      // crescent shadow
      ctx.fillStyle = rgb(mixRgb(P.skyTop, P.skyMid, 0.3), P.moon * 0.9);
      ctx.beginPath();
      ctx.arc(mx + 8, my - 5, 17, 0, TAU);
      ctx.fill();
    }

    // clouds (soft, lit from the horizon side)
    const span = VIEW.W * 1.8;
    for (const c of this.clouds) {
      let x = (c.x - this.scroll * c.speed * 0.15) % span;
      if (x < -300) x += span;
      x -= 150;
      for (const p of c.puffs) {
        const px = x + p.dx * c.scale, py = c.y + p.dy * c.scale;
        const rx = p.rx * c.scale, ry = p.ry * c.scale;
        const cg = ctx.createLinearGradient(0, py - ry, 0, py + ry);
        cg.addColorStop(0, rgb(P.cloud, 0.34));
        cg.addColorStop(1, rgb(P.cloudShade, 0.26));
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.ellipse(px, py, rx, ry, 0, 0, TAU);
        ctx.fill();
      }
    }
  }
}

export function todPhase(runTime, attract) {
  return (attract ? TIME_OF_DAY.attractPhase : TIME_OF_DAY.startPhase) + runTime / TIME_OF_DAY.cycleSec;
}
