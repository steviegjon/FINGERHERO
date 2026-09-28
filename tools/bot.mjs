// node tools/bot.mjs [seeds=10] [seconds=240] [--pattern=id]
// A planning autopilot that plays real runs headless, using the game's own physics, generator and
// collision code. It searches short action plans (wait → jump/slide → optional second action) and
// picks one that survives the look-ahead. If the bot dies, the situation is reported with context:
// that's a strong signal of an unfair (or buggy) layout.
import { World } from '../src/world/world.js';
import { Generator } from '../src/world/generator.js';
import { Player } from '../src/player.js';
import { PHYSICS, PLAYER, FRAME } from '../src/config.js';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const seeds = +(args[0] ?? 10), seconds = +(args[1] ?? 240);
const dt = PHYSICS.step;
const HORIZON = 1.25;
const DECIDE_EVERY = 3; // steps

function clonePlayer(p) {
  const q = Object.create(Player.prototype);
  Object.assign(q, p);
  q.events = [];
  return q;
}

// Actions over time: returns {jumpHeld, downHeld} at time t within the plan.
function planInput(plan, t) {
  let jump = false, down = false;
  for (const a of plan) {
    if (t >= a.at && t < a.at + a.dur) { if (a.type === 'jump') jump = true; else down = true; }
  }
  return { jumpHeld: jump, downHeld: down };
}

const PLANS = (() => {
  const plans = [[]];
  const delays = [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.65, 0.8];
  const firsts = [
    { type: 'jump', dur: 0.08 }, { type: 'jump', dur: 0.16 }, { type: 'jump', dur: 0.34 },
    { type: 'down', dur: 0.5 }, { type: 'down', dur: 1.1 },
  ];
  for (const d of delays) for (const f of firsts) plans.push([{ ...f, at: d }]);
  // two-step combos: jump then (fast-fall | jump again (buffer/bounce) | slide on landing)
  const seconds2 = [{ type: 'down', dur: 0.25 }, { type: 'jump', dur: 0.34 }, { type: 'down', dur: 0.9 }];
  for (const d of [0, 0.05, 0.1, 0.2, 0.3, 0.45]) for (const f of [firsts[1], firsts[2]]) {
    for (const g of seconds2) for (const d2 of [0.25, 0.4, 0.55, 0.7]) plans.push([{ ...f, at: d }, { ...g, at: d + d2 }]);
  }
  return plans;
})();

function simulate(player, world, plan, entities) {
  const p = clonePlayer(player);
  let D = world.D, t = world.time;
  let prevJump = player._botPrevJump ?? false;
  const fake = {
    D, speed: world.speed,
    surfacesNear(x0, x1) {
      const out = [];
      for (const s of entities.surfaces) { const L = s.left(this.D); if (L <= x1 && L + s.w >= x0) out.push(s); }
      return out;
    },
  };
  const steps = Math.round(HORIZON / dt);
  for (let i = 0; i < steps; i++) {
    const tt = i * dt;
    const inp = planInput(plan, tt);
    const pressed = { jump: inp.jumpHeld && !prevJump };
    prevJump = inp.jumpHeld;
    // the real loop has already advanced the world for the current step, so only advance after step 0
    if (i > 0) { fake.speed = world.gen.speedAt(D); D += fake.speed * dt; t += dt; fake.D = D; }
    p.update(dt, inp, pressed, fake);
    if (p.y - 20 > FRAME.sill) return tt;
    const hb = p.hurtbox();
    for (const h of entities.hazards) {
      const boxes = h.predictBoxes ? h.predictBoxes(D) : h.boxes(D, t);
      for (const b of boxes) if (b.x < hb.x + hb.w && b.x + b.w > hb.x && b.y < hb.y + hb.h && b.y + b.h > hb.y) return tt;
    }
  }
  return HORIZON;
}

function runSeed(seed) {
  const gen = new Generator(seed);
  if (flags.pattern) gen.forcePattern = flags.pattern;
  const world = new World(gen);
  world.playing = true;
  gen.startRunway(world);
  world.update(0, gen.speedAt(world.D));
  const player = new Player();
  const x0 = PLAYER.x - PLAYER.feetHalf, x1 = PLAYER.x + PLAYER.feetHalf;
  let best = null;
  for (const s of world.surfacesNear(x0, x1)) { const top = s.topBetween(x0, x1, world.D); if (top != null && (!best || top < best.top)) best = { s, top }; }
  player.reset(best.top); player.surface = best.s;

  let plan = [], planT = 0, prevJump = false;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    world.update(dt, gen.speedAt(world.D));
    if (i % DECIDE_EVERY === 0) {
      const entities = {
        surfaces: world.surfaces.concat(world.pending.filter((e) => e.profile)),
        hazards: world.hazards.concat(world.pending.filter((e) => e.boxes && !e.profile)),
      };
      // keep the current plan if it still survives; otherwise search
      const shifted = plan.map((a) => ({ ...a, at: a.at - planT })).filter((a) => a.at + a.dur > 0);
      player._botPrevJump = prevJump;
      let chosen = null;
      if (simulate(player, world, shifted, entities) >= HORIZON) chosen = shifted;
      else {
        let bestT = -1;
        for (const cand of PLANS) {
          const st = simulate(player, world, cand, entities);
          if (st > bestT) { bestT = st; chosen = cand; }
          if (st >= HORIZON) break;
        }
      }
      if (flags.trace && world.D > +flags.trace - 600 && world.D < +flags.trace + 100) {
        console.log(`D ${world.D.toFixed(0)} y ${player.y.toFixed(1)} g ${player.grounded} vy ${player.vy.toFixed(0)} surf ${player.surface?.kind} plan ${JSON.stringify(chosen)} surv ${simulate(player, world, chosen, entities).toFixed(2)}`);
      }
      plan = chosen; planT = 0;
    }
    const inp = planInput(plan, planT);
    const pressed = { jump: inp.jumpHeld && !prevJump };
    prevJump = inp.jumpHeld;
    planT += dt;
    player.update(dt, inp, pressed, world);
    let dead = null;
    if (player.y - 20 > FRAME.sill) dead = 'fall';
    const hit = world.hazardHit(player.hurtbox());
    if (hit) dead = hit.hazard.kind + (hit.hazard.variant ? ':' + hit.hazard.variant : '');
    if (dead) {
      const t = world.runTime = i * dt;
      return { seed, t, dead, D: world.D, biome: gen.biomeAt(world.D).id, surface: player.surface?.kind ?? 'air', speed: world.speed };
    }
    player.events.length = 0;
  }
  return { seed, t: seconds, dead: null, biome: gen.biomeAt(world.D).id };
}

const t0 = Date.now();
let survived = 0;
for (let s = 1; s <= seeds; s++) {
  const r = runSeed(s);
  if (!r.dead) survived++;
  console.log(r.dead
    ? `seed ${s}: died at ${r.t.toFixed(1)}s (${r.dead}) biome=${r.biome} on=${r.surface} speed=${r.speed.toFixed(0)} D=${r.D.toFixed(0)}`
    : `seed ${s}: survived ${seconds}s (reached ${r.biome})`);
}
console.log(`${survived}/${seeds} survived ${seconds}s  [${((Date.now() - t0) / 1000).toFixed(1)}s]`);
