// node tools/gen-check.mjs [seeds=40] [seconds=420]
// Runs the generator headless for many seeds and verifies the fairness rules:
//  * every gap between consecutive surfaces (in D order) is clearable with a full jump at that speed
//  * no rise is bigger than the max jump
//  * hazards never demand both "jump" and "slide" at once, and keep their spacing
import { World } from '../src/world/world.js';
import { Generator } from '../src/world/generator.js';
import { airtimeTo, jumpApex } from '../src/player.js';
import { GEN, PHYSICS, SPEED } from '../src/config.js';

const seeds = +(process.argv[2] ?? 40), seconds = +(process.argv[3] ?? 420);
let worst = 0, gaps = 0, fails = 0, patterns = {}, biomes = {};
const apex = jumpApex();
for (let seed = 1; seed <= seeds; seed++) {
  const gen = new Generator(seed);
  const world = new World(gen);
  gen.startRunway(world);
  const steps = Math.round(seconds / PHYSICS.step);
  for (let i = 0; i < steps; i++) {
    world.update(PHYSICS.step, gen.speedAt(world.D));
    patterns[gen.lastPattern] = (patterns[gen.lastPattern] ?? 0) + PHYSICS.step;
    const b = gen.biomeAt(world.D).id; biomes[b] = (biomes[b] ?? 0) + PHYSICS.step;
  }
  // Rebuild the full surface timeline from the log: at each D, the highest surface covering it.
  const log = gen.allSurfaces;
  log.sort((a, b) => a.dLead - b.dLead);
  // Merge into coverage intervals, then check each uncovered stretch.
  let covEnd = log[0].dTail, covTop = log[0].profile.at(-1)[1];
  for (let i = 1; i < log.length; i++) {
    const s = log[i];
    if (s.dLead > covEnd) {
      const gap = s.dLead - covEnd;
      const dy = s.profile[0][1] - covTop;
      const S = gen.speedAt(covEnd);
      const reach = S * airtimeTo(dy);
      gaps++;
      const ratio = gap / reach;
      worst = Math.max(worst, ratio);
      if (ratio > 1 - GEN.reachSafety + 1e-6 || -dy > apex) {
        fails++;
        if (fails < 10) console.log(`seed ${seed}: UNFAIR gap ${gap.toFixed(0)} reach ${reach.toFixed(0)} dy ${dy.toFixed(0)} at D ${covEnd.toFixed(0)} (${s.kind})`);
      }
    }
    if (s.dTail >= covEnd) { covEnd = s.dTail; covTop = s.profile.at(-1)[1]; }
  }
  if (gen.checkHazards) fails += gen.checkHazards(seed);
}
console.log(`${seeds} seeds x ${seconds}s: ${gaps} gaps, worst gap/reach = ${worst.toFixed(3)} (limit ${(1 - GEN.reachSafety).toFixed(2)}), failures: ${fails}`);
console.log('time per biome (s):', Object.fromEntries(Object.entries(biomes).map(([k, v]) => [k, +(v / seeds).toFixed(1)])));
console.log('time per pattern (s):', Object.fromEntries(Object.entries(patterns).map(([k, v]) => [k, +(v / seeds).toFixed(1)])));
process.exit(fails ? 1 : 0);
