# Hand sprite sheet (optional)

Drop `hand.json` + `hand.png` here, then set `"sheet": "hand.json"` in
`manifest.json`. The game switches from the procedural hand to
`SpriteHandRenderer` automatically (see `src/hand.js`); gameplay code is untouched.

`hand.json` format:

```json
{
  "image": "hand.png",
  "anchor": [48, 20],
  "animations": {
    "run":   { "fps": 0, "frames": [[0,0,96,96],[96,0,96,96]] },
    "jump":  { "frames": [[0,96,96,96]] },
    "fall":  { "frames": [[96,96,96,96]] },
    "slide": { "frames": [[192,96,96,96]] },
    "land":  { "frames": [[288,96,96,96]] },
    "dead":  { "frames": [[384,96,96,96]] }
  }
}
```

* `anchor` is the pixel in each frame that sits on the player's position
  (centre of the hand, at the wrist line).
* `run` frames are indexed by the run-cycle phase (0..1), so their count sets
  the cycle resolution. Other states use `fps` (default 12).
* The arm is still drawn procedurally up to the wrist point.
