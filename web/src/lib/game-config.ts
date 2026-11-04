import { z } from "zod";

/**
 * The single contract between the AI generator, the game templates and the
 * launch flow. Claude writes one of these from a prompt; a template renders it.
 */

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "6-digit hex colour like #12ab34");
// Inline SVG markup. Templates rasterise it into a texture.
const svg = z
  .string()
  .max(12_000)
  .refine((s) => s.trim().startsWith("<svg") && s.includes("</svg>"), "must be a complete <svg>…</svg>");

export const TEMPLATES = ["flappy", "runner"] as const;
export type TemplateId = (typeof TEMPLATES)[number];

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
    player: svg, // drawn ~48x48, facing right
    obstacle: svg, // flappy: one pipe/column segment, tall; runner: ground obstacle ~48x64
    collectible: svg.optional(), // ~32x32
    decor: svg.optional(), // background parallax element, ~128x64 (clouds, hills, stars)
  }),
  physics: z.object({
    gravity: z.number().min(300).max(2500), // px/s^2
    jumpVelocity: z.number().min(250).max(1000), // px/s upward on tap
    scrollSpeed: z.number().min(120).max(600), // px/s at start
    speedRampPerSec: z.number().min(0).max(15), // px/s added each second
  }),
  obstacles: z.object({
    spawnIntervalMs: z.number().min(700).max(2600),
    gapSize: z.number().min(110).max(280), // flappy: vertical gap; runner: ignored
    variance: z.number().min(0).max(1), // 0 = regular, 1 = chaotic placement
  }),
  scoring: z.object({
    pointsPerObstacle: z.number().int().min(1).max(10),
    collectibleChance: z.number().min(0).max(1), // chance per obstacle spawn
    pointsPerCollectible: z.number().int().min(0).max(25),
  }),
});

export type GameConfig = z.infer<typeof gameConfigSchema>;

/**
 * postMessage protocol between the parent page and the sandboxed game iframe.
 * Every message carries `source: "pop"` so stray messages are ignored.
 */
export type ParentToGame =
  | { source: "pop"; type: "load"; config: GameConfig }
  | { source: "pop"; type: "start" } // begin a run (after a session is paid for)
  | { source: "pop"; type: "reset" }; // back to title screen

export type GameToParent =
  | { source: "pop"; type: "ready" } // iframe booted, waiting for "load"
  | { source: "pop"; type: "loaded" } // config applied, title screen showing
  | { source: "pop"; type: "score"; score: number }
  | { source: "pop"; type: "gameOver"; score: number; durationMs: number }
  | { source: "pop"; type: "error"; message: string };
