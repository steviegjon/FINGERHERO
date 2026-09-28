// Play-lane renderer (grey-box until the art pass).
import { GEN, VIEW } from '../config.js';
import { VEHICLES, ROAD_Y } from '../world/vehicles.js';

export function drawPlayLane(ctx, world, D, t) {
  for (const d of world.decor) {
    if (d.kind !== 'tunnel') continue;
    ctx.fillStyle = 'rgba(10,8,6,0.92)';
    ctx.fillRect(d.left(D), 0, d.w, VIEW.H);
  }
  // decor first (poles), then static surfaces, then vehicles
  for (const d of world.decor) {
    const L = d.left(D);
    if (d.kind === 'pole') {
      ctx.fillStyle = '#3b3f45';
      ctx.fillRect(L, d.data.top, d.w, GEN.groundY - d.data.top);
      ctx.fillRect(L - 14, d.data.top + 2, d.w + 28, 5);
    }
  }
  for (const s of world.surfaces) {
    if (s.kind === 'vehicle') continue;
    const L = s.left(D);
    if (L > VIEW.W || L + s.w < 0) continue;
    if (s.kind === 'wire') {
      ctx.strokeStyle = '#23262b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [lx, y] of s.profile) ctx.lineTo(L + lx, y);
      ctx.stroke();
      continue;
    }
    if (s.kind === 'polecap') { ctx.fillStyle = '#2f3237'; ctx.fillRect(L, s.top, s.w, 6); continue; }
    if (s.kind === 'chimney') { ctx.fillStyle = '#6b4a3a'; ctx.fillRect(L, s.top, s.w, s.parent.top - s.top); continue; }
    ctx.fillStyle = { barrier: '#5c6068', tree: '#3f5a2e', railing: '#6a5f55', ledge: '#6b5a44', pipe: '#7b6a50' }[s.kind] ?? '#4a525c';
    ctx.beginPath();
    ctx.moveTo(L, GEN.groundY);
    for (const [lx, y] of s.profile) ctx.lineTo(L + lx, y);
    ctx.lineTo(L + s.w, GEN.groundY);
    ctx.fill();
  }
  for (const s of world.surfaces) {
    if (s.kind !== 'vehicle') continue;
    const L = s.left(D);
    ctx.fillStyle = s.data.part === 'cab' ? '#8a4b3a' : '#6d4f8a';
    ctx.beginPath();
    ctx.moveTo(L, ROAD_Y);
    for (const [lx, y] of s.profile) ctx.lineTo(L + lx, y);
    ctx.lineTo(L + s.w, ROAD_Y);
    ctx.fill();
  }
}

export function drawHazards(ctx, world, D, t) {
  for (const h of world.hazards) {
    const L = h.left(D);
    if (L > VIEW.W + 50 || L + h.w < -50) continue;
    if (h.kind === 'sign') {
      ctx.fillStyle = '#555';
      ctx.fillRect(L + h.w / 2 - 3, h.panelBottom, 6, GEN.groundY - h.panelBottom);
      ctx.fillStyle = h.def.bg;
      ctx.fillRect(L, h.panelTop, h.w, h.panelBottom - h.panelTop);
      continue;
    }
    if (h.kind === 'overpass') {
      ctx.fillStyle = '#3a3d42';
      ctx.fillRect(L, h.ceil - h.deckH, h.w, h.deckH);
      ctx.fillRect(L + 20, h.ceil, 26, GEN.groundY - h.ceil);
      ctx.fillRect(L + h.w - 46, h.ceil, 26, GEN.groundY - h.ceil);
      continue;
    }
    ctx.fillStyle = h.kind === 'bird' ? '#222' : h.kind === 'chimney' ? '#6b4a3a' : '#2a1d12';
    for (const b of h.boxes(D, t)) ctx.fillRect(b.x, b.y, b.w, b.h);
  }
}
