// Play-lane renderer (grey-box until the art pass).
import { GEN, VIEW } from '../config.js';
import { VEHICLES, ROAD_Y } from '../world/vehicles.js';

export function drawPlayLane(ctx, world, D, t) {
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
    ctx.fillStyle = s.kind === 'barrier' ? '#5c6068' : '#4a525c';
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
