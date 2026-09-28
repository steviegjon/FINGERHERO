// Title: "FINGER HERO" finger-written in window condensation. A soft fog patch is rendered once;
// the letters are wiped out of it with soft round strokes (written progressively), with a few drips.
import { VIEW, FRAME } from '../config.js';
import { RNG, TAU, clamp, noise1 } from '../util.js';
import { glassPath } from './window.js';

// Letter strokes in a unit box (x right, y down). Each letter: width + list of polylines.
function arc(cx, cy, rx, ry, a0, a1, n = 18) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
  return pts;
}
const LETTERS = {
  F: { w: 0.62, s: [[[0.06, 1], [0.02, 0]], [[0.02, 0], [0.62, 0.02]], [[0.04, 0.47], [0.5, 0.48]]] },
  I: { w: 0.22, s: [[[0.1, 0], [0.11, 1]]] },
  N: { w: 0.7, s: [[[0.02, 1], [0.03, 0], [0.66, 1], [0.68, -0.02]]] },
  G: { w: 0.78, s: [arc(0.4, 0.5, 0.38, 0.5, -0.75, -5.65).concat([[0.76, 0.56], [0.46, 0.56]])] },
  E: { w: 0.6, s: [[[0.6, 0.01], [0.03, 0], [0.02, 1], [0.6, 0.99]], [[0.03, 0.5], [0.48, 0.5]]] },
  R: { w: 0.66, s: [[[0.03, 1], [0.02, 0]].concat(arc(0.3, 0.25, 0.3, 0.25, -Math.PI / 2, Math.PI / 2)).concat([[0.03, 0.5]]), [[0.26, 0.5], [0.66, 1]]] },
  H: { w: 0.66, s: [[[0.03, 0], [0.02, 1]], [[0.64, 0], [0.65, 1]], [[0.03, 0.52], [0.64, 0.5]]] },
  O: { w: 0.8, s: [arc(0.4, 0.5, 0.4, 0.5, -Math.PI / 2 - 0.3, Math.PI * 1.5 + 0.1, 28)] },
};

function layoutTitle() {
  const r = new RNG(1977);
  const lines = [{ text: 'FINGER', size: 104, y: 150 }, { text: 'HERO', size: 128, y: 292 }];
  const strokes = []; // [{pts:[[x,y]...], len}]
  for (const line of lines) {
    const gap = 0.26;
    const total = [...line.text].reduce((a, ch) => a + LETTERS[ch].w + gap, -gap) * line.size;
    let x = VIEW.W / 2 - total / 2;
    for (const ch of line.text) {
      const L = LETTERS[ch];
      const rot = r.float(-0.06, 0.06), dy = r.float(-6, 6), sc = r.float(0.94, 1.06);
      const cx = x + (L.w * line.size) / 2, cy = line.y + line.size / 2;
      for (const s of L.s) {
        const pts = s.map(([u, v], i) => {
          let px = x + u * line.size, py = line.y + v * line.size * sc + dy;
          // tilt the letter a touch and add finger wobble
          const ox = px - cx, oy = py - cy;
          px = cx + ox * Math.cos(rot) - oy * Math.sin(rot) + (noise1(i * 1.7 + x) - 0.5) * 4;
          py = cy + ox * Math.sin(rot) + oy * Math.cos(rot) + (noise1(i * 2.3 + x + 9) - 0.5) * 4;
          return [px, py];
        });
        // resample so progressive drawing is smooth
        const dense = [];
        for (let i = 0; i < pts.length - 1; i++) {
          const [a, b] = [pts[i], pts[i + 1]];
          const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 6));
          for (let k = 0; k < n; k++) dense.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
        }
        dense.push(pts[pts.length - 1]);
        let len = 0;
        for (let i = 1; i < dense.length; i++) len += Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]);
        strokes.push({ pts: dense, len });
      }
      x += (L.w + gap) * line.size;
    }
  }
  // drips from the lowest points of some strokes
  const drips = [];
  for (const s of strokes) {
    if (r.chance(0.45)) {
      let low = s.pts[0];
      for (const p of s.pts) if (p[1] > low[1]) low = p;
      drips.push({ x: low[0] + r.float(-3, 3), y: low[1] + 4, len: r.float(14, 60), w: r.float(2.5, 4.5), delay: r.float(0.2, 1.6) });
    }
  }
  return { strokes, drips, total: strokes.reduce((a, s) => a + s.len, 0) };
}

export class FogTitle {
  constructor() {
    this.layout = layoutTitle();
    this.scale = 0;
    this.writeT = 0;
    this.alpha = 1;
  }

  build(scale) {
    this.scale = scale;
    const mk = () => {
      const c = document.createElement('canvas');
      c.width = Math.round(VIEW.W * scale); c.height = Math.round(VIEW.H * scale);
      const ctx = c.getContext('2d');
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      return { c, ctx };
    };
    // fog base: many soft blobs, densest around the title, clipped to the glass
    const base = mk();
    const r = new RNG(5);
    base.ctx.save();
    base.ctx.beginPath(); glassPath(base.ctx); base.ctx.clip();
    const blob = (x, y, rad, a) => {
      const g = base.ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, `rgba(232,236,240,${a})`);
      g.addColorStop(1, 'rgba(232,236,240,0)');
      base.ctx.fillStyle = g;
      base.ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    };
    for (let i = 0; i < 90; i++) {
      const x = VIEW.W / 2 + r.float(-470, 470), y = 280 + r.float(-190, 170);
      const fall = 1 - Math.min(1, Math.hypot((x - VIEW.W / 2) / 560, (y - 280) / 260));
      blob(x, y, r.float(90, 200), (0.09 + 0.15 * fall).toFixed(3));
    }
    // fine droplets texture
    for (let i = 0; i < 1400; i++) {
      const x = VIEW.W / 2 + r.float(-520, 520), y = 280 + r.float(-230, 210);
      const d = Math.hypot((x - VIEW.W / 2) / 540, (y - 280) / 240);
      if (d > 1) continue;
      base.ctx.fillStyle = `rgba(255,255,255,${(0.05 + 0.1 * (1 - d)).toFixed(3)})`;
      base.ctx.beginPath(); base.ctx.arc(x, y, r.float(0.6, 1.8), 0, TAU); base.ctx.fill();
    }
    base.ctx.restore();
    this.base = base.c;
    this.work = mk();
  }

  // Wipe the letters out of a copy of the base, up to `progress` of the total stroke length.
  compose(progress, t) {
    const ctx = this.work.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.work.c.width, this.work.c.height);
    ctx.drawImage(this.base, 0, 0);
    ctx.restore();
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    let budget = progress * this.layout.total;
    const passes = [[26, 0.18], [21, 0.35], [16, 0.7], [12, 1]];
    const partial = [];
    for (const s of this.layout.strokes) {
      if (budget <= 0) break;
      let pts = s.pts;
      if (budget < s.len) {
        let acc = 0; const cut = [pts[0]];
        for (let i = 1; i < pts.length; i++) {
          const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
          if (acc + d > budget) break;
          acc += d; cut.push(pts[i]);
        }
        pts = cut;
      }
      budget -= s.len;
      partial.push(pts);
    }
    for (const [w, a] of passes) {
      ctx.lineWidth = w;
      ctx.strokeStyle = `rgba(0,0,0,${a})`;
      for (const pts of partial) {
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.1, pts[0][1]);
        ctx.stroke();
      }
    }
    // drips run once the writing is done
    if (progress >= 1) {
      for (const d of this.layout.drips) {
        const k = clamp((t - d.delay) / 2.5, 0, 1);
        if (k <= 0) continue;
        const len = d.len * (1 - Math.pow(1 - k, 2));
        ctx.lineWidth = d.w;
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + 0.5, d.y + len); ctx.stroke();
        ctx.beginPath(); ctx.arc(d.x + 0.5, d.y + len, d.w * 0.8, 0, TAU); ctx.fillStyle = 'rgba(0,0,0,0.9)'; ctx.fill();
      }
    }
    ctx.restore();
  }

  update(dt, writing) {
    if (writing) this.writeT += dt;
  }

  draw(ctx, scale, t, alpha) {
    if (alpha <= 0.001) return;
    if (this.scale !== scale) this.build(scale);
    const progress = clamp(this.writeT / 2.2, 0, 1);
    // keep composing while the letters are written or the drips run
    if (progress < 1 || this.writeT < 2.2 + 4.5 || !this.composed) {
      this.compose(progress, Math.max(0, this.writeT - 2.2));
      this.composed = progress >= 1 && this.writeT >= 2.2 + 4.5;
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    const grow = 1 + (1 - alpha) * 0.04;
    ctx.translate(VIEW.W / 2, 300);
    ctx.scale(grow, grow);
    ctx.translate(-VIEW.W / 2, -300);
    ctx.drawImage(this.work.c, 0, 0, VIEW.W, VIEW.H);
    ctx.restore();
  }
}

export { FRAME };
