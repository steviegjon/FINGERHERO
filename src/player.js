// The fingers: physics, states, hitboxes. Rendering lives in hand.js.
import { PLAYER, PHYSICS, FRAME } from './config.js';

// Player "state" values consumed by the hand renderer.
export const STATE = { RUN: 'run', JUMP: 'jump', FALL: 'fall', SLIDE: 'slide', LAND: 'land', DEAD: 'dead' };

export class Player {
  constructor() { this.reset(500); }

  reset(feetY) {
    this.x = PLAYER.x;
    this.y = feetY;           // feet position (bottom of hitbox)
    this.prevY = feetY;
    this.vy = 0;
    this.grounded = true;
    this.surface = null;
    this.coyote = 0;
    this.buffer = 0;
    this.holding = false;
    this.holdTime = 0;
    this.fastFall = false;
    this.sliding = false;
    this.h = PLAYER.h;
    this.landTimer = 0;
    this.airTime = 0;
    this.runPhase = 0;        // 0..1 run cycle
    this.squash = 0;          // >0 squash (landing), <0 stretch (takeoff)
    this.dead = false;
    this.deathKind = null;
    this.deathT = 0;
    this.lastLanding = null;  // {kind, bouncy} for fx/audio hooks
    this.events = [];         // queued events for fx/audio: {type, ...}
    this.visualY = feetY;     // used by death animations
    this.lean = 0;
  }

  get state() {
    if (this.dead) return STATE.DEAD;
    if (this.grounded) {
      if (this.sliding) return STATE.SLIDE;
      if (this.landTimer > 0) return STATE.LAND;
      return STATE.RUN;
    }
    return this.vy < 0 ? STATE.JUMP : STATE.FALL;
  }

  hurtbox() {
    const i = PLAYER.hurtInset;
    return { x: this.x - PLAYER.w / 2 + i, y: this.y - this.h + i, w: PLAYER.w - i * 2, h: this.h - i * 2 };
  }

  emit(type, data = {}) { this.events.push({ type, ...data }); }

  kill(kind) {
    if (this.dead) return;
    this.dead = true;
    this.deathKind = kind;
    this.deathT = 0;
    this.emit('death', { kind });
  }

  // world: { surfacesAt(x0, x1) -> [{surface, top}], speed, ceilingAt(x0,x1) }
  update(dt, input, pressed, world) {
    this.prevY = this.y;
    if (this.dead) {
      this.deathT += dt;
      if (this.deathKind === 'fall') { this.vy = Math.min(PHYSICS.maxFallSpeed, this.vy + PHYSICS.gravity * dt); this.y += this.vy * dt; }
      return;
    }

    if (pressed.jump) this.buffer = PHYSICS.jumpBuffer;
    else this.buffer = Math.max(0, this.buffer - dt);

    const fx0 = this.x - PLAYER.feetHalf, fx1 = this.x + PLAYER.feetHalf;

    // --- stay glued to the surface we're on (slopes, sagging wires, car profiles)
    if (this.grounded) {
      let top = this.surface ? this.surface.topBetween(fx0, fx1, world.D) : null;
      const ok = (t) => t != null && t - this.y <= PHYSICS.snapDown && this.y - t <= PHYSICS.snapUp;
      if (!ok(top)) {
        // hand over to an adjacent surface (wire -> pole cap -> wire, trailer -> cab, ...)
        top = null;
        for (const s of world.surfacesNear(fx0, fx1)) {
          const t = s.topBetween(fx0, fx1, world.D);
          if (ok(t) && (top == null || t < top)) { top = t; this.surface = s; }
        }
      }
      if (top != null) {
        this.y = top;
      } else {
        // walked off the edge
        this.grounded = false;
        this.coyote = PHYSICS.coyote;
        this.vy = 0;
        this.surface = null;
      }
    } else {
      this.coyote = Math.max(0, this.coyote - dt);
    }

    // --- slide / fast-fall
    const down = input.downHeld;
    if (this.grounded) {
      if (down && !this.sliding) { this.sliding = true; this.emit('slide'); }
      if (!down && this.sliding) this.sliding = false;
      this.fastFall = false;
    } else {
      this.sliding = false;
      if (down && !this.fastFall) {
        this.fastFall = true;
        if (this.vy < PHYSICS.fastFallMinVy) this.vy = PHYSICS.fastFallMinVy;
        this.holding = false;
      }
    }
    this.h = this.sliding ? PLAYER.slideH : PLAYER.h;

    // --- jump (buffered, coyote)
    if (this.buffer > 0 && (this.grounded || this.coyote > 0)) {
      this.jump(PHYSICS.jumpVel, true);
    }

    // --- variable jump height
    if (this.holding) {
      this.holdTime += dt;
      if (!input.jumpHeld && this.holdTime >= PHYSICS.minHold) {
        if (this.vy < 0) this.vy *= PHYSICS.jumpCutMul;
        this.holding = false;
      } else if (this.holdTime >= PHYSICS.maxHold) {
        this.holding = false;
      }
    }

    // --- airborne integration + landing
    if (!this.grounded) {
      this.airTime += dt;
      let g = PHYSICS.gravity;
      if (this.vy > 0) g *= PHYSICS.fallGravityMul;
      if (this.fastFall) g *= PHYSICS.fastFallGravityMul;
      this.vy = Math.min(PHYSICS.maxFallSpeed, this.vy + g * dt);
      const prevFeet = this.y;
      this.y += this.vy * dt;

      // window top limit
      const minTop = FRAME.top + PHYSICS.ceilingPad;
      if (this.y - this.h < minTop) { this.y = minTop + this.h; if (this.vy < 0) this.vy = 0; }

      if (this.vy >= 0) {
        // one-way platforms: land if we crossed a top edge this step
        let best = null;
        for (const s of world.surfacesNear(fx0, fx1)) {
          const top = s.topBetween(fx0, fx1, world.D);
          if (top == null) continue;
          if (prevFeet <= top + 3 && this.y >= top) {
            if (!best || top < best.top) best = { s, top };
          }
        }
        if (best) this.land(best.s, best.top, input);
      }
    } else {
      this.airTime = 0;
      this.runPhase = (this.runPhase + dt * world.speed / 150) % 1;
    }

    // --- timers / juice
    this.landTimer = Math.max(0, this.landTimer - dt);
    this.squash *= Math.pow(0.0008, dt);
    if (Math.abs(this.squash) < 0.01) this.squash = 0;
    // footfall events for audio (two per cycle)
    if (this.grounded && !this.sliding) {
      const ph = this.runPhase;
      const prev = this._lastPhase ?? ph;
      if ((prev < 0.25 && ph >= 0.25) || (prev < 0.75 && ph >= 0.75)) this.emit('step', { surface: this.surface });
      this._lastPhase = ph;
    } else this._lastPhase = this.runPhase;
  }

  jump(vel, holdable, bounce = false) {
    this.vy = -vel;
    this.grounded = false;
    this.surface = null;
    this.coyote = 0;
    this.buffer = 0;
    this.holding = holdable;
    this.holdTime = 0;
    this.fastFall = false;
    this.sliding = false;
    this.squash = -0.22;
    this.emit('jump', { vel, bounce });
  }

  land(surface, top, input) {
    this.y = top;
    const impact = this.vy;
    this.vy = 0;
    this.grounded = true;
    this.surface = surface;
    this.holding = false;
    this.fastFall = false;
    this.landTimer = 0.12;
    this.squash = Math.min(0.35, 0.1 + impact / 3000);
    this.emit('land', { surface, impact });
    if (surface.bouncy) {
      const mul = input.jumpHeld ? PHYSICS.bounceHoldMul : PHYSICS.bounceMul;
      this.jump(PHYSICS.jumpVel * mul, false, true);
      this.emit('bounce', { surface });
    } else if (this.buffer > 0) {
      this.jump(PHYSICS.jumpVel, true);
    }
  }
}

// ---------------------------------------------------------------------------
// Jump arc simulation, used by the generator's reachability guarantee.
// Returns samples [{t, dy}] for a full-hold jump (dy < 0 = above takeoff),
// simulated with the exact same integration as Player.update.
export function simulateArc(launchVel = PHYSICS.jumpVel, holdable = true, maxT = 3) {
  const dt = PHYSICS.step;
  let vy = -launchVel, y = 0, t = 0, hold = holdable ? 0 : Infinity;
  const out = [{ t: 0, dy: 0 }];
  while (t < maxT) {
    hold += dt;
    let g = PHYSICS.gravity;
    if (vy > 0) g *= PHYSICS.fallGravityMul;
    vy = Math.min(PHYSICS.maxFallSpeed, vy + g * dt);
    y += vy * dt;
    t += dt;
    out.push({ t, dy: y });
    if (y > 700) break;
  }
  return out;
}

const ARC_CACHE = new Map();
function arcFor(mul) {
  if (!ARC_CACHE.has(mul)) ARC_CACHE.set(mul, simulateArc(PHYSICS.jumpVel * mul));
  return ARC_CACHE.get(mul);
}

export function jumpApex(mul = 1) {
  let m = 0;
  for (const p of arcFor(mul)) m = Math.min(m, p.dy);
  return -m; // positive height
}

// Latest time at which a full jump's feet come down through height dy (relative to takeoff,
// dy<0 means the target is higher). Returns 0 if unreachable.
export function airtimeTo(dy, mul = 1) {
  const arc = arcFor(mul);
  let apexI = 0;
  for (let i = 1; i < arc.length; i++) if (arc[i].dy < arc[apexI].dy) apexI = i;
  if (arc[apexI].dy > dy) return 0; // can't get that high
  for (let i = apexI; i < arc.length - 1; i++) {
    if (arc[i + 1].dy >= dy) {
      const a = arc[i], b = arc[i + 1];
      const f = (dy - a.dy) / (b.dy - a.dy || 1);
      return a.t + (b.t - a.t) * f;
    }
  }
  return arc[arc.length - 1].t;
}

// How long a full jump stays at least `h` px above takeoff height.
export function timeAbove(h, mul = 1) {
  const arc = arcFor(mul);
  let t0 = null, t1 = null;
  for (const p of arc) {
    if (-p.dy >= h) { if (t0 == null) t0 = p.t; t1 = p.t; }
  }
  return t0 == null ? { t0: 0, t1: 0, dur: 0 } : { t0, t1, dur: t1 - t0 };
}
