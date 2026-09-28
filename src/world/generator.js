// Chunk-based procedural level generation with a reachability guarantee.
//
// Everything is placed on the D axis (see entities.js). A gap between two surfaces is measured in D;
// a full jump with airtime τ at speed S covers S·τ of D whatever the surfaces' own speed factors,
// so one rule covers rooftops, cars, trucks and trains alike:
//     gapD ≤ S(D) · airtimeTo(Δy) · (1 − GEN.reachSafety)
import { GEN, SPEED, PLAYER, DIFFICULTY, VIEW, PHYSICS } from '../config.js';
import { Surface, Decor } from './entities.js';
import { RNG, clamp, lerp } from '../util.js';
import { BIOMES, BIOME_ORDER, PATTERNS } from './biomes.js';
import { airtimeTo, jumpApex } from '../player.js';
import { VEHICLES, ROAD_Y } from './vehicles.js';
import { Bug, Sign, Bird, Overpass, Chimney, Cable, Vent } from './hazards.js';
import { SIGNS } from './biomes.js';

const APEX = jumpApex();

export function catenaryProfile(y0, y1, span, sag, n = 14) {
  // Solve a·(cosh(span/2a) − 1) = sag for the catenary parameter a.
  let lo = 1, hi = 1e7;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const f = mid * (Math.cosh(span / (2 * mid)) - 1);
    if (f > sag) lo = mid; else hi = mid;
  }
  const a = (lo + hi) / 2;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const x = (span * i) / n;
    const u = x - span / 2;
    const dip = sag - a * (Math.cosh(u / a) - 1);
    pts.push([x, lerp(y0, y1, x / span) + dip]);
  }
  return pts;
}

export class Generator {
  constructor(seed) {
    this.seed = seed;
    this.rng = new RNG(seed);
    this.mode = 'attract';
    this.cursorD = 0;
    this.lastTop = 470;
    this.runStartD = null;
    this.biomes = [{ startD: -Infinity, id: 'country', loop: 0 }];
    this.nextBiomeD = Infinity;
    this.biomeIndex = 0;
    this.loop = 0;
    this.lastPattern = null;
    this.segLog = [];        // [{d0, d1, s}] recent surfaces in D order (for hazard placement + validation)
    this.gapLog = [];        // [{d, gap, reach, dy}] every generated gap, for tools/gen-check
    this.hazardLog = [];     // [{d0, d1, kind, needs}] for tools/gen-check
    this.lastHazardD = -Infinity;
    this.blockHazardsUntil = -Infinity;
    this.pendingRunway = false;
    this.ids = 0;
    this.keepAll = typeof process !== 'undefined'; // tools/gen-check keeps every surface
    this.allSurfaces = [];
  }

  attach(world) { this.world = world; }

  // ---- speed / difficulty prediction (speed is a pure function of run distance; see main.targetSpeed)
  speedAt(D) {
    if (this.runStartD == null || D < this.runStartD) return SPEED.attract;
    const d = D - this.runStartD;
    return Math.min(SPEED.max, Math.sqrt(SPEED.start * SPEED.start + 2 * SPEED.ramp * d));
  }
  runTimeAt(D) {
    if (this.runStartD == null || D < this.runStartD) return 0;
    return (this.speedAt(D) - SPEED.start) / SPEED.ramp; // exact while below the cap
  }
  difficultyAt(D) {
    const t = this.runTimeAt(D);
    return clamp(t / DIFFICULTY.rampSec, 0, 1) + this.loop * 0.15;
  }
  biomeAt(D) {
    let b = this.biomes[0];
    for (const s of this.biomes) if (s.startD <= D) b = s;
    return b;
  }

  // ---- reachability
  reach(dy, D) { return this.speedAt(D) * airtimeTo(dy) * (1 - GEN.reachSafety); }
  maxRise() { return APEX * GEN.maxRise; }
  clampTop(top) {
    top = clamp(top, GEN.surfaceTopMin, GEN.surfaceTopMax);
    return Math.max(top, this.lastTop - this.maxRise());
  }
  // Pick a gap (in D) before a surface whose leading top is `top`, as a fraction of the safe reach.
  gapTo(top, frac = null) {
    const dy = top - this.lastTop;
    const reach = this.reach(dy, this.cursorD);
    const diff = Math.min(1, this.difficultyAt(this.cursorD));
    if (frac == null) {
      const lo = lerp(DIFFICULTY.gapFrac[0][0], DIFFICULTY.gapFrac[1][0], diff);
      const hi = lerp(DIFFICULTY.gapFrac[0][1], DIFFICULTY.gapFrac[1][1], diff);
      frac = this.rng.float(lo, hi);
    }
    const minGap = GEN.minGapSec * this.speedAt(this.cursorD);
    const gap = clamp(reach * frac, Math.min(minGap, reach), reach);
    this.gapLog.push({ d: this.cursorD, gap, reach, dy, speed: this.speedAt(this.cursorD) });
    return gap;
  }

  // ---- placement
  push(s) {
    s.id = this.ids++;
    if (this.keepAll && s.profile) this.allSurfaces.push(s);
    this.world.add(s);
    return s;
  }
  pushSurface(s, { advance = true, hazardOk = true } = {}) {
    this.push(s);
    if (advance) {
      this.cursorD = Math.max(this.cursorD, s.dTail);
      this.lastTop = s.profile[s.profile.length - 1][1];
    }
    this.segLog.push({ d0: s.dLead, d1: s.dTail, s, hazardOk });
    if (this.segLog.length > 200) this.segLog.splice(0, 100);
    return s;
  }
  // The surface covering D at the fingers, if any (from the recent log).
  surfaceAtD(D) {
    for (let i = this.segLog.length - 1; i >= 0; i--) {
      const g = this.segLog[i];
      if (g.d0 <= D && g.d1 >= D) return g;
    }
    return null;
  }

  // ---- run lifecycle
  // Title screen -> run: drop everything not yet visible, then lay a safe runway.
  // Drop everything that hasn't been spawned yet, so new content starts just past the right edge.
  truncateAhead(D) {
    const w = this.world;
    const cutD = D + (VIEW.W + GEN.spawnMargin - PLAYER.x);
    const keep = (e) => e.dLead <= cutD && e.spawnD <= D;
    w.pending = w.pending.filter(keep);
    this.segLog = this.segLog.filter((g) => keep(g.s));
    if (this.keepAll) this.allSurfaces = this.allSurfaces.filter(keep);
    this.cursorD = D;
    for (const g of this.segLog) this.cursorD = Math.max(this.cursorD, g.d1);
    const last = this.segLog.reduce((a, g) => (!a || g.d1 > a.d1 ? g : a), null);
    if (last) this.lastTop = last.s.profile[last.s.profile.length - 1][1];
    this.blockHazardsUntil = -Infinity;
  }

  beginRun(D) {
    this.truncateAhead(D);
    this.mode = 'play';
    this.runStartD = D;
    this.loop = 0;
    this.biomeIndex = 0;
    this.biomes = [{ startD: -Infinity, id: 'country', loop: 0 }];
    this.nextBiomeD = D + GEN.biomeSec * SPEED.start;
    this.blockHazardsUntil = this.cursorD + GEN.startRunwaySec * SPEED.start;
    this.buildRunway(BIOMES.country, GEN.startRunwaySec, true);
  }

  // Fresh run with no attract content (restart): runway directly under the fingers. Returns top y.
  startRunway(world) {
    this.mode = 'play';
    this.runStartD = world.D;
    this.nextBiomeD = world.D + GEN.biomeSec * SPEED.start;
    this.cursorD = world.D - 500;
    this.lastTop = 470;
    this.buildRunway(BIOMES.country, GEN.startRunwaySec + 500 / SPEED.start, true);
    this.blockHazardsUntil = this.cursorD;
    return this.segLog[0].s.topAtLocal(PLAYER.x - this.segLog[0].s.left(world.D));
  }

  skipBiome() {
    this.truncateAhead(this.world.D);
    this.enterNextBiome();
  }

  fill(untilD) {
    let guard = 0;
    while (this.cursorD < untilD && guard++ < 50) {
      if (this.mode === 'attract') { this.builders.wires.call(this, { spans: [6, 9], missing: 0 }, BIOMES.country, { attract: true }); continue; }
      if (this.cursorD >= this.nextBiomeD) this.enterNextBiome();
      const seg = this.biomeAt(this.cursorD);
      const biome = BIOMES[seg.id];
      if (seg.id === 'highway' && !seg.tunnel && !this.forcePattern && this.cursorD > seg.startD + (this.nextBiomeD - seg.startD) * 0.4) {
        seg.tunnel = true;
        this.lastPattern = 'tunnel';
        this.builders.tunnel.call(this, PATTERNS.tunnel, biome);
        continue;
      }
      const diff = this.difficultyAt(this.cursorD);
      const choices = Object.entries(biome.patterns)
        .map(([id, wt]) => ({ id, wt, p: PATTERNS[id] }))
        .filter((c) => c.p && diff >= c.p.minDiff && this.builders[c.p.builder]);
      if (this.forcePattern && PATTERNS[this.forcePattern]) choices.splice(0, choices.length, { id: this.forcePattern, wt: 1, p: PATTERNS[this.forcePattern] });
      const pick = this.rng.weighted(choices, (c) => c.wt * (c.id === this.lastPattern ? 0.35 : 1));
      this.lastPattern = pick.id;
      const before = this.segLog.length;
      this.builders[pick.p.builder].call(this, pick.p, biome, {});
      this.placeHazards?.(pick.p, biome, before);
    }
  }

  enterNextBiome() {
    this.biomeIndex++;
    const id = BIOME_ORDER[this.biomeIndex % BIOME_ORDER.length];
    if (this.biomeIndex % BIOME_ORDER.length === 0) this.loop++;
    this.biomes.push({ startD: this.cursorD, id, loop: this.loop });
    if (this.biomes.length > 8) this.biomes.splice(1, 1);
    this.nextBiomeD = this.cursorD + GEN.biomeSec * this.speedAt(this.cursorD);
    this.buildRunway(BIOMES[id], GEN.runwaySec, true);
  }

  // A long, hazard-free, biome-appropriate surface.
  buildRunway(biome, sec, safe) {
    const len = sec * this.speedAt(this.cursorD);
    const kind = biome.fore === 'guardrail' ? 'barrier' : biome === BIOMES.country ? 'wires' : 'roof';
    const d0 = this.cursorD;
    if (kind === 'wires') {
      const spans = Math.max(2, Math.ceil(len / 240));
      this.builders.wires.call(this, { spans: [spans, spans], missing: 0 }, biome, { safe, first: this.segLog.length === 0 });
    } else if (kind === 'barrier') {
      const top = this.clampTop(530);
      const gap = this.segLog.length ? this.gapTo(top, 0.4) : 0;
      this.pushSurface(new Surface({ kind: 'barrier', dLead: this.cursorD + gap, w: len, top, biome: biome.name }), { hazardOk: !safe });
    } else {
      const top = this.clampTop(biome === BIOMES.city ? 440 : 500);
      const gap = this.segLog.length ? this.gapTo(top, 0.4) : 0;
      this.pushSurface(this.makeRoof(this.cursorD + gap, len, top, biome, { style: 'flat' }), { hazardOk: !safe });
    }
    if (safe) this.blockHazardsUntil = Math.max(this.blockHazardsUntil, this.cursorD);
    return d0;
  }

  makeRoof(dLead, w, top, biome, o = {}) {
    const r = this.rng;
    const style = o.style ?? r.pick(['flat', 'flat', 'flat', 'slope', 'parapet']);
    let profile = [[0, top], [w, top]];
    if (style === 'slope') {
      const dh = r.float(10, 26) * (r.chance(0.5) ? 1 : -1);
      profile = [[0, top + Math.max(0, dh)], [w, top + Math.max(0, -dh)]];
    }
    return new Surface({
      kind: 'roof', dLead, w, profile, biome: biome.name,
      data: { style, seed: r.int(0, 1e6), tall: !!o.tall, city: biome === BIOMES.city },
    });
  }
}

// ---------------------------------------------------------------------------
// Builders. `this` is the Generator. Each advances cursorD and lastTop.
Generator.prototype.builders = {
  wires(p, biome, o = {}) {
    const r = this.rng;
    const spans = r.int(p.spans[0], p.spans[1]);
    const missing = new Set();
    if (p.missing && !o.safe && !o.attract) {
      const nMiss = r.int(p.missing[0], p.missing[1]);
      for (let i = 0; i < nMiss; i++) missing.add(r.int(1, Math.max(1, spans - 2)));
    }
    const capW = 28;
    let top = this.clampTop(o.attract ? r.float(440, 470) : this.lastTop + r.float(-30, 30));
    top = clamp(top, 390, 520);
    // first pole
    let gap = this.segLog.length && !o.first ? this.gapTo(top) : 0;
    if (o.attract && this.segLog.length) gap = 0; // continuous during attract (safe start)
    let poleD = this.cursorD + gap + capW / 2;
    let prevTop = top;
    const addPole = (d, t) => {
      this.push(new Decor({ kind: 'pole', dLead: d - 6, w: 12, biome: biome.name, data: { top: t, seed: r.int(0, 1e6) } }));
      const cap = new Surface({ kind: 'polecap', dLead: d - capW / 2, w: capW, top: t, material: 'wood', biome: biome.name });
      this.pushSurface(cap);
    };
    addPole(poleD, prevTop);
    for (let i = 0; i < spans; i++) {
      let nextTop = clamp(prevTop + r.float(-22, 22), 390, 525);
      if (missing.has(i)) {
        this.lastTop = prevTop;
        this.cursorD = poleD + capW / 2;
        nextTop = this.clampTop(nextTop);
        const g = this.gapTo(nextTop);
        const nextD = this.cursorD + g + capW / 2;
        addPole(nextD, nextTop);
        poleD = nextD; prevTop = nextTop;
        continue;
      }
      const span = r.float(210, 290);
      const nextD = poleD + span;
      const sag = span * r.float(0.07, 0.1);
      const profile = catenaryProfile(prevTop, nextTop, span, sag);
      const wire = new Surface({ kind: 'wire', dLead: poleD, w: span, profile, material: 'wire', biome: biome.name, data: { sag } });
      this.pushSurface(wire);
      addPole(nextD, nextTop);
      poleD = nextD; prevTop = nextTop;
    }
    this.cursorD = poleD + capW / 2;
    this.lastTop = prevTop;
  },

  roofs(p, biome) {
    const r = this.rng;
    const n = r.int(p.count[0], p.count[1]);
    for (let i = 0; i < n; i++) {
      const w = r.float(p.w[0], p.w[1]);
      let top = i === 0 ? r.float(p.tops[0], p.tops[1]) : this.lastTop + r.float(-p.dy, p.dy);
      top = this.clampTop(clamp(top, p.tops[0], p.tops[1]));
      const gap = this.gapTo(top);
      const roof = this.makeRoof(this.cursorD + gap, w, top, biome, { tall: p.tall });
      this.pushSurface(roof);
    }
  },

  cars(p, biome) {
    const r = this.rng;
    const n = r.int(p.count[0], p.count[1]);
    const k = r.float(p.k[0], p.k[1]);
    const lights = r.int(0, 1e6);
    for (let i = 0; i < n; i++) {
      const type = r.pick(['sedan', 'sedan', 'hatch', 'van']);
      this.placeVehicle(type, k, biome, { paint: r.int(0, 7), lights });
    }
  },
};

// Place one vehicle (possibly multi-part, e.g. truck trailer + cab) after the cursor.
Generator.prototype.placeVehicle = function (type, k, biome, data = {}) {
  const v = VEHICLES[type];
  const parts = v.parts;
  const firstTop = ROAD_Y - parts[0].profile[0][1];
  const gap = this.gapTo(this.clampTop(firstTop));
  const baseD = this.cursorD + gap;
  let offset = 0;
  const made = [];
  const vehicle = { type, k, data };
  for (const part of parts) {
    const profile = part.profile.map(([x, h]) => [x, ROAD_Y - h]);
    const s = new Surface({
      kind: 'vehicle', k, dLead: baseD + (offset + (part.x ?? 0)) / k, w: part.w, profile,
      material: part.material ?? 'metal', biome: biome.name,
      data: { vehicle, part: part.name, type },
    });
    made.push(s);
  }
  // body decor (drawn once per vehicle, from the first part's position)
  vehicle.parts = made;
  for (const s of made) this.pushSurface(s);
  return made;
};

// ---------------------------------------------------------------------------
// Hazard placement. Fairness rules:
//  * hazards sit on a continuous run of surface, at least hazardEdgeSafetySec from either end
//    (so no hazard ever overlaps a forced gap jump or a landing);
//  * consecutive hazards are ≥ hazardMinSpacingSec apart, so two never demand conflicting moves;
//  * every hazard leaves at least one answer: slide under (head-height things), jump over
//    (low things), or simply stay grounded (high things).

const HAZ = {
  slideClear: 14, // px of clearance above the sliding hurtbox
};

Generator.prototype.runsFrom = function (segs) {
  const list = segs.filter((g) => g.hazardOk).slice().sort((a, b) => a.d0 - b.d0);
  const runs = [];
  for (const g of list) {
    const last = runs[runs.length - 1];
    if (last && g.d0 <= last.d1 + 1) { last.d1 = Math.max(last.d1, g.d1); last.segs.push(g); }
    else runs.push({ d0: g.d0, d1: g.d1, segs: [g] });
  }
  return runs;
};

// Highest (min y) and lowest (max y) surface top the fingers would stand on across [D0, D1].
Generator.prototype.topRange = function (segs, D0, D1) {
  let hi = Infinity, lo = -Infinity;
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const D = D0 + ((D1 - D0) * i) / n;
    let best = Infinity;
    for (const g of segs) {
      if (g.d0 <= D && g.d1 >= D) best = Math.min(best, g.s.topAtLocal((D - g.d0) * g.s.k));
    }
    if (best < Infinity) { hi = Math.min(hi, best); lo = Math.max(lo, best); }
  }
  return { hi, lo };
};

// Find a D for a hazard occupying lenD (at the fingers), inside one run, respecting spacing.
Generator.prototype.findSlot = function (runs, lenD, pred = null) {
  const S = this.speedAt(this.cursorD);
  const edge = GEN.hazardEdgeSafetySec * S;
  const minD = Math.max(this.lastHazardD + GEN.hazardMinSpacingSec * S, this.blockHazardsUntil);
  const options = [];
  for (const run of runs) {
    if (pred && !pred(run)) continue;
    const a = Math.max(run.d0 + edge, minD), b = run.d1 - edge - lenD;
    if (b > a) options.push({ run, a, b });
  }
  if (!options.length) return null;
  const o = options[0]; // earliest run: leaves room for more hazards later in the pattern
  const D = this.rng.float(o.a, o.a + Math.min(o.b - o.a, S * 0.9));
  return { run: o.run, D };
};

Generator.prototype.logHazard = function (h, d0, d1, needs, kind, extra = {}) {
  this.push(h);
  this.lastHazardD = d1;
  this.hazardLog.push({ d0, d1, needs, kind, ...extra });
  if (this.hazardLog.length > 400) this.hazardLog.splice(0, 200);
};

Generator.prototype.hazardTypes = {
  bug: { place(runs, biome) { return this.placeBug(runs, biome, false); } },
  bigBug: { place(runs, biome) { return this.placeBug(runs, biome, true); } },
  pigeon: { place(runs, biome) { return this.placeBug(runs, biome, false, true); } },
  sign: {
    place(runs, biome) {
      const r = this.rng;
      const id = r.pick(biome.signs);
      const def = SIGNS[id];
      const w = def.w;
      const slot = this.findSlot(runs, w);
      if (!slot) return false;
      const { hi } = this.topRange(slot.run.segs, slot.D, slot.D + w);
      const panelBottom = hi - (PLAYER.slideH + HAZ.slideClear);
      const panelH = def.lines?.length === 3 ? 56 : def.shape === 'diamond' ? 52 : 46;
      const panelTop = panelBottom - panelH;
      const sign = new Sign({ kind: 'sign', dLead: slot.D, w, def, panelTop, panelBottom, biome: biome.name, seed: r.int(0, 1e6) });
      this.logHazard(sign, slot.D, slot.D + w, 'slide', 'sign', { refTop: hi, bottom: panelBottom, top: panelTop });
      return true;
    },
  },
  bird: {
    place(runs, biome) {
      const r = this.rng;
      const w = 22;
      const pad = 20;
      const slot = this.findSlot(runs, w + pad * 2, (run) => run.segs.some((g) => g.s.kind === 'wire'));
      if (!slot) return false;
      const D = slot.D + pad;
      // perch on the wire span covering D
      const g = slot.run.segs.find((q) => q.s.kind === 'wire' && q.d0 <= D && q.d1 >= D + w);
      if (!g) return false;
      const perchY = g.s.topAtLocal(D - g.d0 + w / 2);
      const { hi } = this.topRange(slot.run.segs, slot.D, slot.D + w + pad * 2);
      const hoverY = hi - (PLAYER.slideH + HAZ.slideClear + 7);
      const bird = new Bird({ kind: 'bird', dLead: D, w, perchY, hoverY, biome: biome.name, seed: r.int(0, 1e6) });
      this.logHazard(bird, slot.D, slot.D + w + pad * 2, 'slide', 'bird', { refTop: hi, bottom: hoverY + 7 });
      return true;
    },
  },
  chimney: {
    place(runs, biome) {
      const r = this.rng;
      const w = 26, h = 34;
      const slot = this.findSlot(runs, w, (run) => run.segs.length === 1 && run.segs[0].s.kind === 'roof' && run.segs[0].s.data.style !== 'slope');
      if (!slot) return false;
      const roof = slot.run.segs[0].s;
      const top = roof.top - h;
      const cap = new Surface({ kind: 'chimney', dLead: slot.D, w, top, biome: biome.name, parent: roof });
      this.push(cap);
      this.segLog.push({ d0: cap.dLead, d1: cap.dTail, s: cap, hazardOk: false });
      const face = new Chimney({ kind: 'chimney', dLead: slot.D, w, top, base: roof.top, biome: biome.name });
      this.logHazard(face, slot.D, slot.D + w, 'jump', 'chimney', { refTop: roof.top, height: h });
      return true;
    },
  },
};

Generator.prototype.placeBug = function (runs, biome, big, pigeon = false) {
  const r = this.rng;
  const variant = pigeon ? 'pigeon' : big ? r.pick(['dragonfly', 'beetle']) : r.pick(['gnat', 'fly', 'fly']);
  const size = { gnat: [12, 9], fly: [15, 11], dragonfly: [30, 12], beetle: [22, 15], pigeon: [28, 15] }[variant];
  const k = pigeon ? r.float(1.2, 1.35) : r.float(1.2, 1.45);
  // D length at the fingers: it crosses our x while the world scrolls (w + playerW)/k
  const lenD = (size[0] + PLAYER.w) / k;
  const slot = this.findSlot(runs, lenD);
  if (!slot) return false;
  const { hi } = this.topRange(slot.run.segs, slot.D - 30, slot.D + lenD + 30);
  const high = !big && r.chance(pigeon ? 0.4 : 0.35);
  const amp = big ? r.float(3, 6) : r.float(4, 9);
  let baseY;
  if (high) baseY = hi - r.float(104, 132);
  else baseY = hi - (PLAYER.slideH + HAZ.slideClear) - amp - size[1] / 2 - r.float(0, 10);
  const bug = new Bug({
    kind: 'bug', variant, k, dLead: slot.D, w: size[0], h: size[1], baseY, amp,
    freq: r.float(1.2, 2.4), phase: r.float(0, 6.28), biome: biome.name, seed: r.int(0, 1e6),
  });
  const bottom = baseY + amp + size[1] / 2, top = baseY - amp - size[1] / 2;
  this.logHazard(bug, slot.D, slot.D + lenD, high ? 'stay' : 'slide', variant, { refTop: hi, bottom, top });
  return true;
};

Generator.prototype.placeHazards = function (pattern, biome, segStart) {
  if (this.mode !== 'play' || !pattern.hazardSlots) return;
  const r = this.rng;
  const diff = Math.min(1, this.difficultyAt(this.cursorD));
  const chance = lerp(DIFFICULTY.hazardChance[0], DIFFICULTY.hazardChance[1], diff);
  const runs = this.runsFrom(this.segLog.slice(segStart));
  if (!runs.length) return;
  for (let i = 0; i < pattern.hazardSlots; i++) {
    if (!r.chance(chance)) continue;
    const types = Object.entries(biome.hazards).filter(([t, wt]) => wt > 0 && this.hazardTypes[t]);
    // try the weighted pick first, then anything else that fits
    const first = r.weighted(types, ([, wt]) => wt);
    const order = [first, ...types.filter((t) => t !== first)];
    for (const [t] of order) if (this.hazardTypes[t].place.call(this, runs, biome)) break;
  }
};

// Overpass / low bridge: a long barrier under a deck you must slide beneath.
Generator.prototype.builders.overpass = function (p, biome) {
  const r = this.rng;
  const S = this.speedAt(this.cursorD);
  const top = this.clampTop(clamp(this.lastTop + r.float(-30, 30), 470, 545));
  const len = S * r.float(2.6, 3.3);
  const gap = this.gapTo(top);
  const d0 = this.cursorD + gap;
  const kind = biome.fore === 'guardrail' ? 'barrier' : biome === BIOMES.city ? 'barrier' : 'railing';
  const base = new Surface({ kind, dLead: d0, w: len, top, biome: biome.name });
  this.pushSurface(base, { hazardOk: false });
  const deckW = r.float(230, 330);
  const lead = Math.max(d0 + S * 0.95, this.lastHazardD + GEN.hazardMinSpacingSec * S);
  const deckD = Math.min(lead, d0 + len - deckW - S * 0.6);
  const ceil = top - (PLAYER.slideH + HAZ.slideClear);
  const style = biome === BIOMES.highway ? 'concrete' : biome === BIOMES.city ? 'steel' : 'stone';
  const deck = new Overpass({ kind: 'overpass', dLead: deckD, w: deckW, ceil, deckH: 74, style, biome: biome.name, seed: r.int(0, 1e6) });
  this.logHazard(deck, deckD, deckD + deckW, 'slide', 'overpass', { refTop: top, bottom: ceil, top: ceil - 74 });
};

// Validation for tools/gen-check.mjs — returns number of violations.
Generator.prototype.checkHazards = function (seed) {
  let bad = 0;
  const log = this.hazardLog.slice().sort((a, b) => a.d0 - b.d0);
  const slideTop = PLAYER.slideH - PLAYER.hurtInset; // sliding hurtbox height above feet
  for (let i = 0; i < log.length; i++) {
    const h = log[i];
    const S = this.speedAt(h.d0);
    if (i > 0 && h.d0 - log[i - 1].d1 < GEN.hazardMinSpacingSec * S * 0.98) {
      bad++; if (bad < 10) console.log(`seed ${seed}: hazards too close at D ${h.d0.toFixed(0)} (${log[i - 1].kind} -> ${h.kind})`);
    }
    if (h.needs === 'slide' && h.bottom > h.refTop - slideTop - 4) {
      bad++; if (bad < 10) console.log(`seed ${seed}: ${h.kind} too low to slide under at D ${h.d0.toFixed(0)}`);
    }
    if (h.needs === 'stay' && h.bottom > h.refTop - PLAYER.h) {
      bad++; if (bad < 10) console.log(`seed ${seed}: high ${h.kind} hits a standing player at D ${h.d0.toFixed(0)}`);
    }
  }
  return bad;
};

// ---------------------------------------------------------------------------
// Milestone 4 builders: trucks, tractor, trains, treetops, pole hops, bridges, tunnel.

Generator.prototype.builders.trucks = function (p, biome) {
  const r = this.rng;
  const n = r.int(p.count[0], p.count[1]);
  const k = r.float(p.k[0], p.k[1]);
  for (let i = 0; i < n; i++) this.placeVehicle('truck', k, biome, { paint: r.int(0, 7), logo: r.int(0, 5) });
};

Generator.prototype.builders.tractor = function (p, biome) {
  const r = this.rng;
  this.placeVehicle('tractor', r.float(p.k[0], p.k[1]), biome, { paint: r.int(0, 2) });
  // hay wagon behind? keep it simple: a truck sometimes follows the tractor
  if (r.chance(0.3)) this.placeVehicle('truck', r.float(0.52, 0.6), biome, { paint: r.int(0, 7) });
};

export const TRAIN_TOP = 432;
Generator.prototype.builders.train = function (p, biome) {
  const r = this.rng;
  const k = r.float(p.k[0], p.k[1]);
  const n = r.int(p.cars[0], p.cars[1]);
  const carW = 300, coupling = 22;
  const top = TRAIN_TOP;
  const parts = [];
  let x = 0;
  for (let i = 0; i < n; i++) {
    parts.push({ name: 'car', x, w: carW, profile: [[0, top + 8], [10, top], [carW - 10, top], [carW, top + 8]] });
    x += carW + coupling;
  }
  parts.push({ name: 'loco', x, w: 340, profile: [[0, top + 8], [10, top - 6], [240, top - 6], [276, top + 20], [340, top + 44]] });
  const vehicle = { type: 'train', k, data: { paint: r.int(0, 3), seed: r.int(0, 1e6) } };
  const gap = this.gapTo(this.clampTop(parts[0].profile[0][1]));
  const baseD = this.cursorD + gap;
  const made = parts.map((part) => new Surface({
    kind: 'vehicle', k, dLead: baseD + part.x / k, w: part.w, profile: part.profile, material: 'metal',
    biome: biome.name, data: { vehicle, part: part.name, type: 'train' },
  }));
  vehicle.parts = made;
  for (const s of made) this.pushSurface(s);
};

Generator.prototype.builders.trees = function (p, biome) {
  const r = this.rng;
  const n = r.int(p.count[0], p.count[1]);
  let prevCenterD = null;
  let prevTop = null;
  for (let i = 0; i < n; i++) {
    const wT = r.float(120, 150);
    const top = clamp(i === 0 ? this.clampTop(this.lastTop + r.float(-25, 25)) : prevTop + r.float(-24, 24), 420, 530);
    const dome = r.float(18, 26);
    const profile = [];
    for (let j = 0; j <= 10; j++) {
      const u = (j / 10) * 2 - 1;
      profile.push([(j / 10) * wT, top + dome * (1 - Math.sqrt(1 - u * u * 0.96))]);
    }
    let dLead;
    if (i === 0) dLead = this.cursorD + this.gapTo(profile[0][1]);
    else {
      // natural (no-input) bounce from the previous crown lands on this crown
      const S = this.speedAt(prevCenterD);
      const pitch = S * airtimeTo(top - prevTop, PHYSICS.bounceMul);
      dLead = prevCenterD + pitch - wT / 2;
      dLead = Math.max(dLead, this.cursorD + 20);
    }
    const tree = new Surface({ kind: 'tree', dLead, w: wT, profile, bouncy: true, material: 'tree', biome: biome.name, data: { seed: r.int(0, 1e6), dome } });
    this.pushSurface(tree, { hazardOk: false });
    prevCenterD = dLead + wT / 2;
    prevTop = top;
  }
  // landing strip: natural bounce from the last crown lands a little way into a long flat roof/wire
  const S = this.speedAt(prevCenterD);
  const land = this.clampTop(clamp(prevTop + r.float(-10, 30), 440, 545));
  const natural = prevCenterD + S * airtimeTo(land - prevTop, PHYSICS.bounceMul);
  const lead = Math.max(this.cursorD + GEN.minGapSec * S * 0.5, natural - S * 0.35);
  const len = Math.max(S * 1.4, natural + S * 0.9 - lead);
  if (biome === BIOMES.country) {
    this.pushSurface(new Surface({ kind: 'roof', dLead: lead, w: len, top: land, biome: biome.name, data: { style: 'barn', seed: r.int(0, 1e6) } }));
  } else {
    this.pushSurface(this.makeRoof(lead, len, land, biome, { style: 'flat' }));
  }
};

Generator.prototype.builders.poleHop = function (p, biome) {
  const r = this.rng;
  const n = r.int(p.poles[0], p.poles[1]);
  const capW = 30;
  for (let i = 0; i < n; i++) {
    const top = this.clampTop(clamp(this.lastTop + r.float(-28, 28), 400, 520));
    const gap = this.gapTo(top, r.float(0.45, 0.7));
    const d = this.cursorD + gap + capW / 2;
    this.push(new Decor({ kind: 'pole', dLead: d - 6, w: 12, biome: biome.name, data: { top, seed: r.int(0, 1e6), lonely: true } }));
    this.pushSurface(new Surface({ kind: 'polecap', dLead: d - capW / 2, w: capW, top, material: 'wood', biome: biome.name }), { hazardOk: false });
  }
};

Generator.prototype.builders.bridge = function (p, biome) {
  const r = this.rng;
  const S = this.speedAt(this.cursorD);
  const total = S * r.float(p.sec[0], p.sec[1]);
  const top = this.clampTop(clamp(this.lastTop + r.float(-20, 30), 520, 552));
  const start = this.cursorD + this.gapTo(top);
  this.cursorD = start - 1; // gap already applied
  const segLen = S * r.float(1.5, 2.2);
  let placed = 0;
  let first = true;
  while (placed < total) {
    const len = Math.min(segLen * r.float(0.8, 1.2), Math.max(S * 1.0, total - placed));
    const g = first ? 1 : this.gapTo(top, r.float(0.28, 0.5));
    first = false;
    const s = new Surface({ kind: 'railing', dLead: this.cursorD + g, w: len, top, biome: biome.name, data: { seed: r.int(0, 1e6) } });
    this.pushSurface(s);
    placed += len + g;
  }
  this.push(new Decor({ kind: 'bridgeSection', dLead: start - 380, w: this.cursorD - start + 760, biome: biome.name, data: { style: biome === BIOMES.city ? 'truss' : 'arch', seed: r.int(0, 1e6) } }));
};

Generator.prototype.builders.tunnel = function (p, biome) {
  const r = this.rng;
  const S = this.speedAt(this.cursorD);
  const len = S * r.float(GEN.tunnelSec[0], GEN.tunnelSec[1]);
  const top = 505;
  // approach barrier, continuing straight into the ledge at the portal
  const approach = S * 1.2;
  const a0 = this.cursorD + this.gapTo(this.clampTop(top));
  this.pushSurface(new Surface({ kind: 'barrier', dLead: a0, w: approach, top, biome: biome.name }), { hazardOk: false });
  const portalD = a0 + approach - 60;
  const exitD = portalD + len;
  this.push(new Decor({ kind: 'tunnel', dLead: portalD, w: len, biome: biome.name, data: { seed: r.int(0, 1e6), lampEvery: 150 } }));
  const segStart = this.segLog.length;
  // ledges (with gaps) and the occasional pipe run slightly higher
  this.cursorD = portalD - 60;
  let first = true;
  while (this.cursorD < exitD - S * 1.2) {
    const pipe = !first && r.chance(0.3);
    const t = pipe ? this.clampTop(top - r.float(30, 45)) : top + r.float(-6, 6);
    const w = S * r.float(0.9, 1.5);
    const g = first ? 0 : this.gapTo(t);
    first = false;
    this.pushSurface(new Surface({ kind: pipe ? 'pipe' : 'ledge', dLead: this.cursorD + g, w, top: t, material: 'metal', biome: biome.name }));
  }
  // final ledge runs out through the exit, then the runway continues outside
  const lastTop = this.clampTop(top);
  const g = this.gapTo(lastTop);
  const endLen = Math.max(S * 1.0, exitD - (this.cursorD + g) + S * 0.2);
  this.pushSurface(new Surface({ kind: 'ledge', dLead: this.cursorD + g, w: endLen, top: lastTop, material: 'metal', biome: biome.name }), { hazardOk: false });
  // hazards: hanging cables (slide) and floor vents (hop), glowing so they read in the dark
  const runs = this.runsFrom(this.segLog.slice(segStart));
  const diff = Math.min(1, this.difficultyAt(this.cursorD));
  const count = 1 + Math.round(diff * 2);
  for (let i = 0; i < count; i++) {
    if (r.chance(0.5)) {
      const w = 10;
      const slot = this.findSlot(runs, w);
      if (!slot) continue;
      const { hi } = this.topRange(slot.run.segs, slot.D, slot.D + w);
      const bottom = hi - (PLAYER.slideH + HAZ.slideClear);
      this.logHazard(new Cable({ kind: 'cable', dLead: slot.D, w, bottom, ceilY: 0, biome: biome.name }), slot.D, slot.D + w, 'slide', 'cable', { refTop: hi, bottom });
    } else {
      const w = 34, h = 24;
      const slot = this.findSlot(runs, w);
      if (!slot) continue;
      const { lo } = this.topRange(slot.run.segs, slot.D, slot.D + w);
      this.logHazard(new Vent({ kind: 'vent', dLead: slot.D, w, top: lo - h, base: lo, biome: biome.name }), slot.D, slot.D + w, 'jump', 'vent', { refTop: lo, height: h });
    }
  }
  this.buildRunway(biome, GEN.runwaySec, true);
};
