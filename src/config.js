// FINGER HERO — every tunable lives here.
// Units: pixels (logical 1280x720), seconds, px/s, px/s².

export const VIEW = { W: 1280, H: 720 };

// The car window. Everything inside is "glass"; the frame is drawn on top.
export const FRAME = {
  left: 34,
  right: 1246,
  top: 38,
  sill: 612,          // top edge of the door sill. Fingers below this = fell.
  cornerRadius: 70,   // rounded top corners of the rubber seal
};

export const PLAYER = {
  x: Math.round(VIEW.W * 0.33), // fixed horizontal position of the fingers
  w: 34,
  h: 72,            // standing height (fingertips -> top of hand)
  slideH: 32,       // ~45% height while sliding
  hurtInset: 4,     // hurtbox is a little smaller than the drawn body (forgiving)
  feetHalf: 10,     // half-width of the "feet" used for standing/landing
};

export const PHYSICS = {
  step: 1 / 120,          // fixed timestep
  gravity: 2400,
  fallGravityMul: 1.15,   // slightly heavier on the way down = snappier
  jumpVel: 800,           // full jump ≈ 130px ≈ 1.8 × player height
  jumpCutMul: 0.4,        // velocity multiplier when jump is released early
  minHold: 0.075,         // a tap still gives a decent hop
  maxHold: 0.3,           // after this, releasing no longer cuts the jump
  fastFallGravityMul: 2.6,
  fastFallMinVy: 420,
  maxFallSpeed: 1500,
  coyote: 0.10,
  jumpBuffer: 0.12,
  snapUp: 7,              // max px the feet may be pushed up per step while grounded (slopes)
  snapDown: 9,            // max px the feet may follow a surface down per step
  bounceMul: 1.12,        // treetop auto-launch (× jumpVel)
  bounceHoldMul: 1.34,    // treetop launch while holding jump
  ceilingPad: 4,          // fingers can't rise above FRAME.top + this
};

export const SPEED = {
  attract: 210,           // title screen scroll
  start: 360,             // country road
  max: 780,               // highway
  ramp: 1.8,              // px/s gained per second of play (speed is linear in time)
  mphPerPx: 1 / 8.5,      // odometer conversion (360 px/s ≈ 42 mph)
  easeIn: 1.2,            // seconds to blend from attract speed to play speed
};

export const GEN = {
  lookahead: 7600,        // generate this much distance (D units) ahead
  spawnMargin: 260,       // spawn entities this far past the right edge
  despawnMargin: 400,
  reachSafety: 0.15,      // gaps use at most (1 - this) of the true max reach
  maxRise: 0.72,          // never ask for a rise bigger than this × full jump height
  minGapSec: 0.16,        // gaps shorter than this many seconds of scroll aren't worth it
  hazardMinSpacingSec: 1.05,
  hazardEdgeSafetySec: 0.42, // keep hazards this far (in seconds) from takeoff/landing edges
  runwaySec: 1.3,         // safe runway after tunnel exit / biome change / start
  startRunwaySec: 2.4,
  surfaceTopMin: 330,     // highest a play-lane surface may sit (smaller y = higher)
  surfaceTopMax: 560,
  groundY: 640,           // road/ground level (hidden behind the sill)
  windowTop: 38,          // = FRAME.top (ceilings reach up to here)
  biomeSec: 50,           // length of a biome in seconds at the speed it starts at
  tunnelSec: [4.5, 6],
};

export const DIFFICULTY = {
  // difficulty 0..1 is derived from run time; it widens gaps and adds hazards.
  rampSec: 200,
  hazardChance: [0.35, 0.75],
  gapFrac: [[0.35, 0.62], [0.55, 0.84]], // fraction of safe reach, [min,max] at diff 0 and 1
};

export const TIME_OF_DAY = {
  cycleSec: 240,          // golden -> dusk -> night -> dawn -> golden
  startPhase: 0.02,
  attractPhase: 0.04,
};

export const AUDIO = {
  master: 0.55,
  music: 0.42,
  sfx: 0.7,
  road: 0.32,
  crackle: 0.09,
  bpm: 80,
};

export const FX = {
  bobAmp: 1.4,
  bumpChancePerSec: 0.08,
  bumpAmp: 5,
  deathBeat: 0.85,        // seconds of death animation before the overlay
};

export const DEBUG_DEFAULT = false;

export const STORAGE_KEY = 'fingerhero.best.v1';
