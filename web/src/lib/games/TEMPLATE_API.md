# Game engine template API

The engine runs in a sandboxed iframe (`/games/engine.html`, `sandbox="allow-scripts"`, opaque origin).
It is split into a shared core and one file per template:

```
web/public/games/
  engine.html          loads phaser.min.js, core.js, then every templates/*.js
  core.js              boot, postMessage protocol, validation, assets, sfx, vfx, HUD, title/game-over screens
  templates/flappy.js
  templates/runner.js
  templates/shooter.js
  templates/dodge.js
```

Plain browser JS (no bundler, no imports). `core.js` defines `window.POP`. Each template file calls
`POP.registerTemplate(id, template)` at load time.

## Template object

```js
POP.registerTemplate("shooter", {
  titleHint: "DRAG TO MOVE",       // shown on the "ready" screen after start
  background: true,                 // core draws gradient sky + decor parallax (default true)
  create(ctx) {},                   // build the world; textures are ready
  update(ctx, dtMs) {},             // every frame while the run is live (after the first input)
  onInput(ctx, input) {},           // optional: tap / pointer down (input.x, input.y)
});
```

The run starts on the player's first input after the parent sends `start`; until then `update` is not called.

## ctx (provided by core)

| field | what |
| --- | --- |
| `scene` | the Phaser.Scene (arcade physics enabled, gravity 0 — templates set their own) |
| `config` | validated GameConfig |
| `W`, `H` | logical size 480 x 720 |
| `groundY` | y of the ground line (runner); core draws ground only if the template asks via `ctx.drawGround()` |
| `tex` | texture keys: `player`, `obstacle`, `collectible?`, `decor?`, `projectile?`, `particle` |
| `palette` | config.palette |
| `rng()` | seeded random in [0,1) |
| `elapsedMs` | time since the run started |
| `speed()` | current speed: `physics.scrollSpeed + physics.speedRampPerSec * elapsedSec` |
| `addScore(n, x?, y?)` | adds points, updates HUD, posts `score`, plays `score` sfx + vfx at x,y |
| `collect(x, y)` | adds `pointsPerCollectible`, plays `collect` sfx + vfx |
| `gameOver(x?, y?)` | ends the run once: `hit` sfx + vfx, shake, game-over screen, posts `gameOver` |
| `sfx(slot)` | `jump` `score` `collect` `hit` `shoot` (uploaded audio, built-in synth, or muted) |
| `vfx(slot, x, y)` | one-shot burst: `collect` `hit` `score` `shoot` |
| `trail(gameObject)` | attaches the `trail` vfx emitter to follow an object (no-op if style is none) |
| `input` | live state: `{ pointerX, pointerY, pointerDown, left, right, up, action }` (keyboard + touch) |
| `drawGround()` | draws the ground band, returns its top y |

## Assets

`config.sprites.*` is inline SVG or `"asset:0x…"`. Sound slots in `config.sfx` are `"asset:0x…"`, `"none"`,
or missing (built-in synth). The parent sends `assets: { "asset:0x…": "data:…" }` with the `load` message,
so the iframe never fetches. Core turns every sprite into a texture key and every sound into a playable
sound; templates only use `ctx.tex.*`, `ctx.sfx()`, `ctx.vfx()`.

Uploaded images keep their aspect ratio and are scaled to the slot's nominal size
(player 48, obstacle per template, collectible 32, decor 128x64, projectile 8x20).

## Extras implemented by core (additive to the contract above)

**Lifecycle.** The Phaser scene is restarted for every run (`start` → fresh scene) and on `reset`/`load`,
so `create(ctx)` runs once per run with a fresh `ctx`. Keep per-run state on ctx (e.g. `ctx._shooter = {...}`);
no manual reset is needed. Phases: `title` → (parent `start`) → `armed` → (first input) → `live` → `over`.
- `update(ctx, dtMs)` is called only while `live`; `dtMs` is clamped to 50.
- `onInput` is also called for the input that starts the run (so the first tap flaps/jumps), except when the run
  was started by a left/right key (`input.move === true`), which only starts it.
- Inputs that start the run on the armed screen: pointer down, Space, Up, W, Left, Right, A, D.
- After `ctx.gameOver()` nothing else is called; the game-over screen shows until the parent sends `start`/`reset`.

**Optional template fields.**

| field | default | what |
| --- | --- | --- |
| `groundY` | 610 | sets `ctx.groundY` (flappy 660, runner 610) |
| `sizes` | see Assets | per-slot nominal size override, e.g. `{ obstacle: { w: 72, h: 620, mode: "width" } }`; `mode: "fit"` (default) fits inside w×h keeping aspect, `"width"` fixes width and lets height follow aspect (clamped to [w, h]) |
| `decorDirection` | `"left"` | `"down"` makes decor drift downward (vertical games); the ground tile only scrolls for `"left"` |
| `trailDrift` | `{x:-180,y:0}` (`{x:0,y:160}` when decor goes down) | px/s velocity given to trail particles, so trails stream away from a stationary player |
| `idle(ctx, dtMs)` | – | called every frame on the title / armed screens (idle bobbing etc.) |

**Extra ctx fields.**

| field | what |
| --- | --- |
| `size` | `{ player: {w,h}, obstacle, collectible?, decor?, projectile? }` — texture sizes after scaling. Textures are rasterised at exactly this size, so `scene.add.image(x, y, ctx.tex.player)` is already the nominal size |
| `phase` | `"title" \| "armed" \| "live" \| "over"` |
| `score` | current score (read-only; use `addScore` / `collect`) |

**Depths used by core:** background 0, decor 1–1.5, ground 3, HUD 40, burst vfx 44, overlays 50–60.
Templates typically use 2–8. Trails sit just below the object they follow.

**Sfx/vfx details.** `addScore` rate-limits the score sound to one per 250 ms; its vfx fires on every call
(set `vfx.score.style = "none"` to disable). Default vfx when a slot is missing: trail sparkle, collect sparkle,
hit explosion, score confetti, shoot pixels. Default colours come from the palette. `ctx.trail()` returns the
emitter (or null).
