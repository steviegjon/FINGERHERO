# FINGER HERO

A back-seat endless runner. You're a kid on a road trip, and your index and middle fingers are a
little person racing along whatever rolls past the window: telephone wires, rooftops, the cars
you overtake, truck trailers, trains, treetops. Don't hit the bugs, signs, birds or low bridges,
and don't miss a jump.

Plain HTML5 Canvas 2D + vanilla ES modules. No framework, no build step, no image or audio files:
all art is procedural and all sound is synthesised with Web Audio.

```sh
python3 -m http.server 8000   # or: npx serve
# open http://localhost:8000
```

## Controls
| Key | Action |
|---|---|
| Space / ↑ / W | Jump. Hold for a higher jump. |
| ↓ / S | Slide while on a surface; fast-fall in the air |
| Space | Start / restart |

## What's in it
* **Four biomes** (Countryside → Small Town → Highway → City → loop, faster), ~50 s each, with a
  continuous **time-of-day** cycle (golden hour → dusk → night → dawn).
* **Platforms:** sagging telephone wires (catenary) and pole tops, rooftops (flat / sloped /
  chimneys), cars and trucks you're overtaking (they scroll slower), trains, bouncy treetops,
  bridge railings, tunnel ledges and pipes.
* **Hazards:** bugs (sine flight; big dragonflies and beetles), road signs (slide under or jump
  over), birds that bob their head and take off as you approach, overpasses (slide), chimneys,
  and in tunnels hanging cables and floor vents.
* **Fairness:** every gap is checked against the real jump arc at the speed you'll be going
  (15% safety margin); hazards never sit on a gap edge, never stack, and always leave an answer.

## Code map
```
index.html
src/
  main.js          boot, fixed-timestep loop (1/120 s) + interpolation, state machine
  config.js        ALL tuning constants
  input.js         keyboard
  player.js        finger physics (variable jump, coyote, buffer, slide, fast-fall), jump-arc sim
  hand.js          arm/hand/finger renderer behind drawHand(ctx, state, t); SpriteHandRenderer stub
  audio.js         lo-fi music loop, road hum, SFX
  ui.js            odometer HUD, game-over overlay, title captions
  util.js          seeded RNG, maths, colour
  world/
    world.js       the D axis (distance scrolled), spawning/culling, hazard collision
    generator.js   chunk-based generation, reachability guarantee, hazard placement
    entities.js    Surface / Hazard / Decor base classes
    hazards.js     Bug, Sign, Bird, Overpass, Chimney, Cable, Vent
    vehicles.js    vehicle profiles
    biomes.js      biome data (palettes, pattern + hazard weights), sign text, pattern definitions
  render/
    sky.js         sky gradient, sun/moon/stars/clouds, time-of-day palette
    parallax.js    4 silhouette layers with atmospheric perspective, blurred foreground, streaks
    playlane.js    the solid play lane (rim-lit), vehicles, hazards, bridges, tunnel
    window.js      car window frame, rubber seal, glass sheen/smudges/vignette
    fx.js          particles, bug splats on the glass, flash
    fog.js         the fog-writing title
assets/hand/       drop a sprite sheet here (see its README) to replace the procedural hand
tools/             headless checks (below)
```

Positions live on a **D axis** (distance the world has scrolled). An entity with speed factor `k`
(1 = scenery, <1 = a vehicle you're overtaking) is at `x = PLAYER.x + k·(dLead − D)`. A jump with
airtime τ covers `speed·τ` of D whatever the surfaces' own speeds, so one gap rule covers
rooftops, cars and trains alike.

## Debug & tuning
`?debug=1` or the <kbd>`</kbd> key shows hitboxes, FPS, speed, biome, time of day. While debug is
on: `I` invincible, `N` next biome, `T` advance time of day, `[` / `]` speed override, `\` clear it.
`?seed=123` reproduces a run; `?pattern=train` forces one pattern (see `PATTERNS` in biomes.js).

## Checks
```sh
node tools/physics-check.mjs   # jump height (1.8x player), tap vs hold, coyote time, jump buffer
node tools/gen-check.mjs       # every generated gap is clearable; hazards spaced and answerable
node tools/bot.mjs 6 420       # a planning autopilot plays real runs headless with the game's
                               # own physics and collision; any death flags an unfair layout
```

## Swapping in hand-drawn art
`hand.js` is the only file that knows what the hand looks like. Put `hand.json` + `hand.png` in
`assets/hand/`, set `"sheet": "hand.json"` in `assets/hand/manifest.json`, and the
`SpriteHandRenderer` takes over. Gameplay code doesn't change.
