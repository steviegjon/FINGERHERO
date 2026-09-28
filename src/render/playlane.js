// Play-lane renderer: the one solid depth band. Darkest, crispest silhouettes with a warm rim
// light on every standable top edge, so what you can stand on reads at a glance.
import { GEN, VIEW, FRAME, PLAYER } from '../config.js';
import { VEHICLES, ROAD_Y } from '../world/vehicles.js';
import { BIOMES } from '../world/biomes.js';
import { rgb, mixRgb, hexToRgb, hash1, clamp, TAU } from '../util.js';

const BY_NAME = Object.fromEntries(Object.values(BIOMES).map((b) => [b.name, b]));
const SIGN_FONT = "'Oswald', 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif";
const PAINTS = ['#7d2f2a', '#2f4f6f', '#8a7a52', '#3f5a45', '#5c4a6b', '#9a9690', '#2c2c30', '#b0673a'];

function laneColors(P, biomeName) {
  const tint = hexToRgb(BY_NAME[biomeName]?.tint ?? '#555555');
  const body = mixRgb(P.lane, mixRgb(tint, [0, 0, 0], 1 - P.ambient * 0.8), 0.22);
  return {
    body,
    detail: mixRgb(body, P.fog, 0.1),
    deep: mixRgb(body, [0, 0, 0], 0.35),
    light: mixRgb(body, P.fog, 0.22),
  };
}

export function rimStroke(ctx, pts, P, x0 = 0, width = 2.2) {
  if (P.rimA < 0.02) return;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgb(P.rim, 0.16 * P.rimA);
  ctx.lineWidth = width + 4;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x0 + x, y) : ctx.moveTo(x0 + x, y)));
  ctx.stroke();
  ctx.strokeStyle = rgb(P.rim, 0.9 * P.rimA);
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.restore();
}

function poly(ctx, L, pts, bottom) {
  ctx.beginPath();
  ctx.moveTo(L + pts[0][0], bottom);
  for (const [x, y] of pts) ctx.lineTo(L + x, y);
  ctx.lineTo(L + pts[pts.length - 1][0], bottom);
  ctx.closePath();
}

const visible = (L, w, pad = 60) => L < VIEW.W + pad && L + w > -pad;

// ---------------------------------------------------------------------------
// Sections drawn behind the lane: tunnel interior, bridge water.
export function drawSections(ctx, world, D, t, P) {
  for (const d of world.decor) {
    const L = d.left(D);
    if (!visible(L, d.w, 300)) continue;
    if (d.kind === 'bridgeSection') drawBridgeSection(ctx, d, L, t, P);
  }
  for (const d of world.decor) {
    const L = d.left(D);
    if (d.kind === 'tunnel' && visible(L, d.w, 200)) drawTunnelInterior(ctx, d, L, t, P);
  }
}

function drawBridgeSection(ctx, d, L, t, P) {
  const top = 548, bottom = FRAME.sill + 30;
  const fade = 120;
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, rgb(mixRgb(P.horizon, P.skyMid, 0.35), 0.95));
  g.addColorStop(1, rgb(mixRgb(P.skyTop, P.lane, 0.5), 0.95));
  ctx.fillStyle = g;
  ctx.fillRect(L + fade * 0.5, top, d.w - fade, bottom - top);
  // shimmer lines
  ctx.strokeStyle = rgb(P.sunGlow, 0.25 + 0.2 * (1 - P.night));
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 26; i++) {
    const y = top + 8 + ((i * 37) % (bottom - top - 10));
    const x = L + fade + ((i * 173 + t * 30) % Math.max(1, d.w - fade * 2));
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 20 + (i % 3) * 14, y); ctx.stroke();
  }
  const col = laneColors(P, d.biome);
  // superstructure behind the railing: a steel arch with hangers, or a truss
  const steel = rgb(mixRgb(col.body, P.fog, 0.22));
  const a0 = L + 90, a1 = L + d.w - 90, deckY = 552;
  ctx.strokeStyle = steel;
  if (d.data.style === 'truss') {
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(a0, 300); ctx.lineTo(a1, 300); ctx.stroke();
    ctx.lineWidth = 4;
    for (let x = a0; x < a1 - 1; x += 120) {
      ctx.beginPath(); ctx.moveTo(x, 300); ctx.lineTo(x, deckY); ctx.moveTo(x, 300); ctx.lineTo(Math.min(a1, x + 120), deckY); ctx.stroke();
    }
    ctx.fillStyle = steel;
    ctx.fillRect(a0 - 10, 290, 20, deckY - 290); ctx.fillRect(a1 - 10, 290, 20, deckY - 290);
  } else {
    const spans = Math.max(1, Math.round((a1 - a0) / 900));
    const sw = (a1 - a0) / spans;
    for (let k = 0; k < spans; k++) {
      const s0 = a0 + k * sw, s1 = s0 + sw, peak = 250;
      ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(s0, deckY); ctx.quadraticCurveTo((s0 + s1) / 2, peak - (deckY - peak) * 0.35, s1, deckY); ctx.stroke();
      ctx.lineWidth = 2;
      for (let x = s0 + 40; x < s1 - 30; x += 40) {
        const u = (x - s0) / sw;
        const cy = (1 - u) * (1 - u) * deckY + 2 * (1 - u) * u * (peak - (deckY - peak) * 0.35) + u * u * deckY;
        ctx.beginPath(); ctx.moveTo(x, cy); ctx.lineTo(x, deckY); ctx.stroke();
      }
    }
  }
  if (P.rimA > 0) { ctx.strokeStyle = rgb(P.rim, 0.12 * P.rimA); ctx.lineWidth = 1; }
  // the bridge's own structure below railing level
  ctx.fillStyle = rgb(mixRgb(col.body, P.fog, 0.45));
  if (d.data.style === 'truss') {
    for (let x = L + 80; x < L + d.w - 80; x += 180) ctx.fillRect(x, 560, 14, 80);
  } else {
    ctx.beginPath();
    for (let x = L + 80; x < L + d.w - 120; x += 220) {
      ctx.moveTo(x, 640); ctx.lineTo(x, 580);
      ctx.quadraticCurveTo(x + 110, 548, x + 220, 580);
      ctx.lineTo(x + 220, 640); ctx.lineTo(x + 196, 640);
      ctx.quadraticCurveTo(x + 110, 584, x + 24, 640);
      ctx.closePath();
    }
    ctx.fill();
  }
}

function drawTunnelInterior(ctx, d, L, t, P) {
  const R = L + d.w;
  const x0 = Math.max(L, -20), x1 = Math.min(R, VIEW.W + 20);
  if (x1 <= x0) return;
  const g = ctx.createLinearGradient(0, 0, 0, VIEW.H);
  g.addColorStop(0, '#0b0907');
  g.addColorStop(0.45, '#17120d');
  g.addColorStop(0.8, '#100c09');
  g.addColorStop(1, '#070605');
  ctx.fillStyle = g;
  ctx.fillRect(x0, 0, x1 - x0, VIEW.H);
  ctx.fillStyle = 'rgba(255,190,120,0.035)';
  for (let y = 250; y < 480; y += 22) ctx.fillRect(x0, y, x1 - x0, 1);
  const every = d.data.lampEvery;
  const first = Math.max(0, Math.floor((x0 - L) / every) - 1);
  for (let n = first; L + n * every < x1; n++) {
    const lx = L + n * every + every / 2;
    if (lx > R - 40) break;
    ctx.fillStyle = '#ffcf85';
    ctx.fillRect(lx - 16, 118, 32, 7);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const lg = ctx.createRadialGradient(lx, 122, 0, lx, 122, 190);
    lg.addColorStop(0, 'rgba(255,150,60,0.42)');
    lg.addColorStop(0.3, 'rgba(255,120,40,0.12)');
    lg.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(lx - 190, 0, 380, 330);
    ctx.restore();
  }
  // portal faces (concrete mouth) at both ends
  for (const [px, dir] of [[L, 1], [R, -1]]) {
    if (px < -80 || px > VIEW.W + 80) continue;
    const face = ctx.createLinearGradient(px, 0, px + dir * 70, 0);
    face.addColorStop(0, '#4a4640');
    face.addColorStop(0.4, '#2c2925');
    face.addColorStop(1, 'rgba(12,10,8,0)');
    ctx.fillStyle = face;
    ctx.fillRect(Math.min(px, px + dir * 70), 0, 70, VIEW.H);
    ctx.fillStyle = rgb(mixRgb('#6a655c', P.fog, 0.2));
    ctx.fillRect(px - (dir > 0 ? 26 : 0), 0, 26, VIEW.H);
    if (P.rimA > 0) { ctx.fillStyle = rgb(P.rim, 0.35 * P.rimA); ctx.fillRect(px + (dir > 0 ? -27 : 25), 0, 2, VIEW.H); }
  }
}

// ---------------------------------------------------------------------------
export function drawPlayLane(ctx, world, D, t, P) {
  // posts & pillars behind everything standable
  for (const h of world.hazards) {
    const L = h.left(D);
    if (!visible(L, h.w, 80)) continue;
    const col = laneColors(P, h.biome);
    if (h.kind === 'sign') {
      ctx.fillStyle = rgb(col.detail);
      if (h.w > 90) { ctx.fillRect(L + 10, h.panelBottom, 6, GEN.groundY - h.panelBottom); ctx.fillRect(L + h.w - 16, h.panelBottom, 6, GEN.groundY - h.panelBottom); }
      else ctx.fillRect(L + h.w / 2 - 3, h.panelBottom, 6, GEN.groundY - h.panelBottom);
    } else if (h.kind === 'overpass') {
      ctx.fillStyle = rgb(mixRgb(col.body, P.fog, 0.18));
      for (const px of [L + 18, L + h.w - 48]) ctx.fillRect(px, h.ceil, 30, GEN.groundY - h.ceil);
    }
  }
  for (const d of world.decor) {
    if (d.kind !== 'pole') continue;
    const L = d.left(D);
    if (!visible(L, d.w)) continue;
    drawPole(ctx, d, L, P);
  }

  for (const s of world.surfaces) {
    if (s.kind === 'vehicle' || s.kind === 'wire') continue;
    const L = s.left(D);
    if (!visible(L, s.w, 20)) continue;
    const col = laneColors(P, s.biome);
    switch (s.kind) {
      case 'roof': drawBuilding(ctx, s, L, P, col, t); break;
      case 'chimney': drawChimney(ctx, s, L, P, col); break;
      case 'tree': drawTree(ctx, s, L, P, col, t); break;
      case 'railing': drawRailing(ctx, s, L, P, col); break;
      case 'barrier': drawBarrier(ctx, s, L, P, col); break;
      case 'ledge': drawLedge(ctx, s, L); break;
      case 'pipe': drawPipe(ctx, s, L); break;
      case 'polecap': drawCrossarm(ctx, s, L, P, col); break;
      default: ctx.fillStyle = rgb(col.body); poly(ctx, L, s.profile, GEN.groundY); ctx.fill(); rimStroke(ctx, s.profile, P, L); break;
    }
  }
  for (const s of world.surfaces) {
    if (s.kind !== 'wire') continue;
    const L = s.left(D);
    if (!visible(L, s.w, 10)) continue;
    drawWire(ctx, s, L, P, laneColors(P, s.biome));
  }
  // vehicles: draw each vehicle once (all parts), slowest last (nearest lane)
  const seen = new Set();
  const vehicles = [];
  for (const s of world.surfaces) {
    if (s.kind !== 'vehicle') continue;
    const v = s.data.vehicle;
    if (seen.has(v)) continue;
    seen.add(v);
    vehicles.push(v);
  }
  vehicles.sort((a, b) => b.k - a.k);
  for (const v of vehicles) drawVehicle(ctx, v, D, P, t);
}

function drawPole(ctx, d, L, P) {
  const col = laneColors(P, d.biome);
  const top = d.data.top;
  const g = ctx.createLinearGradient(L, 0, L + d.w, 0);
  g.addColorStop(0, rgb(mixRgb(col.body, '#3a2a1c', 0.25)));
  g.addColorStop(1, rgb(mixRgb(col.deep, '#2a1c12', 0.2)));
  ctx.fillStyle = g;
  ctx.fillRect(L, top + 4, d.w, GEN.groundY - top);
  if (P.rimA > 0) { ctx.fillStyle = rgb(P.rim, 0.35 * P.rimA); ctx.fillRect(L + d.w - 2, top + 6, 2, GEN.groundY - top); }
  ctx.fillStyle = rgb(col.detail);
  for (let y = top + 40; y < FRAME.sill; y += 34) ctx.fillRect(L + (y % 68 ? -3 : d.w), y, 3, 2);
}

function drawCrossarm(ctx, s, L, P, col) {
  ctx.fillStyle = rgb(mixRgb(col.body, '#3a2a1c', 0.2));
  ctx.fillRect(L - 2, s.top, s.w + 4, 6);
  ctx.fillStyle = rgb(mixRgb(col.detail, '#8aa0a8', 0.25));
  ctx.fillRect(L + 1, s.top - 5, 4, 5);
  ctx.fillRect(L + s.w - 5, s.top - 5, 4, 5);
  rimStroke(ctx, [[-2, s.top], [s.w + 2, s.top]], P, L, 1.8);
}

function drawWire(ctx, s, L, P, col) {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = rgb(col.deep, 0.75);
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  s.profile.forEach(([x, y], i) => (i ? ctx.lineTo(L + x, y + 18 + Math.sin((x / s.w) * Math.PI) * 4) : ctx.moveTo(L + x, y + 18)));
  ctx.stroke();
  ctx.strokeStyle = rgb(col.deep);
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  s.profile.forEach(([x, y], i) => (i ? ctx.lineTo(L + x, y + 1) : ctx.moveTo(L + x, y + 1)));
  ctx.stroke();
  ctx.restore();
  rimStroke(ctx, s.profile, P, L, 1.3);
}

function drawBuilding(ctx, s, L, P, col, t) {
  const d = s.data;
  const barn = d.style === 'barn';
  const body = barn ? mixRgb(col.body, '#5a1f18', 0.35 * P.ambient) : col.body;
  ctx.fillStyle = rgb(body);
  poly(ctx, L, s.profile, GEN.groundY);
  ctx.fill();
  const top = s.top;
  const seed = d.seed;
  const floorH = d.city ? 30 : 34;
  const cols = Math.max(1, Math.floor((s.w - 20) / (d.city ? 26 : 38)));
  const cw = (s.w - 20) / cols;
  const litP = P.windowLit * (d.city ? 1 : 0.8);
  if (!barn) {
    for (let fy = top + 18; fy < FRAME.sill; fy += floorH) {
      for (let c = 0; c < cols; c++) {
        const wx = L + 10 + c * cw + cw * 0.22, ww = cw * 0.56, wh = floorH * 0.5;
        const h = hash1(seed * 0.001 + c * 3.1 + fy * 0.37);
        if (h < litP) {
          ctx.fillStyle = hash1(h * 91) > 0.25 ? 'rgba(255,200,118,0.92)' : 'rgba(180,210,255,0.8)';
          ctx.fillRect(wx, fy, ww, wh);
          ctx.fillStyle = 'rgba(255,190,110,0.08)';
          ctx.fillRect(wx - 3, fy - 3, ww + 6, wh + 6);
        } else {
          ctx.fillStyle = rgb(mixRgb(body, P.skyMid, 0.12 + 0.05 * h));
          ctx.fillRect(wx, fy, ww, wh);
        }
      }
    }
  } else {
    ctx.strokeStyle = rgb(mixRgb(body, P.fog, 0.2));
    ctx.lineWidth = 2;
    for (let x = 16; x < s.w - 60; x += 70) {
      ctx.strokeRect(L + x, top + 22, 44, 60);
      ctx.beginPath(); ctx.moveTo(L + x, top + 22); ctx.lineTo(L + x + 44, top + 82); ctx.moveTo(L + x + 44, top + 22); ctx.lineTo(L + x, top + 82); ctx.stroke();
    }
  }
  ctx.fillStyle = rgb(col.light);
  if (d.style === 'parapet') ctx.fillRect(L - 2, top - 1, s.w + 4, 5);
  const side = ctx.createLinearGradient(L, 0, L + 26, 0);
  side.addColorStop(0, 'rgba(0,0,0,0.3)');
  side.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = side;
  ctx.fillRect(L, top, 26, GEN.groundY - top);
  if (d.tall && hash1(seed) > 0.5) {
    ctx.fillStyle = rgb(col.detail);
    const ax = L + s.w * (0.25 + 0.5 * hash1(seed + 1));
    ctx.fillRect(ax, top - 38, 2, 38);
    if (P.night > 0.3 && Math.sin(t * 3 + seed) > 0.3) { ctx.fillStyle = 'rgba(255,70,60,0.9)'; ctx.fillRect(ax - 1, top - 41, 4, 4); }
  }
  rimStroke(ctx, s.profile, P, L);
}

function drawChimney(ctx, s, L, P, col) {
  const base = s.parent.top;
  ctx.fillStyle = rgb(mixRgb(col.body, '#4a2418', 0.3));
  ctx.fillRect(L, s.top, s.w, base - s.top + 2);
  ctx.fillStyle = rgb(col.light);
  ctx.fillRect(L - 3, s.top, s.w + 6, 5);
  ctx.strokeStyle = rgb(mixRgb(col.body, P.fog, 0.15), 0.6);
  ctx.lineWidth = 1;
  for (let y = s.top + 10; y < base; y += 7) { ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + s.w, y); ctx.stroke(); }
  rimStroke(ctx, [[-3, s.top], [s.w + 3, s.top]], P, L);
}

function drawTree(ctx, s, L, P, col, t) {
  const d = s.data;
  const w = s.w, top = s.top;
  const since = t - (d.bounceT ?? -10);
  const wob = since < 0.6 ? Math.sin(since * 26) * Math.exp(-since * 6) : 0;
  const cx = L + w / 2;
  ctx.fillStyle = rgb(mixRgb(col.deep, '#2a1a10', 0.3));
  ctx.beginPath();
  ctx.moveTo(cx - 9, GEN.groundY); ctx.lineTo(cx - 6, top + 40); ctx.lineTo(cx + 6, top + 40); ctx.lineTo(cx + 10, GEN.groundY);
  ctx.fill();
  const leaf = mixRgb(col.body, '#2f4a24', 0.45 * P.ambient);
  ctx.save();
  ctx.translate(cx, top + d.dome);
  ctx.scale(1 + wob * 0.06, 1 - wob * 0.1);
  ctx.translate(-cx, -(top + d.dome));
  ctx.fillStyle = rgb(leaf);
  const clumps = 7;
  for (let i = 0; i < clumps; i++) {
    const u = (i + 0.5) / clumps;
    const x = L + u * w;
    const yTop = s.topAtLocal(u * w);
    const r = w * 0.2 + hash1(d.seed + i) * w * 0.07;
    ctx.beginPath(); ctx.arc(x, yTop + r * 0.95, r, 0, TAU); ctx.fill();
  }
  ctx.beginPath(); ctx.ellipse(cx, top + d.dome + 34, w * 0.52, 44, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = rgb(mixRgb(leaf, P.fog, 0.12), 0.6);
  for (let i = 0; i < 16; i++) {
    const a = hash1(d.seed + i * 3.3), b = hash1(d.seed + i * 7.7);
    ctx.beginPath(); ctx.arc(L + 10 + a * (w - 20), top + d.dome + 8 + b * 50, 3 + b * 4, 0, TAU); ctx.fill();
  }
  ctx.restore();
  rimStroke(ctx, s.profile, P, L, 2.4);
}

function drawRailing(ctx, s, L, P, col) {
  const top = s.top;
  ctx.fillStyle = rgb(col.deep);
  ctx.fillRect(L, top + 34, s.w, 26);
  ctx.fillStyle = rgb(col.body);
  ctx.fillRect(L, top, s.w, 6);
  ctx.fillRect(L, top + 18, s.w, 3);
  for (let x = 4; x < s.w; x += 36) ctx.fillRect(L + x, top, 5, 36);
  ctx.fillStyle = rgb(col.light);
  ctx.fillRect(L, top + 32, s.w, 3);
  rimStroke(ctx, s.profile, P, L);
}

function drawBarrier(ctx, s, L, P, col) {
  const top = s.top;
  const conc = mixRgb(col.body, '#6d6a64', 0.25 * P.ambient);
  ctx.fillStyle = rgb(conc);
  ctx.beginPath();
  ctx.moveTo(L, GEN.groundY); ctx.lineTo(L, top + 30); ctx.lineTo(L + 2, top); ctx.lineTo(L + s.w - 2, top); ctx.lineTo(L + s.w, top + 30); ctx.lineTo(L + s.w, GEN.groundY);
  ctx.fill();
  ctx.fillStyle = rgb(mixRgb(conc, '#000', 0.25));
  ctx.fillRect(L, top + 30, s.w, 4);
  ctx.fillStyle = rgb(mixRgb(conc, P.fog, 0.12));
  for (let x = 0; x < s.w; x += 120) ctx.fillRect(L + x, top + 2, 2, 60);
  if (P.night > 0.2) { ctx.fillStyle = `rgba(255,190,90,${(0.6 * P.night).toFixed(3)})`; for (let x = 40; x < s.w; x += 120) ctx.fillRect(L + x, top + 12, 5, 3); }
  rimStroke(ctx, s.profile, P, L);
}

const TUNNEL_RIM = { rim: [255, 170, 90], rimA: 0.8 };
function drawLedge(ctx, s, L) {
  ctx.fillStyle = '#231c15';
  ctx.fillRect(L, s.top, s.w, GEN.groundY - s.top);
  ctx.fillStyle = '#3b3027';
  ctx.fillRect(L - 2, s.top, s.w + 4, 12);
  ctx.fillStyle = '#17120d';
  ctx.fillRect(L, s.top + 12, s.w, 5);
  rimStroke(ctx, s.profile, TUNNEL_RIM, L, 1.8);
}

function drawPipe(ctx, s, L) {
  const g = ctx.createLinearGradient(0, s.top, 0, s.top + 22);
  g.addColorStop(0, '#6b5a48');
  g.addColorStop(0.35, '#3d3228');
  g.addColorStop(1, '#16110c');
  ctx.fillStyle = g;
  ctx.fillRect(L, s.top, s.w, 22);
  ctx.fillStyle = '#1a140f';
  for (let x = 20; x < s.w; x += 90) { ctx.fillRect(L + x, s.top - 1, 8, 24); ctx.fillRect(L + x + 2, s.top + 22, 4, GEN.groundY - s.top); }
  rimStroke(ctx, s.profile, TUNNEL_RIM, L, 1.6);
}

// ---------------------------------------------------------------------------
function drawVehicle(ctx, v, D, P, t) {
  const first = v.parts[0];
  const L0 = first.left(D);
  const lastPart = v.parts[v.parts.length - 1];
  const totalW = lastPart.left(D) + lastPart.w - L0;
  if (!visible(L0, totalW, 280)) return;
  const col = laneColors(P, first.biome);
  if (v.type === 'train') return drawTrain(ctx, v, D, P, col);
  const paint = mixRgb(col.body, PAINTS[(v.data.paint ?? 0) % PAINTS.length], 0.34 * P.ambient + 0.08);
  const def = VEHICLES[v.type];
  for (const part of v.parts) {
    const L = part.left(D);
    const trailer = part.data.part === 'trailer';
    ctx.fillStyle = rgb(trailer ? mixRgb(col.body, '#8b8a86', 0.18 * P.ambient) : paint);
    poly(ctx, L, part.profile, trailer ? ROAD_Y - 36 : ROAD_Y - 14);
    ctx.fill();
    if (trailer) {
      ctx.fillStyle = rgb(mixRgb(col.body, P.fog, 0.08));
      for (let x = 14; x < part.w - 6; x += 28) ctx.fillRect(L + x, part.top + 6, 2, ROAD_Y - 48 - part.top);
      ctx.fillStyle = rgb(mixRgb(paint, P.fog, 0.1));
      ctx.fillRect(L + 6, part.top + 60, part.w - 12, 8);
      ctx.fillStyle = rgb(col.deep);
      ctx.fillRect(L + 2, ROAD_Y - 36, part.w - 4, 6);
      ctx.fillRect(L, part.top + 4, 3, ROAD_Y - 40 - part.top);
    }
    if (part.data.part === 'cab') {
      ctx.fillStyle = rgb(mixRgb(P.skyMid, col.deep, 0.62));
      ctx.beginPath();
      ctx.moveTo(L + 78, part.top + 10); ctx.lineTo(L + 94, part.top + 10); ctx.lineTo(L + 116, ROAD_Y - 88); ctx.lineTo(L + 78, ROAD_Y - 88);
      ctx.fill();
      ctx.fillStyle = rgb(col.deep);
      ctx.fillRect(L - 8, part.top - 30, 6, 40);
    }
  }
  if (v.type !== 'truck') {
    const L = L0;
    const beltH = def.bodyH;
    const cabin = first.profile.filter(([, y]) => ROAD_Y - y > beltH + 4);
    if (cabin.length >= 2) {
      ctx.fillStyle = rgb(mixRgb(P.skyMid, col.deep, 0.6));
      ctx.beginPath();
      ctx.moveTo(L + cabin[0][0] + 6, ROAD_Y - beltH - 2);
      for (const [x, y] of cabin) ctx.lineTo(L + x + (x < first.w / 2 ? 5 : -5), y + 5);
      ctx.lineTo(L + cabin[cabin.length - 1][0] - 6, ROAD_Y - beltH - 2);
      ctx.fill();
      ctx.fillStyle = rgb(paint);
      const mid = (cabin[0][0] + cabin[cabin.length - 1][0]) / 2;
      ctx.fillRect(L + mid - 3, first.top + 4, 6, ROAD_Y - beltH - first.top - 4);
      ctx.fillStyle = rgb(P.horizon, 0.12 + 0.1 * (1 - P.night));
      ctx.beginPath();
      ctx.moveTo(L + mid + 14, first.top + 8); ctx.lineTo(L + mid + 26, first.top + 8); ctx.lineTo(L + mid + 12, ROAD_Y - beltH - 4); ctx.lineTo(L + mid, ROAD_Y - beltH - 4);
      ctx.fill();
    }
  }
  const wr = def.wheelR;
  for (let i = 0; i < def.wheels.length; i++) {
    const wx = L0 + def.wheels[i];
    const r = v.type === 'tractor' && i > 0 ? def.wheelR2 : wr;
    ctx.fillStyle = '#0a0a0c';
    ctx.beginPath(); ctx.arc(wx, ROAD_Y - r + 4, r, 0, TAU); ctx.fill();
    ctx.fillStyle = rgb(col.detail);
    ctx.beginPath(); ctx.arc(wx, ROAD_Y - r + 4, r * 0.42, 0, TAU); ctx.fill();
  }
  const front = lastPart.left(D) + lastPart.w;
  const lightY = ROAD_Y - (v.type === 'truck' ? 44 : def.bodyH - 8);
  ctx.fillStyle = `rgba(255,40,30,${(0.35 + 0.6 * P.night).toFixed(3)})`;
  ctx.fillRect(L0 - 1, lightY - 6, 5, 9);
  if (P.night > 0.25) {
    const tg = ctx.createRadialGradient(L0, lightY - 2, 0, L0, lightY - 2, 26);
    tg.addColorStop(0, `rgba(255,40,30,${(0.35 * P.night).toFixed(3)})`);
    tg.addColorStop(1, 'rgba(255,40,30,0)');
    ctx.fillStyle = tg;
    ctx.fillRect(L0 - 26, lightY - 28, 52, 52);
    const hy = ROAD_Y - (v.type === 'truck' ? 40 : def.bodyH - 12);
    const bg = ctx.createLinearGradient(front, 0, front + 260, 0);
    bg.addColorStop(0, `rgba(255,240,200,${(0.32 * P.night).toFixed(3)})`);
    bg.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.moveTo(front, hy - 3); ctx.lineTo(front + 260, hy - 30); ctx.lineTo(front + 260, hy + 26); ctx.lineTo(front, hy + 4); ctx.fill();
    ctx.fillStyle = `rgba(255,248,220,${(0.95 * P.night).toFixed(3)})`;
    ctx.fillRect(front - 5, hy - 3, 5, 6);
  }
  for (const part of v.parts) rimStroke(ctx, part.profile, P, part.left(D));
}

function drawTrain(ctx, v, D, P, col) {
  const body = mixRgb(col.body, ['#3a4a5a', '#5a3a3a', '#4a4a3a', '#2e3e36'][v.data.paint % 4], 0.3 * P.ambient + 0.08);
  ctx.fillStyle = rgb(col.deep);
  ctx.fillRect(0, ROAD_Y - 4, VIEW.W, 3);
  for (const part of v.parts) {
    const L = part.left(D);
    if (!visible(L, part.w, 40)) continue;
    ctx.fillStyle = rgb(body);
    poly(ctx, L, part.profile, ROAD_Y - 8);
    ctx.fill();
    ctx.fillStyle = rgb(mixRgb(body, P.fog, 0.14));
    ctx.fillRect(L + 4, part.top + 70, part.w - 8, 6);
    const n = Math.floor((part.w - 30) / 34);
    for (let i = 0; i < n; i++) {
      if (part.data.part === 'loco' && i > n - 3) continue;
      const wx = L + 18 + i * 34;
      const lit = P.windowLit > 0.1 && hash1(v.data.seed + i * 5.7 + part.dLead) < 0.5 + P.windowLit * 0.5;
      ctx.fillStyle = lit ? `rgba(255,214,140,${(0.25 + 0.7 * P.windowLit).toFixed(3)})` : rgb(mixRgb(P.skyMid, body, 0.6));
      ctx.fillRect(wx, part.top + 22, 22, 30);
    }
    ctx.fillStyle = '#0b0b0d';
    ctx.fillRect(L + 22, ROAD_Y - 14, 56, 14);
    ctx.fillRect(L + part.w - 78, ROAD_Y - 14, 56, 14);
    if (part.data.part === 'loco') {
      ctx.fillStyle = rgb(mixRgb(P.skyMid, body, 0.55));
      ctx.beginPath(); ctx.moveTo(L + 250, part.top + 2); ctx.lineTo(L + 272, part.top + 18); ctx.lineTo(L + 272, part.top + 46); ctx.lineTo(L + 250, part.top + 46); ctx.fill();
      ctx.fillStyle = `rgba(255,246,210,${(0.4 + 0.6 * P.night).toFixed(3)})`;
      ctx.fillRect(L + part.w - 8, part.top + 70, 6, 8);
    } else {
      ctx.fillStyle = rgb(col.deep);
      ctx.fillRect(L + part.w, ROAD_Y - 40, 22, 6);
    }
    rimStroke(ctx, part.profile, P, L);
  }
}

// ---------------------------------------------------------------------------
export function drawHazards(ctx, world, D, t, P) {
  const glow = clamp((P.night - 0.25) / 0.6, 0, 1);
  for (const h of world.hazards) {
    const L = h.left(D);
    if (!visible(L, h.w, 60)) continue;
    const col = laneColors(P, h.biome);
    switch (h.kind) {
      case 'sign': drawSign(ctx, h, L, P, glow); break;
      case 'overpass': drawOverpass(ctx, h, L, P, col); break;
      case 'bug': drawBug(ctx, h, L, t, P, glow); break;
      case 'bird': drawBird(ctx, h, L, P, col, glow); break;
      case 'cable': drawCable(ctx, h, L, t); break;
      case 'vent': drawVent(ctx, h, L); break;
      default: break; // chimney: drawn with its standable top
    }
  }
}

function signPath(ctx, def, x, y, w, hh) {
  ctx.beginPath();
  if (def.shape === 'diamond') {
    ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w, y + hh / 2); ctx.lineTo(x + w / 2, y + hh); ctx.lineTo(x, y + hh / 2);
  } else if (def.shape === 'pent') {
    ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w, y + hh * 0.35); ctx.lineTo(x + w, y + hh); ctx.lineTo(x, y + hh); ctx.lineTo(x, y + hh * 0.35);
  } else {
    const r = 4;
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + hh, r); ctx.arcTo(x + w, y + hh, x, y + hh, r); ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  }
  ctx.closePath();
}

function drawSign(ctx, h, L, P, glow) {
  const def = h.def;
  const x = L, y = h.panelTop, w = h.w, hh = h.panelBottom - h.panelTop;
  const lightK = 0.45 + 0.55 * P.ambient;
  const bg = mixRgb(def.bg, '#000', 1 - lightK), fg = mixRgb(def.fg, '#000', 1 - lightK);
  ctx.save();
  if (glow > 0) { ctx.shadowColor = `rgba(255,250,230,${(0.5 * glow).toFixed(3)})`; ctx.shadowBlur = 10; }
  ctx.fillStyle = rgb(bg);
  signPath(ctx, def, x, y, w, hh);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.translate(x + w / 2, y + hh / 2);
  ctx.scale(0.88, 0.86);
  ctx.translate(-(x + w / 2), -(y + hh / 2));
  signPath(ctx, def, x, y, w, hh);
  ctx.restore();
  ctx.strokeStyle = rgb(fg, 0.85);
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.fillStyle = rgb(fg);
  if (def.icon === 'deer') {
    const cx = x + w / 2 - 2, cy = y + hh / 2 + 3;
    ctx.beginPath(); ctx.ellipse(cx, cy, 10, 5, 0, 0, TAU); ctx.fill();
    ctx.fillRect(cx + 6, cy - 12, 3, 10); ctx.fillRect(cx - 8, cy + 2, 2, 8); ctx.fillRect(cx + 6, cy + 2, 2, 8);
    ctx.beginPath(); ctx.ellipse(cx + 10, cy - 13, 4, 2.5, -0.4, 0, TAU); ctx.fill();
    ctx.fillRect(cx + 7, cy - 19, 1.5, 5); ctx.fillRect(cx + 10, cy - 19, 1.5, 5);
  } else if (def.icon === 'kids') {
    for (const dx of [-7, 7]) {
      const cx = x + w / 2 + dx, cy = y + hh * 0.58;
      ctx.beginPath(); ctx.arc(cx, cy - 10, 3.5, 0, TAU); ctx.fill();
      ctx.fillRect(cx - 2.5, cy - 6, 5, 10); ctx.fillRect(cx - 3, cy + 4, 2, 7); ctx.fillRect(cx + 1, cy + 4, 2, 7);
    }
  } else if (def.lines) {
    const n = def.lines.length;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    def.lines.forEach((line, i) => {
      const size = n === 3 ? [9, 9, 20][i] : n === 1 ? 15 : 13;
      ctx.font = `600 ${size}px ${SIGN_FONT}`;
      const yy = n === 3 ? y + [11, 21, 39][i] : n === 1 ? y + hh / 2 : y + hh / 2 + (i ? 9 : -8);
      ctx.fillText(line, x + w / 2 - (def.shape === 'arrow' ? 6 : 0), yy);
    });
    if (def.shape === 'arrow') { ctx.beginPath(); ctx.moveTo(x + w - 14, y + hh / 2 - 7); ctx.lineTo(x + w - 5, y + hh / 2); ctx.lineTo(x + w - 14, y + hh / 2 + 7); ctx.fill(); }
  }
  if (P.rimA > 0) { ctx.fillStyle = rgb(P.rim, 0.5 * P.rimA); ctx.fillRect(x + 3, y, w - 6, 1.5); }
}

function drawOverpass(ctx, h, L, P, col) {
  const top = h.ceil - h.deckH, bot = h.ceil;
  const conc = mixRgb(col.body, h.style === 'stone' ? '#6a5a48' : h.style === 'steel' ? '#3a4452' : '#6c6a66', 0.3 * P.ambient + 0.05);
  const g = ctx.createLinearGradient(0, top, 0, bot);
  g.addColorStop(0, rgb(mixRgb(conc, '#000', 0.25)));
  g.addColorStop(1, rgb(conc));
  ctx.fillStyle = g;
  ctx.fillRect(L, top, h.w, h.deckH);
  if (h.style === 'stone') {
    ctx.strokeStyle = rgb(mixRgb(conc, '#000', 0.3), 0.6);
    ctx.lineWidth = 1;
    for (let y = bot - 12, row = 0; y > top; y -= 12, row++) {
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + h.w, y); ctx.stroke();
      for (let x = (row % 2) * 14; x < h.w; x += 28) { ctx.beginPath(); ctx.moveTo(L + x, y); ctx.lineTo(L + x, y + 12); ctx.stroke(); }
    }
  } else if (h.style === 'steel') {
    ctx.strokeStyle = rgb(mixRgb(conc, P.fog, 0.15));
    ctx.lineWidth = 3;
    for (let x = 0; x < h.w - 30; x += 30) { ctx.beginPath(); ctx.moveTo(L + x, bot - 12); ctx.lineTo(L + x + 30, bot - 70); ctx.stroke(); }
    ctx.fillStyle = rgb(mixRgb(conc, '#000', 0.25));
    ctx.fillRect(L, bot - 76, h.w, 8);
  } else {
    // girder ends under a concrete slab
    ctx.fillStyle = rgb(mixRgb(conc, '#000', 0.3));
    for (let x = 12; x < h.w - 10; x += 46) ctx.fillRect(L + x, bot - 40, 14, 40);
    ctx.fillStyle = rgb(mixRgb(conc, P.fog, 0.1));
    ctx.fillRect(L, bot - 58, h.w, 18);
  }
  // low-clearance beam: yellow/black chevrons along the underside
  const beamH = 9;
  ctx.save();
  ctx.beginPath(); ctx.rect(L, bot - beamH, h.w, beamH); ctx.clip();
  ctx.fillStyle = rgb(mixRgb('#e8b830', '#000', 0.55 - 0.45 * P.ambient));
  ctx.fillRect(L, bot - beamH, h.w, beamH);
  ctx.fillStyle = 'rgba(15,15,15,0.9)';
  for (let x = -beamH; x < h.w; x += 18) { ctx.beginPath(); ctx.moveTo(L + x, bot); ctx.lineTo(L + x + beamH, bot - beamH); ctx.lineTo(L + x + beamH + 7, bot - beamH); ctx.lineTo(L + x + 7, bot); ctx.fill(); }
  ctx.restore();
  // shadow cast on the lane below
  const sg = ctx.createLinearGradient(0, bot, 0, bot + 60);
  sg.addColorStop(0, 'rgba(0,0,0,0.35)');
  sg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sg;
  ctx.fillRect(L, bot, h.w, 60);
  // edge shading so the deck reads as a solid mass
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(L, top, 10, h.deckH);
}

function drawBug(ctx, h, L, t, P, glow) {
  const y = h.yAt(t);
  const cx = L + h.w / 2;
  const flap = Math.sin(t * 60 + h.seed) * 0.5 + 0.5;
  const dark = rgb(mixRgb('#1a1612', P.fog, 0.05));
  if (glow > 0) {
    const g = ctx.createRadialGradient(cx, y, 0, cx, y, h.w);
    g.addColorStop(0, `rgba(255,245,210,${(0.4 * glow).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255,245,210,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - h.w, y - h.w, h.w * 2, h.w * 2);
  }
  const wing = `rgba(225,235,245,${(0.35 + 0.25 * P.ambient).toFixed(3)})`;
  switch (h.variant) {
    case 'dragonfly': {
      ctx.fillStyle = wing;
      for (const [dx, s] of [[-2, 1], [4, 0.85]]) {
        ctx.beginPath(); ctx.ellipse(cx + dx, y - 3 - flap * 3, 11 * s, 3, -0.2, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.ellipse(cx + dx, y + 3 + flap * 2, 10 * s, 2.6, 0.2, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = rgb(mixRgb('#2f5a4a', '#000', 1 - P.ambient * 0.8));
      ctx.fillRect(cx - 4, y - 1.5, 18, 3);
      ctx.beginPath(); ctx.arc(cx - 6, y, 3.4, 0, TAU); ctx.fill();
      break;
    }
    case 'beetle': {
      ctx.fillStyle = wing;
      ctx.beginPath(); ctx.ellipse(cx + 2, y - 7 - flap * 3, 9, 3.5, -0.5, 0, TAU); ctx.fill();
      ctx.fillStyle = rgb(mixRgb('#2c3a1a', '#000', 1 - P.ambient * 0.8));
      ctx.beginPath(); ctx.ellipse(cx, y, 10, 7, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,230,0.35)';
      ctx.beginPath(); ctx.ellipse(cx - 2, y - 3, 4, 2, -0.3, 0, TAU); ctx.fill();
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.arc(cx - 9, y + 1, 3, 0, TAU); ctx.fill();
      break;
    }
    case 'pigeon': {
      const gray = mixRgb('#8a8e96', '#000', 1 - P.ambient * 0.85);
      ctx.fillStyle = rgb(gray);
      ctx.beginPath(); ctx.ellipse(cx + 2, y, 11, 6, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(cx - 9, y - 3, 4.5, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx + 10, y - 2); ctx.lineTo(cx + 18, y - 4); ctx.lineTo(cx + 17, y + 3); ctx.fill();
      ctx.fillStyle = rgb(mixRgb(gray, '#fff', 0.15));
      ctx.beginPath(); ctx.moveTo(cx - 2, y - 2); ctx.lineTo(cx + 8, y - 2); ctx.lineTo(cx + 2 + flap * 4, y - 14 + flap * 22); ctx.fill();
      ctx.fillStyle = '#d9a040';
      ctx.fillRect(cx - 15, y - 3, 3, 2);
      break;
    }
    default: {
      const s = h.variant === 'gnat' ? 0.75 : 1;
      ctx.fillStyle = wing;
      ctx.beginPath(); ctx.ellipse(cx + 1, y - 4 * s - flap * 2, 6 * s, 2.4 * s, -0.6, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 3, y - 3 * s - flap * 2, 5 * s, 2 * s, -0.2, 0, TAU); ctx.fill();
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.ellipse(cx, y, 6 * s, 3.6 * s, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(cx - 5 * s, y - 0.5, 2.6 * s, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(200,40,30,0.8)';
      ctx.fillRect(cx - 7 * s, y - 2, 2, 2);
    }
  }
}

function drawBird(ctx, h, L, P, col, glow) {
  const x = L + h.w / 2;
  const y = h.y;
  const body = rgb(mixRgb(col.deep, '#2a2420', 0.3));
  if (glow > 0 && h.mode !== 'perched') {
    const g = ctx.createRadialGradient(x, y - 6, 0, x, y - 6, 26);
    g.addColorStop(0, `rgba(255,245,210,${(0.35 * glow).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255,245,210,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 26, y - 32, 52, 52);
  }
  ctx.fillStyle = body;
  if (h.mode === 'perched' || h.mode === 'bob') {
    const bob = h.mode === 'bob' ? Math.abs(Math.sin(h.modeT * 26)) * 4 : 0;
    ctx.beginPath(); ctx.ellipse(x, y - 8, 8, 6.5, -0.15, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x - 6, y - 14 + bob, 4.2, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + 6, y - 9); ctx.lineTo(x + 15, y - 4); ctx.lineTo(x + 6, y - 5); ctx.fill();
    ctx.fillStyle = '#d7a84a';
    ctx.beginPath(); ctx.moveTo(x - 10, y - 15 + bob); ctx.lineTo(x - 14, y - 13 + bob); ctx.lineTo(x - 10, y - 12 + bob); ctx.fill();
    ctx.fillStyle = body;
    ctx.fillRect(x - 2, y - 3, 1.5, 3); ctx.fillRect(x + 2, y - 3, 1.5, 3);
    if (P.rimA > 0) { ctx.strokeStyle = rgb(P.rim, 0.5 * P.rimA); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y - 8, 7, -2.2, -0.6); ctx.stroke(); }
  } else {
    const f = Math.sin(h.flap * 32);
    ctx.beginPath(); ctx.ellipse(x, y, 9, 5, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x - 8, y - 2, 4, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + 7, y - 1); ctx.lineTo(x + 16, y - 3); ctx.lineTo(x + 15, y + 3); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - 3, y - 1); ctx.lineTo(x + 5, y - 1); ctx.lineTo(x + 2 + f * 2, y - 4 - f * 13); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.lineTo(x - 2 - f * 2, y - 2 - f * 10); ctx.fill();
    ctx.fillStyle = '#d7a84a';
    ctx.fillRect(x - 14, y - 3, 3, 2);
  }
}

function drawCable(ctx, h, L, t) {
  const sway = Math.sin(t * 2.3 + h.dLead) * 2;
  ctx.strokeStyle = '#0c0a08';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(L + h.w / 2, 0); ctx.quadraticCurveTo(L + h.w / 2 + sway, h.bottom * 0.6, L + h.w / 2 + sway, h.bottom); ctx.stroke();
}
function drawVent(ctx, h, L) {
  ctx.fillStyle = '#2a221a';
  ctx.fillRect(L, h.top, h.w, h.base - h.top);
  ctx.fillStyle = '#120e0a';
  for (let x = 4; x < h.w - 2; x += 6) ctx.fillRect(L + x, h.top + 5, 3, h.base - h.top - 9);
}

// Small glowing markers so tunnel hazards read in the dark (drawn after the darkness pass).
export function drawTunnelMarkers(ctx, world, D, t) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const h of world.hazards) {
    const L = h.left(D);
    if (!visible(L, h.w)) continue;
    if (h.kind === 'cable') {
      const x = L + h.w / 2 + Math.sin(t * 2.3 + h.dLead) * 2, y = h.bottom;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 30);
      g.addColorStop(0, 'rgba(255,140,40,0.9)');
      g.addColorStop(1, 'rgba(255,100,20,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 30, y - 30, 60, 60);
      ctx.fillStyle = 'rgba(255,200,120,1)';
      ctx.beginPath(); ctx.arc(x, y, 3.5, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,150,60,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, 60); ctx.stroke();
    } else if (h.kind === 'vent') {
      const pulse = 0.6 + 0.4 * Math.sin(t * 6 + h.dLead);
      const g = ctx.createRadialGradient(L + h.w / 2, h.top + 8, 0, L + h.w / 2, h.top + 8, 44);
      g.addColorStop(0, `rgba(255,90,40,${(0.7 * pulse).toFixed(3)})`);
      g.addColorStop(1, 'rgba(255,60,20,0)');
      ctx.fillStyle = g;
      ctx.fillRect(L - 30, h.top - 40, h.w + 60, 90);
      ctx.fillStyle = `rgba(255,150,80,${pulse.toFixed(3)})`;
      ctx.fillRect(L + 3, h.top + 2, h.w - 6, 3);
      for (let i = 0; i < 3; i++) {
        const ph = (t * 0.9 + i / 3 + h.dLead * 0.01) % 1;
        ctx.fillStyle = `rgba(255,190,150,${(0.12 * (1 - ph)).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(L + h.w / 2 + Math.sin(ph * 6 + i) * 5, h.top - ph * 50, 6 + ph * 12, 0, TAU); ctx.fill();
      }
    }
  }
  ctx.restore();
}

// Tunnel darkness: vertical strips whose alpha follows the passing lamps (a rhythmic strobe).
// Also reports how deep inside the tunnel the fingers are and how lit they are right now.
export function drawTunnelDarkness(ctx, world, D) {
  let lamp = 0, inside = 0;
  for (const d of world.decor) {
    if (d.kind !== 'tunnel') continue;
    const L = d.left(D), R = L + d.w;
    if (R < -20 || L > VIEW.W + 20) continue;
    const every = d.data.lampEvery;
    const x0 = Math.max(L, -20), x1 = Math.min(R, VIEW.W + 20);
    const lightAt = (x) => {
      const rel = (((x - L) % every) + every) % every - every / 2;
      return Math.exp(-(rel * rel) / (2 * 55 * 55));
    };
    for (let x = x0; x < x1; x += 8) {
      const edge = clamp(Math.min(x - L, R - x) / 120, 0, 1); // daylight spills in at the mouths
      const a = (0.72 - 0.34 * lightAt(x)) * edge;
      ctx.fillStyle = `rgba(6,4,3,${a.toFixed(3)})`;
      ctx.fillRect(x, 0, 8.5, VIEW.H);
    }
    const inPl = clamp(Math.min(PLAYER.x - L, R - PLAYER.x) / 120, 0, 1);
    if (inPl > inside) { inside = inPl; lamp = lightAt(PLAYER.x) * inPl; }
  }
  world.tunnelInside = inside;
  world.tunnelLamp = lamp;
}
