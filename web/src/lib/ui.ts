/** Shared class tokens for Monad pixel chrome. Prefer PixelUI components in JSX. */

export const btn = "pixel-btn";
export const btnGhost = "pixel-btn-ghost";
export const input = "pixel-input";
export const panel = "pixel-panel p-4";
export const panelStrong = "pixel-panel-strong p-4";
export const chip = "pixel-chip";
export const chipActive = "pixel-chip pixel-chip-active";
export const title = "pixel-title";
export const label = "pixel-label text-[color:var(--muted)]";
export const shell = "min-h-screen text-white";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function reveal(delay: 0 | 1 | 2 | 3 | 4 | 5 = 0) {
  return delay === 0 ? "pixel-reveal" : `pixel-reveal pixel-reveal-delay-${delay}`;
}
