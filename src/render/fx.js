// Particles (dust, wire sparks, leaves), bug splats on the glass, speed streaks.
import { VIEW, FRAME } from '../config.js';
import { RNG, rgb, TAU, clamp } from '../util.js';

export class FX {
  constructor() {
    this.particles = [];
    this.splats = [];
    this.rng = new RNG(1234);
    this.flash = 0;       // white flash (tunnel exit)
    this.shake = 0;
  }

  reset() { this.particles.length = 0; this.splats.length = 0; this.flash = 0; this.shake = 0; }

  // world-space particles scroll with the world (vx is additionally -speed*k)
  burst(kind, x, y, n, o = {}) {
    const r = this.rng;
    for (let i = 0; i < n; i++) {
      const p = { kind, x, y, life: 0, max: r.float(0.3, 0.6), k: o.k ?? 1 };
      if (kind === 'dust') {
        Object.assign(p, { vx: r.float(-60, 70), vy: r.float(-90, -20), size: r.float(2.5, 5.5), max: r.float(0.3, 0.55), color: o.color ?? '#d9cdb2' });
      } else if (kind === 'spark') {
        Object.assign(p, { vx: r.float(-120, 160), vy: r.float(-220, -40), size: r.float(1, 2), max: r.float(0.15, 0.35), color: r.pick(['#fff4c2', '#ffd36b', '#ffb03b']), g: 900 });
      } else if (kind === 'leaf') {
        Object.assign(p, { vx: r.float(-80, 120), vy: r.float(-260, -80), size: r.float(3, 6), max: r.float(0.6, 1.1), color: o.color ?? r.pick(['#5f7a3a', '#7c9446', '#4b6330']), g: 500, spin: r.float(-8, 8), rot: r.float(0, 6) });
      } else if (kind === 'feather') {
        Object.assign(p, { vx: r.float(-60, 60), vy: r.float(-120, 0), size: r.float(3, 5), max: r.float(0.6, 1.0), color: o.color ?? '#cfd2d6', g: 120, spin: r.float(-5, 5), rot: r.float(0, 6) });
      } else if (kind === 'chip') {
        Object.assign(p, { vx: r.float(-100, 100), vy: r.float(-200, -60), size: r.float(2, 4), max: r.float(0.4, 0.7), color: o.color ?? '#9a8f80', g: 1200 });
      }
      this.particles.push(p);
    }
  }

  // A bug hits the glass: a small smear that stays until restart.
  splat(x, y, variant) {
    const r = this.rng;
    const big = variant === 'dragonfly' || variant === 'beetle';
    const color = variant === 'beetle' ? '#6b7a2c' : variant === 'dragonfly' ? '#8aa35a' : r.pick(['#c8b86a', '#a9a45a', '#b59d52']);
    const blobs = [];
    const n = big ? 11 : 7;
    for (let i = 0; i < n; i++) {
      const a = r.float(0, TAU), d = r.float(0, big ? 16 : 10);
      blobs.push({ dx: Math.cos(a) * d, dy: Math.sin(a) * d * 0.8, r: r.float(big ? 3 : 2, big ? 8 : 5) });
    }
    const drips = [];
    for (let i = 0; i < (big ? 3 : 2); i++) drips.push({ dx: r.float(-8, 8), len: r.float(10, 34), w: r.float(1.2, 2.4) });
    const streak = { a: r.float(-0.25, 0.1), len: r.float(28, 60) }; // wind smears it back
    this.splats.push({ x, y, color, blobs, drips, streak, t: 0, big });
  }

  update(dt, worldSpeed) {
    for (const p of this.particles) {
      p.life += dt;
      p.vy += (p.g ?? 160) * dt;
      p.x += (p.vx - worldSpeed * p.k * 0.9) * dt;
      p.y += p.vy * dt;
      if (p.spin) p.rot += p.spin * dt;
    }
    this.particles = this.particles.filter((p) => p.life < p.max);
    for (const s of this.splats) s.t += dt;
    this.flash = Math.max(0, this.flash - dt * 1.6);
    this.shake = Math.max(0, this.shake - dt * 3);
  }

  drawParticles(ctx) {
    for (const p of this.particles) {
      const a = 1 - p.life / p.max;
      ctx.fillStyle = rgb(p.color, clamp(a, 0, 1));
      if (p.kind === 'leaf' || p.kind === 'feather') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size, p.size * 0.45, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      } else if (p.kind === 'spark') {
        ctx.fillRect(p.x, p.y, p.size * 2.5, p.size);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.6 + 0.6 * (p.life / p.max)), 0, TAU);
        ctx.fill();
      }
    }
  }

  // drawn on the glass (not affected by world bob)
  drawSplats(ctx) {
    for (const s of this.splats) {
      const grow = clamp(s.t / 0.06, 0, 1);
      ctx.save();
      ctx.translate(s.x, s.y);
      // wind smear
      ctx.rotate(s.streak.a);
      const sg = ctx.createLinearGradient(0, 0, -s.streak.len, 0);
      sg.addColorStop(0, rgb(s.color, 0.55));
      sg.addColorStop(1, rgb(s.color, 0));
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.ellipse(-s.streak.len / 2, 0, (s.streak.len / 2) * grow, (s.big ? 6 : 4) * grow, 0, 0, TAU);
      ctx.fill();
      ctx.rotate(-s.streak.a);
      ctx.fillStyle = rgb(s.color, 0.85);
      for (const b of s.blobs) {
        ctx.beginPath();
        ctx.arc(b.dx * grow, b.dy * grow, b.r * grow, 0, TAU);
        ctx.fill();
      }
      // drips run down slowly
      const run = clamp(s.t / 3, 0, 1);
      ctx.strokeStyle = rgb(s.color, 0.7);
      ctx.lineCap = 'round';
      for (const d of s.drips) {
        ctx.lineWidth = d.w;
        ctx.beginPath();
        ctx.moveTo(d.dx, 2);
        ctx.lineTo(d.dx, 2 + d.len * run);
        ctx.stroke();
      }
      // guts highlight
      ctx.fillStyle = 'rgba(255,255,240,0.35)';
      ctx.beginPath();
      ctx.arc(-2, -2, s.big ? 3 : 2, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  drawFlash(ctx) {
    if (this.flash <= 0) return;
    ctx.fillStyle = `rgba(255,250,235,${Math.min(1, this.flash)})`;
    ctx.fillRect(FRAME.left, FRAME.top, FRAME.right - FRAME.left, FRAME.sill - FRAME.top);
  }
}
