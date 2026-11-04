import type { GameConfig } from "@/lib/game-config";
import { SAMPLE_CONFIGS } from "@/lib/sample-configs";

const FALLBACK: Pick<GameConfig, "palette" | "sprites"> = {
  palette: {
    sky: "#2a2350",
    skyBottom: "#141024",
    ground: "#0d0b17",
    accent: "#6e54ff",
    text: "#ffffff",
  },
  sprites: {
    player: "",
    obstacle: "",
    collectible: "",
    decor: "",
    projectile: "",
  },
};

function tickerFrom(title: string) {
  const words = title
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  const initials = words.map((w) => w[0]).join("");
  const raw = words.length > 1 && initials.length >= 3 ? initials : (words[0] ?? "GAME");
  return raw.slice(0, 5);
}

/**
 * Prefer the on-chain config's sprites. If Redis isn't seeded locally (or the
 * hash 404s), fall back to the matching hand-written sample so cards still show art.
 */
export function resolvePreviewConfig(
  config: GameConfig | null | undefined,
  name?: string,
  symbol?: string,
): Pick<GameConfig, "palette" | "sprites"> {
  if (config?.sprites?.player) {
    return { palette: config.palette, sprites: config.sprites };
  }

  const sym = (symbol ?? "").toUpperCase();
  const title = (config?.title ?? name ?? "").toLowerCase();

  const sample =
    SAMPLE_CONFIGS.find((s) => {
      if (title && s.config.title.toLowerCase() === title) return true;
      if (title && s.name.toLowerCase() === title) return true;
      if (sym && tickerFrom(s.config.title) === sym) return true;
      return false;
    })?.config ?? SAMPLE_CONFIGS.find((s) => title && s.config.title.toLowerCase().includes(title))?.config;

  if (sample) return { palette: sample.palette, sprites: sample.sprites };
  return FALLBACK;
}
