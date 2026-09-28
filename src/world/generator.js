// Milestone 1 stub: grey blocks with modest gaps so the jump feel can be tuned.
import { Surface } from './entities.js';
import { RNG } from '../util.js';

export class Generator {
  constructor(seed) {
    this.rng = new RNG(seed);
    this.cursorD = 0;
    this.lastTop = 500;
  }
  attach(world) { this.world = world; }

  // A safe flat start under the fingers. Returns its top y.
  startRunway(world) {
    const top = 500;
    world.add(new Surface({ kind: 'block', dLead: world.D - 400, w: 1400, top }));
    this.cursorD = world.D + 1000 + 150;
    this.lastTop = top;
    return top;
  }

  fill(untilD) {
    const r = this.rng;
    while (this.cursorD < untilD) {
      const w = r.float(260, 620);
      const top = Math.max(380, Math.min(560, this.lastTop + r.float(-70, 70)));
      this.world.add(new Surface({ kind: 'block', dLead: this.cursorD, w, top }));
      this.cursorD += w + r.float(90, 210);
      this.lastTop = top;
    }
  }
}
