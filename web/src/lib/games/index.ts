import type { GameToParent } from "@/lib/game-config";

/**
 * The game runtime lives in /public/games (static, no bundler):
 *  - engine.html  page loaded in <iframe sandbox="allow-scripts">
 *  - core.js      boot, protocol, assets, sfx, vfx, HUD (see TEMPLATE_API.md)
 *  - templates/*.js one file per template (flappy, runner, shooter, dodge)
 *  - phaser.min.js vendored copy of node_modules/phaser/dist/phaser.min.js (3.88.2)
 *
 * It is static rather than a Next route because the root layout mounts
 * wagmi/RainbowKit, which touch localStorage and throw in an opaque-origin
 * sandbox. Debug standalone: /games/engine.html#<encodeURIComponent(JSON config)>
 */
export const GAME_ENGINE_URL = "/games/engine.html";

export function isGameMessage(data: unknown): data is GameToParent {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { source?: unknown }).source === "pop" &&
    typeof (data as { type?: unknown }).type === "string"
  );
}
