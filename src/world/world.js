// World state: the D axis, speed, active/pending entities. Rendering-agnostic.
import { VIEW, GEN, SPEED, PLAYER } from '../config.js';
import { Surface, Hazard, Decor } from './entities.js';

export class World {
  constructor(generator) {
    this.gen = generator;
    this.D = 0;
    this.prevD = 0;
    this.time = 0;        // seconds since world creation
    this.runTime = 0;     // seconds since the run started (0 in attract)
    this.speed = SPEED.attract;
    this.speedOverride = null;
    this.surfaces = [];
    this.hazards = [];
    this.decor = [];
    this.pending = [];
    this.spawned = [];    // entities spawned this step (for fx/audio hooks)
    this.gen.attach(this);
  }

  add(e) {
    const spawnX = VIEW.W + GEN.spawnMargin;
    // D at which the entity's left edge is at spawnX
    e.spawnD = e.dLead - (spawnX - PLAYER.x) / e.k;
    if (e.spawnD <= this.D) this._activate(e);
    else this.pending.push(e);
  }

  _activate(e) {
    if (e instanceof Surface) this.surfaces.push(e);
    else if (e instanceof Hazard) this.hazards.push(e);
    else this.decor.push(e);
    this.spawned.push(e);
  }

  update(dt, targetSpeed) {
    this.prevD = this.D;
    this.speed = this.speedOverride ?? targetSpeed;
    this.D += this.speed * dt;
    this.time += dt;
    this.spawned.length = 0;

    this.gen.fill(this.D + GEN.lookahead);

    if (this.pending.length) {
      const keep = [];
      for (const e of this.pending) {
        if (e.spawnD <= this.D) this._activate(e); else keep.push(e);
      }
      this.pending = keep;
    }

    const cull = (arr) => {
      let j = 0;
      for (let i = 0; i < arr.length; i++) {
        const e = arr[i];
        if (e.dead || e.right(this.D) < -GEN.despawnMargin) continue;
        arr[j++] = e;
      }
      arr.length = j;
    };
    cull(this.surfaces); cull(this.hazards); cull(this.decor);
    for (const h of this.hazards) h.update(dt, this);
    for (const d of this.decor) d.update?.(dt, this);
  }

  surfacesNear(x0, x1) {
    const out = [];
    for (const s of this.surfaces) {
      const L = s.left(this.D);
      if (L <= x1 && L + s.w >= x0) out.push(s);
    }
    return out;
  }
}
