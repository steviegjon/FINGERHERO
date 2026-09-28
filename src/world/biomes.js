// Biome definitions: palettes, pattern mix, backdrop layers. All data, easy to art-direct.
//
// Pattern weights refer to ids in PATTERNS (entities.js is the entity code; patterns are data here).

export const BIOME_ORDER = ['country', 'town', 'highway', 'city'];

export const BIOMES = {
  country: {
    name: 'Countryside',
    patterns: { wires: 5, wireGap: 3, trees: 3, tractor: 1.2, truckSolo: 0.6, poleHop: 1.5 },
    hazards: { bug: 3, sign: 2, bird: 3, bigBug: 1 },
    signs: ['farm', 'deer', 'speed45', 'corn'],
    backdrop: ['hills', 'farms', 'treeline'],
    fore: 'fence',
    // colours are multiplied/tinted by time of day in render/sky.js
    tint: '#6f7a4a',     // mid-ground silhouette hue bias
    ground: '#3b3a26',
    music: { chords: 0, filter: 1400 },
  },
  town: {
    name: 'Small Town',
    patterns: { rooftops: 5, carConvoy: 2.5, wires: 2, trees: 1.5, overpass: 0.8 },
    hazards: { bug: 2, sign: 3, bird: 2, chimney: 0 },
    signs: ['welcome', 'speed30', 'school', 'diner'],
    backdrop: ['hills', 'steeple', 'storefronts'],
    fore: 'hedge',
    tint: '#6a5a50',
    ground: '#34302c',
    music: { chords: 1, filter: 1700 },
  },
  highway: {
    name: 'Highway',
    patterns: { truckConvoy: 4, carConvoy: 3, overpass: 2, tunnel: 0, bridge: 1.5 },
    hazards: { bug: 2.5, sign: 2.5, bigBug: 1.5 },
    signs: ['green', 'exit', 'speed65', 'rest'],
    backdrop: ['mountains', 'billboards', 'guardrailBack'],
    fore: 'guardrail',
    tint: '#4f5866',
    ground: '#2a2d33',
    music: { chords: 2, filter: 2000 },
  },
  city: {
    name: 'City',
    patterns: { tallRooftops: 5, train: 3, bridge: 1.5, overpass: 1, carConvoy: 1 },
    hazards: { pigeon: 3, sign: 1.5, bug: 1 },
    signs: ['metro', 'speed25', 'oneway', 'welcomeCity'],
    backdrop: ['skylineFar', 'skylineMid', 'rowhouses'],
    fore: 'posts',
    tint: '#4c4a5e',
    ground: '#26252e',
    music: { chords: 3, filter: 2600 },
  },
};

// Invented sign content. No real brands.
export const SIGNS = {
  farm: { shape: 'rect', bg: '#f1e7c9', fg: '#5a3b1c', lines: ['FRESH', 'EGGS'], w: 70 },
  corn: { shape: 'rect', bg: '#e9d27a', fg: '#40310f', lines: ['SWEET', 'CORN'], w: 70 },
  deer: { shape: 'diamond', bg: '#f3c93b', fg: '#1b1b1b', icon: 'deer', w: 56 },
  speed45: { shape: 'rect', bg: '#f4f4f0', fg: '#111', lines: ['SPEED', 'LIMIT', '45'], w: 50 },
  speed30: { shape: 'rect', bg: '#f4f4f0', fg: '#111', lines: ['SPEED', 'LIMIT', '30'], w: 50 },
  speed25: { shape: 'rect', bg: '#f4f4f0', fg: '#111', lines: ['SPEED', 'LIMIT', '25'], w: 50 },
  speed65: { shape: 'rect', bg: '#f4f4f0', fg: '#111', lines: ['SPEED', 'LIMIT', '65'], w: 50 },
  welcome: { shape: 'rect', bg: '#2f5b3a', fg: '#f3ecd6', lines: ['WELCOME TO', 'MAPLEWICK'], w: 118 },
  welcomeCity: { shape: 'rect', bg: '#26436b', fg: '#f3f3f3', lines: ['NOW ENTERING', 'PORT HALVERN'], w: 118 },
  school: { shape: 'pent', bg: '#d8e24a', fg: '#111', icon: 'kids', w: 54 },
  diner: { shape: 'rect', bg: '#b8322b', fg: '#fff3dc', lines: ['DOT\'S', 'DINER'], w: 78 },
  green: { shape: 'rect', bg: '#1f6b3d', fg: '#f4f4f4', lines: ['ROUTE 9', 'NORTH ↑'], w: 110 },
  exit: { shape: 'rect', bg: '#1f6b3d', fg: '#f4f4f4', lines: ['EXIT 42', 'LAKE ODEN'], w: 110 },
  rest: { shape: 'rect', bg: '#2b4f8c', fg: '#f4f4f4', lines: ['REST', 'AREA 2 MI'], w: 90 },
  metro: { shape: 'rect', bg: '#2b2b2b', fg: '#f2c14e', lines: ['METRO', 'LINE B'], w: 76 },
  oneway: { shape: 'arrow', bg: '#111', fg: '#fff', lines: ['ONE WAY'], w: 92 },
};

// ---------------------------------------------------------------------------
// Chunk patterns. Each is data: which builder to run, its parameter ranges and difficulty gating.
// `minDiff` gates by difficulty (0..1). Weights per biome live in BIOMES[*].patterns.
// Builders live in generator.js and interpret these parameters; hazards are sprinkled afterwards
// by the generator's fairness-aware placer, using `hazardSlots` as the max number per pattern.
export const PATTERNS = {
  wires:        { builder: 'wires', minDiff: 0, spans: [4, 7], missing: 0, hazardSlots: 2, tags: ['easy'] },
  wireGap:      { builder: 'wires', minDiff: 0.05, spans: [3, 6], missing: [1, 2], hazardSlots: 1, tags: ['gap'] },
  poleHop:      { builder: 'poleHop', minDiff: 0.2, poles: [3, 5], hazardSlots: 0, tags: ['precise'] },
  trees:        { builder: 'trees', minDiff: 0, count: [2, 4], hazardSlots: 0, tags: ['bouncy'] },
  rooftops:     { builder: 'roofs', minDiff: 0, count: [3, 6], w: [170, 360], tops: [430, 540], dy: 55, chimney: 0.3, hazardSlots: 2, tags: ['gap'] },
  tallRooftops: { builder: 'roofs', minDiff: 0, count: [4, 7], w: [210, 400], tops: [340, 470], dy: 70, chimney: 0.15, tall: true, hazardSlots: 2, tags: ['gap'] },
  carConvoy:    { builder: 'cars', minDiff: 0, count: [2, 4], k: [0.42, 0.62], hazardSlots: 1, tags: ['moving'] },
  truckConvoy:  { builder: 'trucks', minDiff: 0, count: [1, 3], k: [0.55, 0.7], hazardSlots: 2, tags: ['moving', 'breather'] },
  truckSolo:    { builder: 'trucks', minDiff: 0, count: [1, 1], k: [0.5, 0.62], hazardSlots: 1, tags: ['breather'] },
  tractor:      { builder: 'tractor', minDiff: 0, k: [0.26, 0.34], hazardSlots: 0, tags: ['moving'] },
  train:        { builder: 'train', minDiff: 0, cars: [4, 6], k: [0.26, 0.32], hazardSlots: 3, tags: ['breather'] },
  bridge:       { builder: 'bridge', minDiff: 0, sec: [4, 6.5], hazardSlots: 3, tags: ['breather'] },
  overpass:     { builder: 'overpass', minDiff: 0.05, hazardSlots: 0, tags: ['slide'] },
  tunnel:       { builder: 'tunnel', minDiff: 0, hazardSlots: 0, tags: ['special'] },
};
