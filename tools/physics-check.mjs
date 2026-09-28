// node tools/physics-check.mjs — prints jump metrics and exercises coyote/buffer/variable jump.
import { Player, jumpApex, airtimeTo, timeAbove } from '../src/player.js';
import { PLAYER, PHYSICS, SPEED } from '../src/config.js';

const apex = jumpApex();
console.log(`full jump apex ${apex.toFixed(1)}px = ${(apex / PLAYER.h).toFixed(2)}x player height`);
console.log(`airtime (same height) ${airtimeTo(0).toFixed(3)}s -> reach ${(airtimeTo(0) * SPEED.start).toFixed(0)}px @start, ${(airtimeTo(0) * SPEED.max).toFixed(0)}px @max`);
console.log(`airtime to +80 rise ${airtimeTo(-80).toFixed(3)}s, to 100 drop ${airtimeTo(100).toFixed(3)}s`);

// A fake world: one surface under the player until D=edge.
function makeWorld(edgeD) {
  const s = {
    bouncy: false,
    topBetween(x0, x1, D) { return D < edgeD ? 500 : null; },
  };
  return { D: 0, speed: SPEED.start, surfacesNear: () => [s], s };
}
function run(label, edgeD, script, steps = 240) {
  const p = new Player(); const w = makeWorld(edgeD); p.reset(500); p.surface = w.s;
  const input = { jumpHeld: false, downHeld: false };
  let minY = 500, jumpedAt = null, jumps = 0;
  for (let i = 0; i < steps; i++) {
    const t = i * PHYSICS.step;
    const pressed = { jump: false };
    script(t, input, pressed);
    w.D += w.speed * PHYSICS.step;
    p.update(PHYSICS.step, input, pressed, w);
    if (p.events.some((e) => e.type === 'jump')) { jumps++; if (jumpedAt == null) jumpedAt = t; }
    p.events.length = 0;
    minY = Math.min(minY, p.y);
  }
  console.log(`${label}: jumped=${jumpedAt != null ? jumpedAt.toFixed(3) + 's' : 'no'} height=${(500 - minY).toFixed(1)} jumps=${jumps}`);
}
// tap vs hold
run('tap jump', 1e9, (t, i, p) => { if (Math.abs(t - 0.1) < 1e-6) p.jump = true; i.jumpHeld = t >= 0.1 && t < 0.13; });
run('hold jump', 1e9, (t, i, p) => { if (Math.abs(t - 0.1) < 1e-6) p.jump = true; i.jumpHeld = t >= 0.1 && t < 0.6; });
// coyote: edge at D=180 (t=0.5s); press at 0.58s (80ms late) -> should jump
run('coyote 80ms late', 180, (t, i, p) => { if (Math.abs(t - 0.58) < 0.004) { p.jump = true; } i.jumpHeld = t > 0.57 && t < 0.9; });
run('coyote 140ms late (should fail)', 180, (t, i, p) => { if (Math.abs(t - 0.64) < 0.004) { p.jump = true; } i.jumpHeld = t > 0.63 && t < 0.9; });
// buffer: jump, then press 100ms before landing -> immediate rejump
run('buffer', 1e9, (t, i, p) => {
  if (Math.abs(t - 0.05) < 0.004) p.jump = true;
  if (Math.abs(t - 0.05 - 0.63 + 0.1) < 0.004) p.jump = true;
  i.jumpHeld = false;
}, 200);
