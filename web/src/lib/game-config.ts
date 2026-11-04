import { z } from "zod";

/**
 * The single contract between the AI generator, the game templates and the
 * launch flow. Claude writes one of these from a prompt; a template renders it.
 * Creators can swap any sprite or sound for an uploaded file (an `asset:` ref).
 */

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "6-digit hex colour like #12ab34");

/** Uploaded file stored at /api/asset/<0x hash>. Referenced as "asset:0x…". */
export const assetRef = z.string().regex(/^asset:0x[0-9a-f]{64}$/, "asset:0x<64 hex>");
export type AssetRef = z.infer<typeof assetRef>;
export const isAssetRef = (s: unknown): s is AssetRef => typeof s === "string" && /^asset:0x[0-9a-f]{64}$/.test(s);
export const assetIdOf = (ref: AssetRef) => ref.slice("asset:".length) as `0x${string}`;

// Inline SVG markup. Templates rasterise it into a texture.
const svg = z
  .string()
  .max(12_000)
  .refine((s) => s.trim().startsWith("<svg") && s.includes("</svg>"), "must be a complete <svg>…</svg>");

/** A sprite is either AI-drawn inline SVG or an uploaded image (PNG/JPG/GIF/WebP/SVG). */
const sprite = z.union([svg, assetRef]);

export const TEMPLATES = ["flappy", "runner", "shooter", "dodge"] as const;
export type TemplateId = (typeof TEMPLATES)[number];

export const TEMPLATE_INFO: Record<TemplateId, { label: string; control: string; obstacle: string }> = {
  flappy: { label: "Tap to fly", control: "tap to flap upward", obstacle: "pipe/column pair with a gap" },
  runner: { label: "Endless runner", control: "tap to jump", obstacle: "ground obstacle to jump over" },
  shooter: { label: "Space shooter", control: "drag / arrows to move, auto-fire", obstacle: "enemy that descends; shoot it" },
  dodge: { label: "Dodge & catch", control: "drag / arrows to move left-right", obstacle: "falling hazard to avoid" },
};

/** Particle effect preset. Templates map styles to Phaser emitters. */
export const VFX_STYLES = ["none", "sparkle", "confetti", "smoke", "explosion", "bubbles", "pixels", "fire"] as const;
const vfxPreset = z.object({
  style: z.enum(VFX_STYLES),
  colors: z.array(hex).min(1).max(4).optional(), // defaults to palette accent/text
  texture: assetRef.optional(), // uploaded particle image replaces the default dot
});
export type VfxPreset = z.infer<typeof vfxPreset>;

/** Sound slot: uploaded audio, "none" to mute, or omitted for the built-in synth sound. */
const sound = z.union([assetRef, z.literal("none")]);

export const SFX_SLOTS = ["jump", "score", "collect", "hit", "shoot", "music"] as const;
export const VFX_SLOTS = ["trail", "collect", "hit", "score", "shoot"] as const;

export const gameConfigSchema = z.object({
  version: z.literal(1),
  template: z.enum(TEMPLATES),
  title: z.string().min(2).max(40),
  tagline: z.string().max(90),
  /** Short label for the score, e.g. "pipes", "metres", "coins". */
  scoreLabel: z.string().max(16),
  palette: z.object({
    sky: hex, // background top
    skyBottom: hex, // background bottom (vertical gradient)
    ground: hex,
    accent: hex, // UI highlights, particles
    text: hex, // HUD text, must contrast with sky
  }),
  sprites: z.object({
    player: sprite, // ~48x48; flappy/runner face right, shooter/dodge face up
    obstacle: sprite, // flappy: tall pipe (cap at top); runner: ground obstacle ~48x64; shooter: enemy ~48x48 facing down; dodge: falling hazard ~40x40
    collectible: sprite.optional(), // ~32x32
    decor: sprite.optional(), // background parallax element, ~128x64 (clouds, hills, stars)
    projectile: sprite.optional(), // shooter bullet ~8x20
  }),
  physics: z.object({
    gravity: z.number().min(300).max(2500), // px/s^2 (flappy, runner)
    jumpVelocity: z.number().min(250).max(1000), // px/s upward on tap (flappy, runner)
    scrollSpeed: z.number().min(120).max(600), // px/s at start: scroll (flappy/runner) or fall speed (shooter/dodge)
    speedRampPerSec: z.number().min(0).max(15), // px/s added each second
  }),
  obstacles: z.object({
    spawnIntervalMs: z.number().min(300).max(2600),
    gapSize: z.number().min(110).max(280), // flappy only
    variance: z.number().min(0).max(1), // 0 = regular, 1 = chaotic placement
  }),
  scoring: z.object({
    pointsPerObstacle: z.number().int().min(1).max(10), // passed (flappy/runner/dodge) or destroyed (shooter)
    collectibleChance: z.number().min(0).max(1), // chance per obstacle spawn
    pointsPerCollectible: z.number().int().min(0).max(25),
  }),
  /** Optional tuning for move-based templates (shooter, dodge). */
  tuning: z
    .object({
      playerSpeed: z.number().min(200).max(900).optional(), // px/s horizontal (keyboard)
      fireRateMs: z.number().min(120).max(800).optional(), // shooter auto-fire interval
      enemyHp: z.number().int().min(1).max(5).optional(), // shooter hits per enemy
    })
    .optional(),
  /** Sound effects. Missing slots use built-in synthesized sounds. */
  sfx: z.object(Object.fromEntries(SFX_SLOTS.map((s) => [s, sound.optional()])) as Record<(typeof SFX_SLOTS)[number], z.ZodOptional<typeof sound>>).optional(),
  /** Particle effects. Missing slots use the template's default style. */
  vfx: z.object(Object.fromEntries(VFX_SLOTS.map((s) => [s, vfxPreset.optional()])) as Record<(typeof VFX_SLOTS)[number], z.ZodOptional<typeof vfxPreset>>).optional(),
});

export type GameConfig = z.infer<typeof gameConfigSchema>;

/** Every asset ref used anywhere in a config. */
export function collectAssetRefs(config: GameConfig): AssetRef[] {
  const out = new Set<AssetRef>();
  const visit = (v: unknown) => {
    if (isAssetRef(v)) out.add(v);
    else if (v && typeof v === "object") Object.values(v).forEach(visit);
  };
  visit(config.sprites);
  visit(config.sfx);
  visit(config.vfx);
  return [...out];
}

/**
 * postMessage protocol between the parent page and the sandboxed game iframe.
 * Every message carries `source: "pop"` so stray messages are ignored.
 * `assets` maps each "asset:0x…" ref used by the config to a data: URL, so the
 * opaque-origin iframe never has to fetch anything itself.
 */
export type ParentToGame =
  | { source: "pop"; type: "load"; config: GameConfig; assets?: Record<string, string> }
  | { source: "pop"; type: "start" } // begin a run (after a session is paid for)
  | { source: "pop"; type: "reset" } // back to title screen
  | { source: "pop"; type: "mute"; muted: boolean };

export type GameToParent =
  | { source: "pop"; type: "ready" } // iframe booted, waiting for "load"
  | { source: "pop"; type: "loaded" } // config applied, title screen showing
  | { source: "pop"; type: "score"; score: number }
  | { source: "pop"; type: "gameOver"; score: number; durationMs: number }
  | { source: "pop"; type: "error"; message: string };
