// Server-only module: calls Claude to turn a prompt into a GameConfig.
import Anthropic from "@anthropic-ai/sdk";
import { gameConfigSchema, TEMPLATES, VFX_STYLES, VFX_SLOTS, MEME_BACKDROPS, isAssetRef, type GameConfig, type TemplateId } from "@/lib/game-config";
import { SAMPLE_CONFIGS } from "./sample-configs";

const MODEL = "claude-sonnet-5-5";

let _client: Anthropic | null = null;
const client = () => (_client ??= new Anthropic());

export class GenerationError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

/* ------------------------------------------------------------------ */
/* JSON schema for structured output (ranges are enforced by clamping  */
/* + zod afterwards; structured outputs don't take numeric bounds).    */
/* ------------------------------------------------------------------ */
const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const OUTPUT_SCHEMA = obj({
  version: { type: "integer", enum: [1] },
  template: { type: "string", enum: [...TEMPLATES] },
  title: str("2-40 chars"),
  tagline: str("max 90 chars"),
  scoreLabel: str("max 16 chars, e.g. 'pipes', 'metres', 'cucumbers'"),
  palette: obj({
    sky: str("#rrggbb background top"),
    skyBottom: str("#rrggbb background bottom"),
    ground: str("#rrggbb"),
    accent: str("#rrggbb UI highlights / particles"),
    text: str("#rrggbb HUD text, high contrast vs sky"),
  }),
  sprites: obj({
    player: str("inline SVG ~48x48 (flappy/runner: facing right; shooter/dodge: facing up), or keep an existing 'asset:0x..' value unchanged"),
    obstacle: str("inline SVG; flappy: tall pipe ~72x560 with its cap at the TOP; runner: ground obstacle ~48x64; shooter: enemy ~48x48 facing down; dodge: falling hazard ~40x40"),
    collectible: str("inline SVG ~32x32"),
    decor: str("inline SVG background element ~128x64"),
    projectile: str("inline SVG bullet ~8x20 pointing up (only used by shooter; for other templates give a tiny placeholder <svg>)"),
  }),
  physics: obj({
    gravity: num("300..2500 px/s^2"),
    jumpVelocity: num("250..1000 px/s"),
    scrollSpeed: num("120..600 px/s"),
    speedRampPerSec: num("0..15"),
  }),
  obstacles: obj({
    spawnIntervalMs: num("300..2600"),
    gapSize: num("110..280 (flappy vertical gap; runner ignores)"),
    variance: num("0..1"),
  }),
  scoring: obj({
    pointsPerObstacle: { type: "integer", description: "1..10" },
    collectibleChance: num("0..1"),
    pointsPerCollectible: { type: "integer", description: "0..25" },
  }),
  tuning: obj({
    playerSpeed: num("200..900 px/s sideways movement (shooter, dodge)"),
    fireRateMs: num("120..800 ms between shots (shooter)"),
    enemyHp: { type: "integer", description: "1..5 hits per enemy (shooter)" },
  }),
  meme: obj({
    enabled: { type: "boolean" },
    good: { type: "array", items: str("max 24 chars, ALL CAPS shout"), description: "8-12 hype shouts for combos/near misses" },
    bad: { type: "array", items: str("max 24 chars"), description: "5-8 death lines" },
    milestone: { type: "array", items: str("max 24 chars; may use ${ticker}"), description: "4-8 milestone / new-best lines" },
    backdrop: { type: "string", enum: [...MEME_BACKDROPS] },
    font: { type: "string", enum: ["impact", "pixel", "clean"] },
  }),
  vfx: obj(
    Object.fromEntries(
      VFX_SLOTS.map((slot) => [
        slot,
        obj({
          style: { type: "string", enum: [...VFX_STYLES] },
          colors: { type: "array", items: str("#rrggbb"), description: "1-3 colours" },
        }),
      ]),
    ),
  ),
});

/* ------------------------------------------------------------------ */
/* Prompt                                                              */
/* ------------------------------------------------------------------ */
// Few-shot examples: one per template, from the hand-made demo samples.
const EXAMPLES = TEMPLATES.map((t) => SAMPLE_CONFIGS.find((x) => x.config.template === t)).filter(
  (x): x is (typeof SAMPLE_CONFIGS)[number] => !!x,
);

const SYSTEM = `You design tiny 2D arcade games for "Proof-of-Play". You output ONE JSON game config that a pre-built Phaser template renders. You never write game code, only the config.

TEMPLATES
- "flappy": player hovers in the air; each tap/click applies an upward impulse (jumpVelocity) against gravity. Obstacles are pairs of vertical columns (top + bottom) with a vertical gap (gapSize) the player flies through. Best for anything that flies, swims, floats, bounces through gaps.
- "runner": player runs along the ground; tap = jump. Obstacles spawn on the ground and must be jumped over; gapSize is ignored. Best for anything that runs, skates, drives, hops over things.
- "shooter": vertical shooter. Player at the bottom moves sideways (drag/arrows) and auto-fires projectiles upward; enemies (the obstacle sprite) descend from the top and are destroyed for points. Best for space battles, defending, blasting, zapping anything.
- "dodge": player at the bottom moves left/right; hazards (the obstacle sprite) fall from the sky and collectibles fall too. Survive and catch. Best for "avoid falling X", "catch Y", rain/meteor/kitchen chaos themes.
Pick the template that best fits the player's prompt unless one is mandated.

FIELDS AND RANGES (stay inside them)
- version: always 1.
- title 2-40 chars, catchy. tagline <= 90 chars. scoreLabel <= 16 chars, the plural thing being counted (e.g. "cucumbers").
- palette: 6-digit hex colours. sky -> skyBottom is a vertical gradient. text must have strong contrast against sky AND skyBottom (WCAG >= 4.5:1). ground must be distinguishable from skyBottom. Obstacles and player must stand out clearly against the background.
- physics: gravity 300-2500, jumpVelocity 250-1000, scrollSpeed 120-600, speedRampPerSec 0-15.
- obstacles: spawnIntervalMs 300-2600, gapSize 110-280, variance 0-1.
- tuning: playerSpeed 200-900, fireRateMs 120-800, enemyHp int 1-5 (only shooter/dodge use these; give sensible values anyway).
- vfx: one particle preset per slot (trail, collect, hit, score, shoot). style is one of ${VFX_STYLES.join(", ")}; colors are 1-3 hex colours from or matching the palette. Pick styles that fit the theme (e.g. underwater = bubbles, space = sparkle/pixels, fire level = fire, candy = confetti, crash = explosion/smoke). Use "none" for slots that would be noisy.
- scoring: pointsPerObstacle int 1-10, collectibleChance 0-1, pointsPerCollectible int 0-25.

DIFFICULTY: a typical first-time player should survive roughly 20-60 seconds. Sensible starting points:
- flappy: gravity 900-1300, jumpVelocity 380-480, scrollSpeed 160-230, speedRampPerSec 1-3, spawnIntervalMs 1400-1900, gapSize 150-200, variance 0.3-0.6.
- runner: gravity 1800-2400, jumpVelocity 650-850, scrollSpeed 260-360, speedRampPerSec 4-8, spawnIntervalMs 1000-1600, variance 0.3-0.7.
- shooter: scrollSpeed (enemy fall speed) 120-200, speedRampPerSec 2-5, spawnIntervalMs 600-1100, variance 0.4-0.8, playerSpeed 400-520, fireRateMs 220-340, enemyHp 1-2. gravity/jumpVelocity/gapSize are ignored.
- dodge: scrollSpeed (fall speed) 220-320, speedRampPerSec 4-8, spawnIntervalMs 450-800, variance 0.5-0.9, playerSpeed 420-560, collectibleChance 0.25-0.45. gravity/jumpVelocity/gapSize are ignored.
Tweak toward the prompt's mood (e.g. "frantic" = faster, "chill" = slower) but keep it playable.

SPRITES: each is a compact, self-contained inline SVG string.
- Root <svg xmlns="http://www.w3.org/2000/svg" viewBox="..." width="..." height="..."> with explicit numeric width/height matching the viewBox.
- Sizes: player 48x48 (facing RIGHT for flappy/runner, facing UP for shooter/dodge); obstacle: shooter = enemy 48x48 facing DOWN, dodge = falling hazard 40x40, flappy = one tall pipe about 72x560 drawn upright with its cap/end at the TOP (the engine flips it for the upper pipe), runner = ground obstacle about 48x64 sitting on its bottom edge; collectible 32x32; decor 128x64 background parallax element (clouds, hills, stars...).
- Use only basic shapes/paths/gradients. NO <script>, NO <image>, NO <foreignObject>, NO <text>, NO event handlers, NO external references or URLs (href only to internal "#id"), NO CSS @import. Transparent background.
- Keep each under ~3000 characters. Bold, simple, readable at small size, on-theme, consistent style across sprites.

VOICE AND MEMES: players are crypto degens on Monad (a very fast, purple-branded L1). Lean HARD into meme culture while staying on the prompt's theme:
- title: punchy, meme-able, can pun on crypto ("Rug Runner", "Gas Fee Flapper", "Jeet Invaders"). tagline: one funny line in degen voice.
- scoreLabel: crypto-flavoured where it fits ("sats", "bags", "pumps", "jeets", "candles", "rugs dodged").
- meme.enabled true. meme.good: hype shouts mixing classics (LFG, WAGMI, GM, BULLISH, FEW, SER, BASED, APE IN, SEND IT) with theme-specific ones. meme.bad: death lines (REKT, NGMI, IT'S SO OVER, RUGGED, LIQUIDATED, PAPER HANDS) plus a themed one. meme.milestone: number-go-up lines (NUMBER GO UP, WE'RE SO BACK, TO THE MOON, ATH, PARABOLIC, MONAD SPEED); you may use "$\${ticker} TO THE MOON" style with the literal text \${ticker}.
- meme.backdrop: "chart" (a pumping candlestick chart, the default and best for anything trading/money/crypto themed), "matrix" (hacker/tech), "grid" (synthwave/neon/retro), "none" (when the theme is calm or the art is busy). meme.font: "impact" (classic meme captions, default), "pixel" (retro/8-bit themes), "clean".
- Crypto prompts map naturally: candles = obstacles or collectibles, rugs/jeets/bears = enemies, bags/sats/coins = collectibles, a frog/dog/cat mascot = player. Keep everything original: do not copy real logos, brands or specific copyrighted characters.

UPLOADED ASSETS: in edit mode some sprites may be "asset:0x..." strings (the creator's own uploads). Copy those values back unchanged unless the request explicitly asks to replace that sprite.

Respond with only the JSON object.

EXAMPLES (for format and quality only - never copy their themes):
${EXAMPLES.map((x) => `Prompt: "${x.prompt}"\n${JSON.stringify(x.config)}`).join("\n\n")}`;

/* ------------------------------------------------------------------ */
/* Sanitising / repairing                                              */
/* ------------------------------------------------------------------ */
export function sanitizeSvg(svg: string): string {
  let s = String(svg).trim();
  // Drop anything before the root <svg (e.g. xml prolog) and after </svg>.
  const start = s.indexOf("<svg");
  const end = s.lastIndexOf("</svg>");
  if (start >= 0 && end > start) s = s.slice(start, end + 6);
  s = s
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script[^>]*\/?>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, "")
    .replace(/<image\b[^>]*\/?>(?:[\s\S]*?<\/image>)?/gi, "")
    // on* event handler attributes
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    // href / xlink:href not pointing to an internal fragment
    .replace(/\s+(?:xlink:)?href\s*=\s*(?:"(?!#)[^"]*"|'(?!#)[^']*'|(?!["'#])[^\s>]+)/gi, "")
    // url(...) references to anything but #id (styles / fill attrs)
    .replace(/url\(\s*(['"]?)(?!#)[^)]*\)/gi, "none")
    .replace(/@import[^;]*;?/gi, "");
  // Ensure explicit width/height on the root element (templates rasterise it).
  s = s.replace(/^<svg\b([^>]*)>/i, (whole, attrs: string) => {
    let a = attrs;
    if (!/\sxmlns\s*=/.test(a)) a = ` xmlns="http://www.w3.org/2000/svg"` + a;
    const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(a);
    if (vb) {
      if (!/\swidth\s*=/.test(a)) a += ` width="${vb[1]}"`;
      if (!/\sheight\s*=/.test(a)) a += ` height="${vb[2]}"`;
    }
    return `<svg${a}>`;
  });
  return s;
}

const clamp = (v: unknown, min: number, max: number, int = false, fallback = min) => {
  let n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n)) n = fallback;
  n = Math.min(max, Math.max(min, n));
  return int ? Math.round(n) : n;
};

const fixHex = (v: unknown, fallback: string) => {
  if (typeof v !== "string") return fallback;
  let s = v.trim();
  if (!s.startsWith("#")) s = "#" + s;
  if (/^#[0-9a-fA-F]{3}$/.test(s)) s = "#" + [...s.slice(1)].map((c) => c + c).join("");
  if (/^#[0-9a-fA-F]{8}$/.test(s)) s = s.slice(0, 7); // drop alpha
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : fallback;
};

const cut = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : v);

/** Best-effort repair of obviously out-of-range / malformed values before zod. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function repair(raw: any, forcedTemplate?: TemplateId): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const c = structuredClone(raw);
  c.version = 1;
  if (forcedTemplate) c.template = forcedTemplate;
  c.title = cut(c.title, 40);
  c.tagline = cut(c.tagline ?? "", 90);
  c.scoreLabel = cut(c.scoreLabel ?? "points", 16);
  const p = (c.palette ??= {});
  p.sky = fixHex(p.sky, "#1d3557");
  p.skyBottom = fixHex(p.skyBottom, p.sky);
  p.ground = fixHex(p.ground, "#2a9d8f");
  p.accent = fixHex(p.accent, "#ffb703");
  p.text = fixHex(p.text, "#ffffff");
  const s = (c.sprites ??= {});
  for (const k of ["player", "obstacle", "collectible", "decor", "projectile"]) {
    const optional = k !== "player" && k !== "obstacle";
    if (isAssetRef(s[k])) continue; // creator upload: keep as-is
    if (typeof s[k] === "string" && s[k].trim()) s[k] = sanitizeSvg(s[k]);
    else if (optional) delete s[k];
    // Optional sprites that are broken get dropped rather than failing the game.
    if (optional && s[k] && (s[k].length > 12_000 || !s[k].includes("</svg>"))) delete s[k];
  }
  if (c.template !== "shooter") delete s.projectile;
  const ph = (c.physics ??= {});
  ph.gravity = clamp(ph.gravity, 300, 2500, false, 1100);
  ph.jumpVelocity = clamp(ph.jumpVelocity, 250, 1000, false, 450);
  ph.scrollSpeed = clamp(ph.scrollSpeed, 120, 600, false, 200);
  ph.speedRampPerSec = clamp(ph.speedRampPerSec, 0, 15, false, 2);
  const ob = (c.obstacles ??= {});
  ob.spawnIntervalMs = clamp(ob.spawnIntervalMs, 300, 2600, false, 1500);
  ob.gapSize = clamp(ob.gapSize, 110, 280, false, 170);
  ob.variance = clamp(ob.variance, 0, 1, false, 0.5);
  const sc = (c.scoring ??= {});
  sc.pointsPerObstacle = clamp(sc.pointsPerObstacle, 1, 10, true, 1);
  sc.collectibleChance = clamp(sc.collectibleChance, 0, 1, false, 0.3);
  sc.pointsPerCollectible = clamp(sc.pointsPerCollectible, 0, 25, true, 3);
  const tu = (c.tuning ??= {});
  tu.playerSpeed = clamp(tu.playerSpeed, 200, 900, false, 450);
  tu.fireRateMs = clamp(tu.fireRateMs, 120, 800, false, 280);
  tu.enemyHp = clamp(tu.enemyHp, 1, 5, true, 1);
  if (c.meme && typeof c.meme === "object") {
    const m = c.meme;
    m.enabled = m.enabled !== false;
    for (const k of ["good", "bad", "milestone"]) {
      const arr = (Array.isArray(m[k]) ? m[k] : []).filter((x: unknown) => typeof x === "string" && x.trim()).map((x: string) => x.trim().slice(0, 24)).slice(0, 16);
      if (arr.length) m[k] = arr;
      else delete m[k];
    }
    if (!(MEME_BACKDROPS as readonly string[]).includes(m.backdrop)) delete m.backdrop;
    if (!["impact", "pixel", "clean"].includes(m.font)) delete m.font;
  }
  if (c.vfx && typeof c.vfx === "object") {
    for (const slot of Object.keys(c.vfx)) {
      const v = c.vfx[slot];
      if (!v || !(VFX_STYLES as readonly string[]).includes(v.style)) {
        delete c.vfx[slot];
        continue;
      }
      const colors = (Array.isArray(v.colors) ? v.colors : []).map((x: unknown) => fixHex(x, "")).filter(Boolean).slice(0, 4);
      if (colors.length) v.colors = colors;
      else delete v.colors;
    }
  }
  return c;
}

/* ------------------------------------------------------------------ */
/* Claude call                                                          */
/* ------------------------------------------------------------------ */
async function callClaude(userContent: string): Promise<unknown> {
  const t0 = Date.now();
  const response = await client().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
    system: SYSTEM,
    messages: [{ role: "user", content: userContent }],
  });

  console.log(
    `[claude] ${response.model} ${Date.now() - t0}ms in=${response.usage.input_tokens} out=${response.usage.output_tokens} stop=${response.stop_reason}`,
  );
  if (response.stop_reason === "refusal") {
    throw new GenerationError("The model declined this prompt. Try a different idea.", 422);
  }
  if (response.stop_reason === "max_tokens") {
    throw new GenerationError("Generation was cut off (too long).", 502);
  }
  const text = response.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
  try {
    return JSON.parse(text);
  } catch {
    // Fallback: grab the outermost {...}
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new GenerationError("Model returned invalid JSON.", 502);
  }
}

function buildUserMessage(prompt: string, template?: TemplateId, base?: GameConfig): string {
  const tpl = template ? `\nTemplate is mandated: "${template}".` : "";
  if (base) {
    return `EDIT MODE. Here is the current game config:\n${JSON.stringify(base)}\n\nModify it according to this request, changing only what the request implies and keeping everything else (including sprites) as-is unless asked:${tpl}\n<request>${prompt}</request>`;
  }
  return `Create a game for this player prompt:${tpl}\n<prompt>${prompt}</prompt>`;
}

/** In edit mode, keep the creator's uploaded sounds and particle images (the model never outputs them). */
function keepUploads(next: GameConfig, base?: GameConfig): GameConfig {
  if (!base) return next;
  const out: GameConfig = { ...next };
  if (base.sfx) out.sfx = { ...base.sfx };
  if (base.vfx) {
    const vfx = { ...(out.vfx ?? {}) } as NonNullable<GameConfig["vfx"]>;
    for (const [slot, preset] of Object.entries(base.vfx) as [keyof typeof vfx, NonNullable<GameConfig["vfx"]>[keyof typeof vfx]][]) {
      if (preset?.texture && vfx[slot]) vfx[slot] = { ...vfx[slot]!, texture: preset.texture };
    }
    out.vfx = vfx;
  }
  return out;
}

export async function generateGameConfig(
  prompt: string,
  opts: { template?: TemplateId; base?: GameConfig } = {},
): Promise<GameConfig> {
  const forced = opts.template;
  const userMsg = buildUserMessage(prompt, opts.template, opts.base);

  let raw = await callClaude(userMsg);
  let result = gameConfigSchema.safeParse(repair(raw, forced));
  if (result.success) return keepUploads(result.data, opts.base);

  // One retry, feeding back the validation errors.
  const issues = result.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n");
  raw = await callClaude(
    `${userMsg}\n\nA previous attempt produced this config:\n${JSON.stringify(raw).slice(0, 20_000)}\n\nIt failed validation:\n${issues}\n\nReturn a corrected full config.`,
  );
  result = gameConfigSchema.safeParse(repair(raw, forced));
  if (result.success) return keepUploads(result.data, opts.base);
  throw new GenerationError(
    "Generated config failed validation: " + result.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; "),
    502,
  );
}
