// HUD odometer, game-over overlay, title text. Everything is drawn on the glass (inside the frame).
import { FRAME, VIEW } from './config.js';
import { clamp, smoothstep } from './util.js';

export const FONTS = {
  mono: "'Share Tech Mono', 'DejaVu Sans Mono', 'Menlo', monospace",
  hand: "'Patrick Hand', 'Comic Sans MS', 'Chalkboard SE', 'Segoe Print', cursive",
};

export function loadFonts() {
  if (!document.fonts?.load) return Promise.resolve();
  return Promise.race([
    Promise.all([document.fonts.load(`20px ${FONTS.mono}`), document.fonts.load(`20px ${FONTS.hand}`)]),
    new Promise((r) => setTimeout(r, 1500)),
  ]).catch(() => {});
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Mechanical odometer: 3 digits . 1 digit, last wheel rolls continuously.
function drawOdometer(ctx, x, y, value, cellW, cellH, alpha) {
  const tenths = Math.max(0, value * 10);
  const digits = 4;
  const w = cellW * digits + 8;
  ctx.save();
  ctx.globalAlpha = alpha;
  roundRect(ctx, x - 3, y - 3, w + 6, cellH + 6, 5);
  ctx.fillStyle = 'rgba(12,12,14,0.72)';
  ctx.fill();
  ctx.font = `${Math.round(cellH * 0.86)}px ${FONTS.mono}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < digits; i++) {
    const place = Math.pow(10, digits - 1 - i);
    const cx = x + i * cellW + cellW / 2 + (i === digits - 1 ? 8 : 0);
    const cell = (i === digits - 1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - cellW / 2 + 1, y, cellW - 2, cellH);
    ctx.clip();
    ctx.fillStyle = cell ? '#e9e3d4' : '#1c1c1f';
    ctx.fillRect(cx - cellW / 2 + 1, y, cellW - 2, cellH);
    // wheel position: the last wheel rolls smoothly, others flip over when the one below wraps
    const raw = tenths / place;
    let pos = Math.floor(raw) % 10;
    let frac = 0;
    if (i === digits - 1) frac = raw - Math.floor(raw);
    else {
      const below = (tenths % place) / place; // how far the lower wheels are through their cycle
      frac = smoothstep(0.985, 1, below);
    }
    ctx.fillStyle = cell ? '#1b1b1d' : '#e9e3d4';
    for (let k = 0; k < 2; k++) {
      const d = (pos + k) % 10;
      ctx.fillText(String(d), cx, y + cellH / 2 + (k - frac) * cellH + 1);
    }
    // wheel shading
    const g = ctx.createLinearGradient(0, y, 0, y + cellH);
    g.addColorStop(0, 'rgba(0,0,0,0.45)');
    g.addColorStop(0.3, 'rgba(0,0,0,0)');
    g.addColorStop(0.7, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - cellW / 2 + 1, y, cellW - 2, cellH);
    ctx.restore();
  }
  // decimal point
  ctx.fillStyle = '#e9e3d4';
  ctx.beginPath();
  ctx.arc(x + cellW * (digits - 1) + 4, y + cellH - 4, 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  return w;
}

export function drawHUD(ctx, game, alpha = 1) {
  if (alpha <= 0) return;
  const right = FRAME.right - 26, top = FRAME.top + 20;
  const cellW = 17, cellH = 26;
  const w = cellW * 4 + 8;
  drawOdometer(ctx, right - w - 30, top, game.miles, cellW, cellH, alpha);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `15px ${FONTS.mono}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(240,236,226,0.9)';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 3;
  ctx.fillText('mi', right - 22, top + cellH / 2 + 1);
  ctx.textAlign = 'right';
  ctx.font = `13px ${FONTS.mono}`;
  ctx.fillStyle = 'rgba(240,236,226,0.72)';
  ctx.fillText(`BEST ${fmtMiles(game.best)}`, right, top + cellH + 16);
  ctx.restore();
}

export function fmtMiles(v) {
  return v.toFixed(1).padStart(5, '0');
}

export function drawGameOver(ctx, game, t) {
  const a = smoothstep(0, 0.25, t);
  ctx.save();
  // dim the glass only (frame stays on top anyway)
  ctx.fillStyle = `rgba(6,8,12,${0.42 * a})`;
  ctx.fillRect(FRAME.left, FRAME.top, FRAME.right - FRAME.left, FRAME.sill - FRAME.top);
  ctx.globalAlpha = a;
  const cx = (FRAME.left + FRAME.right) / 2, cy = (FRAME.top + FRAME.sill) / 2 - 20;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = '#f4efe3';
  ctx.font = `96px ${FONTS.hand}`;
  const pop = 1 + 0.08 * Math.max(0, 1 - t * 4);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(pop, pop);
  ctx.fillText(`${game.miles.toFixed(1)} mi`, 0, 0);
  ctx.restore();
  ctx.font = `30px ${FONTS.hand}`;
  if (game.newBest) {
    ctx.fillStyle = '#ffd36b';
    const wob = Math.sin(t * 7) * 0.04;
    ctx.save();
    ctx.translate(cx, cy + 50);
    ctx.rotate(wob);
    ctx.fillText('★ new best! ★', 0, 0);
    ctx.restore();
  } else {
    ctx.fillStyle = 'rgba(244,239,227,0.8)';
    ctx.fillText(`best ${game.best.toFixed(1)} mi`, cx, cy + 50);
  }
  ctx.font = `26px ${FONTS.hand}`;
  ctx.fillStyle = `rgba(244,239,227,${0.55 + 0.35 * Math.sin(t * 4) ** 2})`;
  ctx.fillText('SPACE to go again', cx, cy + 112);
  ctx.restore();
}

// Tiny caption under the fog title.
export function drawPressSpace(ctx, t, alpha, best = 0, needsFocus = false) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = '#f7f4ec';
  ctx.globalAlpha = alpha * (0.6 + 0.4 * Math.sin(t * 3) ** 2);
  ctx.font = `30px ${FONTS.hand}`;
  ctx.fillText(needsFocus ? 'click the window, then press SPACE' : 'press SPACE', VIEW.W / 2, 500);
  ctx.globalAlpha = alpha * 0.75;
  ctx.font = `20px ${FONTS.hand}`;
  const help = 'SPACE / ↑ jump (hold = higher)   ·   ↓ slide, or fast-fall in the air';
  ctx.fillText(help, VIEW.W / 2, 536);
  if (best > 0) ctx.fillText(`best ${best.toFixed(1)} mi`, VIEW.W / 2, 566);
  ctx.restore();
}

export { roundRect, clamp };
