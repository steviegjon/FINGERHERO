// The car window: interior door panel, rubber seal with rounded top corners, thick door + sill,
// and restrained glass (diagonal sheen, a couple of smudges, a light vignette).
// Static layers are rendered once into offscreen canvases at device resolution.
import { VIEW, FRAME } from '../config.js';
import { RNG, TAU, rgb } from '../util.js';

export function glassPath(ctx, inset = 0) {
  const l = FRAME.left + inset, r = FRAME.right - inset, t = FRAME.top + inset, b = FRAME.sill + 2;
  const R = FRAME.cornerRadius - inset;
  ctx.moveTo(l, b);
  ctx.lineTo(l, t + R);
  ctx.quadraticCurveTo(l, t, l + R, t);
  ctx.lineTo(r - R, t);
  ctx.quadraticCurveTo(r, t, r, t + R);
  ctx.lineTo(r, b);
  ctx.closePath();
}

function makeCanvas(scale) {
  const c = document.createElement('canvas');
  c.width = Math.round(VIEW.W * scale);
  c.height = Math.round(VIEW.H * scale);
  const ctx = c.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  return { c, ctx };
}

export class WindowFrame {
  constructor() { this.scale = 0; }

  build(scale) {
    this.scale = scale;
    this.frame = this.buildFrame(scale);
    this.shade = this.buildMask(scale, '#000');
    this.warm = this.buildMask(scale, '#ffb060');
    this.glass = this.buildGlass(scale);
  }

  buildMask(scale, color) {
    const { c, ctx } = makeCanvas(scale);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.rect(0, 0, VIEW.W, VIEW.H);
    glassPath(ctx, -10);
    ctx.fill('evenodd');
    return c;
  }

  buildFrame(scale) {
    const { c, ctx } = makeCanvas(scale);
    const r = new RNG(99);
    // door panel: moulded plastic, darkest element on screen
    const g = ctx.createLinearGradient(0, 0, 0, VIEW.H);
    g.addColorStop(0, '#16171b');
    g.addColorStop(0.5, '#1d1e23');
    g.addColorStop(0.86, '#191a1e');
    g.addColorStop(1, '#0e0f12');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.rect(0, 0, VIEW.W, VIEW.H);
    glassPath(ctx, -12);
    ctx.fill('evenodd');

    // fine plastic grain
    for (let i = 0; i < 2600; i++) {
      const x = r.float(0, VIEW.W), y = r.float(0, VIEW.H);
      ctx.fillStyle = `rgba(255,255,255,${r.float(0.004, 0.018).toFixed(3)})`;
      ctx.fillRect(x, y, 1, 1);
    }

    // door top / sill: thicker, slightly lighter lip catching light
    const sillTop = FRAME.sill + 10;
    const sg = ctx.createLinearGradient(0, sillTop, 0, sillTop + 40);
    sg.addColorStop(0, '#2a2b31');
    sg.addColorStop(0.18, '#222328');
    sg.addColorStop(1, '#141519');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.moveTo(0, sillTop + 4);
    ctx.quadraticCurveTo(VIEW.W / 2, sillTop - 2, VIEW.W, sillTop + 4);
    ctx.lineTo(VIEW.W, sillTop + 44);
    ctx.lineTo(0, sillTop + 44);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, sillTop + 5);
    ctx.quadraticCurveTo(VIEW.W / 2, sillTop - 1, VIEW.W, sillTop + 5);
    ctx.stroke();

    // armrest / door pull and lock knob
    ctx.fillStyle = '#121317';
    ctx.beginPath();
    ctx.moveTo(760, VIEW.H);
    ctx.bezierCurveTo(800, 676, 1040, 668, 1150, 684);
    ctx.lineTo(1170, VIEW.H);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.beginPath();
    ctx.moveTo(790, 694);
    ctx.bezierCurveTo(840, 678, 1040, 672, 1140, 688);
    ctx.stroke();
    // lock knob poking up out of the sill
    const kx = 1120;
    const kg = ctx.createLinearGradient(kx - 6, 0, kx + 6, 0);
    kg.addColorStop(0, '#3a3b42'); kg.addColorStop(0.5, '#5a5c64'); kg.addColorStop(1, '#2c2d33');
    ctx.fillStyle = kg;
    ctx.beginPath();
    ctx.moveTo(kx - 5, FRAME.sill + 16);
    ctx.lineTo(kx - 5, FRAME.sill + 2);
    ctx.quadraticCurveTo(kx, FRAME.sill - 6, kx + 5, FRAME.sill + 2);
    ctx.lineTo(kx + 5, FRAME.sill + 16);
    ctx.fill();
    // speaker grille, bottom-left
    ctx.fillStyle = '#101114';
    ctx.beginPath(); ctx.ellipse(170, 700, 120, 36, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    for (let x = 70; x < 270; x += 9) for (let y = 676; y < 720; y += 9) {
      const dx = (x - 170) / 120, dy = (y - 700) / 36;
      if (dx * dx + dy * dy < 1) { ctx.beginPath(); ctx.arc(x, y, 1.6, 0, TAU); ctx.fill(); }
    }

    // rubber window seal, following the glass edge
    ctx.save();
    ctx.beginPath();
    glassPath(ctx, -12);
    ctx.lineWidth = 12;
    ctx.strokeStyle = '#08080a';
    ctx.stroke();
    ctx.beginPath();
    glassPath(ctx, -7);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.stroke();
    ctx.beginPath();
    glassPath(ctx, -2);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#050506';
    ctx.stroke();
    ctx.restore();
    return c;
  }

  buildGlass(scale) {
    const { c, ctx } = makeCanvas(scale);
    ctx.save();
    ctx.beginPath();
    glassPath(ctx);
    ctx.clip();
    // diagonal reflection sheen
    ctx.save();
    ctx.translate(820, 200);
    ctx.rotate(-0.55);
    const sh = ctx.createLinearGradient(-160, 0, 160, 0);
    sh.addColorStop(0, 'rgba(255,255,255,0)');
    sh.addColorStop(0.35, 'rgba(255,255,255,0.045)');
    sh.addColorStop(0.5, 'rgba(255,255,255,0.075)');
    sh.addColorStop(0.62, 'rgba(255,255,255,0.03)');
    sh.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sh;
    ctx.fillRect(-160, -900, 320, 1800);
    const sh2 = ctx.createLinearGradient(190, 0, 240, 0);
    sh2.addColorStop(0, 'rgba(255,255,255,0)');
    sh2.addColorStop(0.5, 'rgba(255,255,255,0.04)');
    sh2.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sh2;
    ctx.fillRect(190, -900, 50, 1800);
    ctx.restore();
    // smudges: a palm-ish smear and a couple of fingerprints
    const r = new RNG(42);
    const smudge = (x, y, rx, ry, a) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, rx);
      g.addColorStop(0, `rgba(235,235,240,${a})`);
      g.addColorStop(1, 'rgba(235,235,240,0)');
      ctx.save();
      ctx.translate(x, y); ctx.scale(1, ry / rx); ctx.translate(-x, -y);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, rx, 0, TAU); ctx.fill();
      ctx.restore();
    };
    smudge(220, 470, 70, 40, 0.035);
    smudge(1040, 150, 26, 18, 0.05);
    for (let i = 0; i < 3; i++) {
      const fx = 1010 + i * 22 + r.float(-4, 4), fy = 190 + r.float(-6, 6);
      ctx.strokeStyle = 'rgba(235,235,240,0.035)';
      ctx.lineWidth = 0.8;
      for (let k = 1; k < 7; k++) { ctx.beginPath(); ctx.ellipse(fx, fy, k * 1.5, k * 2, 0.3, 0, TAU); ctx.stroke(); }
    }
    // vignette
    const vg = ctx.createRadialGradient(VIEW.W / 2, VIEW.H * 0.46, 260, VIEW.W / 2, VIEW.H * 0.46, 820);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.34)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, VIEW.W, VIEW.H);
    ctx.restore();
    return c;
  }

  drawGlass(ctx, scale) {
    if (this.scale !== scale) this.build(scale);
    ctx.drawImage(this.glass, 0, 0, VIEW.W, VIEW.H);
  }

  // ambient: 0..1 scene light; warm: 0..1 tunnel-lamp spill; bump: vertical frame shake (px)
  drawFrame(ctx, scale, ambient, warm = 0, bump = 0) {
    if (this.scale !== scale) this.build(scale);
    ctx.drawImage(this.frame, 0, bump, VIEW.W, VIEW.H);
    const dark = (1 - ambient) * 0.5;
    if (dark > 0.01) { ctx.globalAlpha = dark; ctx.drawImage(this.shade, 0, bump, VIEW.W, VIEW.H); ctx.globalAlpha = 1; }
    if (warm > 0.01) {
      ctx.globalAlpha = warm * 0.12;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(this.warm, 0, bump, VIEW.W, VIEW.H);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  }
}

export { rgb };
