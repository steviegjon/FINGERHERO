# FINGER HERO

A back-seat endless runner: you are two fingers running along whatever rolls past the car window.

Plain HTML5 Canvas + vanilla ES modules. No build step.

```sh
python3 -m http.server 8000   # or: npx serve
# open http://localhost:8000
```

## Controls
| Key | Action |
|---|---|
| Space / ↑ / W | Jump (hold for higher) |
| ↓ / S | Slide on a surface, fast-fall in the air |
| Space | Start / restart |

## Debug
`?debug=1` or the <kbd>`</kbd> key: hitboxes, FPS, speed/biome/time-of-day.
While debug is on: `I` invincible, `N` next biome, `[` / `]` speed override, `\` clear override.
`?seed=123` reproduces a run.

`node tools/physics-check.mjs` prints jump metrics and checks coyote time / jump buffer.
