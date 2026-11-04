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
| `addScore(n, x?, y?)` | adds points, updates HUD, posts `score`, plays `score` sfx + vfx, "+N" popup, combo + callouts (see Juice helpers) |
| `collect(x, y)` | adds `pointsPerCollectible`, plays `collect` sfx + vfx |
| `gameOver(x?, y?)` | ends the run once: hit-stop, flash, shake, slow-mo, death screen, posts `gameOver` |
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

**Depths used by core:** background 0, meme backdrop 0.5–0.6, decor 1–1.5, speed lines 1.8, ground 3, vignette 39,
HUD 40, burst vfx 44, popups 46, overlays 50–60.
Templates typically use 2–8. Trails sit just below the object they follow.

**Sfx/vfx details.** `addScore` rate-limits the score sound to one per 120 ms; its vfx fires on every call
(set `vfx.score.style = "none"` to disable). Default vfx when a slot is missing: trail sparkle, collect sparkle,
hit explosion, score confetti, shoot pixels. Default colours come from the palette. `ctx.trail()` returns the
emitter (or null).

## Juice helpers (game feel)

All are on `ctx`; call them defensively (`ctx.popup?.(...)`) so older cores don't crash. All are cheap and safe to
call every frame (they rate-limit / pool internally) and are no-ops after `gameOver` where that makes sense.

| helper | what |
| --- | --- |
| `popup(text, x, y, opts?)` | floating text: pops in with scale overshoot, holds, rises and fades. `opts = { size?, color?: "#rrggbb", kind?: "score" \| "meme" \| "big", rotate?: deg }`. `score` = small accent "+N"; `meme` = white caps, meme font, random tilt; `big` = huge callout. Pooled (max 14 live; oldest is recycled). Returns the Text or null |
| `hitstop(ms)` | freeze the world for `ms` (clamped 0–200; 40–120 feels right): `update` is not called, scrolling stops, particles pause |
| `shake(intensity)` | camera shake, `0..1` (0.2 = bump, 0.5 = hit, 0.9 = death). A weaker shake never cuts off a stronger running one |
| `flash(color?, ms?)` | full-screen camera flash, `color` `"#rrggbb"` or `0xrrggbb` (default white), `ms` default 110 |
| `slowmo(scale, ms)` | time scale (0.05–1) for `ms`, then eases back to 1. `update` receives the scaled `dtMs` |
| `nearMiss(x, y)` | "CLOSE!" or a meme `good` phrase, +1 bonus point (bumps the combo), 160 ms slow-mo, pitch blip. Rate-limited to one per 700 ms; returns `true` if it fired. Only while live |
| `combo()` | current combo count (read-only). `addScore`/`collect`/`nearMiss` bump it; it resets after 1.5 s without scoring. Don't call it to increment |
| `squash(gameObject, sx, sy, ms?)` | set scale to base × (sx, sy) and spring back (Back.easeOut, default 180 ms). Base scale is captured when no squash is running, so call `setDisplaySize`/`setScale` before, not during, a squash |
| `phrase(kind)` | random meme phrase, `kind` = `"good" \| "bad" \| "milestone"` (already `${ticker}`-interpolated) |
| `meme` | resolved meme settings `{ enabled, good[], bad[], milestone[], backdrop, font, family, ticker }`; `meme.family` is the CSS font family for your own Text objects |

`sfx(slot, pitch?)` also accepts a pitch multiplier (0.5–2.5).

**What core does automatically** (templates don't need to):
- `addScore(n, x, y)`: "+N" popup at x,y, HUD punch, combo bump, score sfx pitched up with the combo, chart pump,
  combo callouts at x3, x5, x10, x15… ("X5 LFG"), milestone callouts at 10/25/50/100/200… and a one-time
  "NEW ATH!" when the run passes the player's best. One callout per score event (best > milestone > combo).
- `collect(x, y)`: same, with the collect sound/vfx.
- `gameOver(x, y)`: 110 ms hit-stop, white flash, big shake, slow-mo (0.3 for ~750 ms) with a small zoom punch, chart
  dumps red, then the death screen (random `bad` phrase stamped in, score, NEW BEST / BEST, "run it back" hint).
  `gameOver` is posted to the parent immediately; `durationMs` is real (unscaled) live time.
- Speed lines that grow with `speed()` and the combo; vignette; glow on the score (WebGL; dropped automatically
  together with speed lines if the frame rate sags; `?lowfx` forces low-fx).
- Title screen (meme-font title, "$TICKER · LIVE ON MONAD" chip, pulsing "TAP TO APE IN"), "GM" on the ready
  screen and "LFG!" on the first input.

**Optional template hook:** `dying(ctx, dtMs)` is called during the ~750 ms slow-mo between `gameOver()` and the
death screen (scaled dt), e.g. to let the player tumble. Without it the world just freezes under the effects.
Title-screen bobbing of the player stays the template's job (`idle`).

## Meme layer

`config.meme` (optional; missing = on with built-in crypto phrases, impact font, `chart` backdrop):
`{ enabled, good?, bad?, milestone?, backdrop?: "none"|"chart"|"matrix"|"grid", font?: "impact"|"pixel"|"clean" }`.
`enabled: false` switches to neutral phrases ("NICE!", "GAME OVER"), the clean font and no backdrop unless one is set.
Phrases support `${ticker}` (e.g. `"$${ticker} TO THE MOON"` → "$PIZZA TO THE MOON"; "MON" when no ticker). When a
ticker is given and no custom milestones, "$TICKER TO THE MOON" style lines are mixed in.

The parent passes `best` and `ticker` with `load` (`<GamePlayer best={…} ticker="PIZZA" />`). The engine raises its
local best after every run, and forgets it when a different config is loaded.

Fonts: `/games/fonts/anton.woff2` (`"PopImpact"`) and `/games/fonts/press-start-2p.woff2` (`"PopPixel"`), declared
in engine.html and awaited before the scene starts (2.5 s timeout, falls back to Impact / Arial Black / monospace).
