// Hazard entities. Each exposes boxes(D, t) in screen space; contact = instant fail.
import { Hazard } from './entities.js';
import { PLAYER, VIEW } from '../config.js';
import { TAU, clamp } from '../util.js';

export class Bug extends Hazard {
  constructor(o) {
    super({ ...o, deathKind: 'bug' });
    this.variant = o.variant;       // gnat | fly | dragonfly | beetle | pigeon
    this.baseY = o.baseY;
    this.amp = o.amp;
    this.freq = o.freq;
    this.phase = o.phase;
    if (o.variant === 'pigeon') this.deathKind = 'hit';
  }
  yAt(t) { return this.baseY + this.amp * Math.sin(this.freq * TAU * t + this.phase); }
  boxes(D, t) {
    const y = this.yAt(t);
    return [{ x: this.left(D), y: y - this.h / 2, w: this.w, h: this.h }];
  }
}

export class Sign extends Hazard {
  constructor(o) {
    super({ ...o, deathKind: 'hit' });
    this.def = o.def;               // SIGNS entry
    this.panelTop = o.panelTop;
    this.panelBottom = o.panelBottom;
    this.big = !!o.big;
  }
  boxes(D) {
    return [{ x: this.left(D), y: this.panelTop, w: this.w, h: this.panelBottom - this.panelTop }];
  }
}

// Perched on a wire until the fingers get close, bobs its head (telegraph), then flutters up to
// head height, hovering (flying "backwards" relative to the car) until it has passed, then leaves.
export class Bird extends Hazard {
  constructor(o) {
    super({ ...o, deathKind: 'hit' });
    this.perchY = o.perchY;
    this.hoverY = o.hoverY;
    this.y = o.perchY;
    this.mode = 'perched';
    this.modeT = 0;
    this.dx = 0;
    this.flap = 0;
    this.pigeonish = !!o.pigeonish;
  }
  update(dt, world) {
    this.modeT += dt;
    this.flap += dt;
    const x = this.left(world.D);
    const trig = Math.max(VIEW.W / 3 * 1.5, world.speed * 1.15);
    if (this.mode === 'perched') {
      if (world.playing && x - PLAYER.x < trig) { this.mode = 'bob'; this.modeT = 0; this.emitted = false; }
    } else if (this.mode === 'bob') {
      if (this.modeT > 0.36) { this.mode = 'fly'; this.modeT = 0; world.onEvent?.('birdTakeoff', this); }
    } else if (this.mode === 'fly') {
      this.y += (this.hoverY - this.y) * clamp(dt * 9, 0, 1);
      if (x + this.w < PLAYER.x - 30) { this.mode = 'away'; this.modeT = 0; }
    } else {
      this.y -= 240 * dt * Math.min(1, this.modeT * 3);
      this.dx -= 160 * dt;
    }
  }
  left(D) { return super.left(D) + this.dx; }
  // Stateless prediction for planners (tools/bot.mjs): hovering once close, perched before.
  predictBoxes(D) {
    const x = super.left(D);
    if (this.mode === 'away') return this.boxes(D);
    if (x - PLAYER.x < 700) return [{ x, y: this.hoverY - 7, w: this.w, h: 14 }];
    return [{ x: x + 4, y: this.perchY - 14, w: this.w - 8, h: 14 }];
  }
  boxes(D) {
    if (this.mode === 'perched' || this.mode === 'bob') return [{ x: this.left(D) + 4, y: this.y - 14, w: this.w - 8, h: 14 }];
    return [{ x: this.left(D), y: this.y - 7, w: this.w, h: 14 }];
  }
}

// Overpass / low bridge deck. Must slide.
export class Overpass extends Hazard {
  constructor(o) {
    super({ ...o, deathKind: 'hit' });
    this.ceil = o.ceil;              // underside y
    this.deckH = o.deckH ?? 70;
    this.style = o.style ?? 'concrete';
  }
  boxes(D) { return [{ x: this.left(D), y: this.ceil - this.deckH, w: this.w, h: this.deckH }]; }
}

// Chimney face (the top is a standable Surface).
export class Chimney extends Hazard {
  constructor(o) { super({ ...o, deathKind: 'hit' }); this.top = o.top; this.base = o.base; }
  boxes(D) { return [{ x: this.left(D), y: this.top + 6, w: this.w, h: this.base - this.top - 6 }]; }
}

// Tunnel hazards: hanging cable (slide) and floor vent (hop).
export class Cable extends Hazard {
  constructor(o) { super({ ...o, deathKind: 'hit' }); this.bottom = o.bottom; this.ceilY = o.ceilY; }
  boxes(D) { return [{ x: this.left(D), y: this.ceilY, w: this.w, h: this.bottom - this.ceilY }]; }
}
export class Vent extends Hazard {
  constructor(o) { super({ ...o, deathKind: 'hit' }); this.top = o.top; this.base = o.base; }
  boxes(D) { return [{ x: this.left(D), y: this.top, w: this.w, h: this.base - this.top }]; }
}
