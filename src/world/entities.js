// Play-lane entity base classes.
//
// Positions live on the "D axis": D is the distance the world has scrolled past the fingers.
// An entity with speed factor k (1 = static scenery, <1 = a vehicle we are overtaking) whose
// leading edge reaches the fingers when the world has scrolled dLead has screen x:
//     left(D) = PLAYER.x + k * (dLead - D)
// This is exact regardless of speed changes, so the generator can reason about gaps purely in D:
// a surface occupies [dLead, dLead + w/k] at the fingers, and a jump of airtime τ covers ≈ speed·τ of D.
import { PLAYER } from '../config.js';

export class Entity {
  constructor(o) {
    this.k = o.k ?? 1;
    this.dLead = o.dLead;
    this.w = o.w;
    this.kind = o.kind;
    this.biome = o.biome;
    this.seed = o.seed ?? 0;
    this.spawnD = null; // set by the world
  }
  left(D) { return PLAYER.x + this.k * (this.dLead - D); }
  right(D) { return this.left(D) + this.w; }
  get dTail() { return this.dLead + this.w / this.k; }
}

// A standable surface. `profile` is a list of [localX, topY] points (piecewise linear, localX ascending).
export class Surface extends Entity {
  constructor(o) {
    super(o);
    this.profile = o.profile ?? [[0, o.top], [o.w, o.top]];
    this.bouncy = !!o.bouncy;
    this.material = o.material ?? 'hard'; // hard | wire | tree | metal
    this.top = Math.min(...this.profile.map((p) => p[1]));
    this.draw = o.draw ?? null;             // optional custom renderer key
    this.data = o.data ?? {};
    this.parent = o.parent ?? null;          // visual owner (building, car, ...)
  }

  topAtLocal(lx) {
    const p = this.profile;
    if (lx <= p[0][0]) return p[0][1];
    for (let i = 1; i < p.length; i++) {
      if (lx <= p[i][0]) {
        const a = p[i - 1], b = p[i];
        const f = (lx - a[0]) / (b[0] - a[0] || 1);
        return a[1] + (b[1] - a[1]) * f;
      }
    }
    return p[p.length - 1][1];
  }

  // Highest top (smallest y) under the screen-x span [x0, x1], or null if not overlapping.
  topBetween(x0, x1, D) {
    const L = this.left(D);
    const a = Math.max(x0, L), b = Math.min(x1, L + this.w);
    if (a > b) return null;
    const m = (a + b) / 2;
    return Math.min(this.topAtLocal(a - L), this.topAtLocal(b - L), this.topAtLocal(m - L));
  }
}

// Something that kills on contact. Subclasses (world/hazards.js) override boxes() and update().
export class Hazard extends Entity {
  constructor(o) {
    super(o);
    this.deathKind = o.deathKind ?? 'hit'; // 'bug' | 'hit'
    this.y = o.y ?? 0;
    this.h = o.h ?? 0;
  }
  update(dt, world) {}
  // Hitboxes in screen space for the given D / time.
  boxes(D, t) { return [{ x: this.left(D), y: this.y, w: this.w, h: this.h }]; }
}

// Non-interactive play-lane dressing (poles, building bodies, sign posts, tunnel walls...).
export class Decor extends Entity {
  constructor(o) {
    super(o);
    this.data = o.data ?? {};
    this.z = o.z ?? 0;
  }
}
