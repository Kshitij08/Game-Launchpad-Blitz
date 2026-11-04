"use client";

import { spriteSrc } from "@/components/AssetCustomizer";
import { cx } from "@/lib/ui";
import type { GameConfig } from "@/lib/game-config";

/** Mini arcade viewport — product visual for hero + game cards. */
export function GameStage({
  config,
  className,
  tall,
  interactive,
}: {
  config: Pick<GameConfig, "palette" | "sprites">;
  className?: string;
  tall?: boolean;
  /** Bob the player only while the parent card is hovered. */
  interactive?: boolean;
}) {
  const { palette: p, sprites: s } = config;
  const player = s.player ? spriteSrc(s.player) : "";
  const obstacle = s.obstacle ? spriteSrc(s.obstacle) : "";
  const collectible = s.collectible ? spriteSrc(s.collectible) : "";
  const decor = s.decor ? spriteSrc(s.decor) : "";
  const hasArt = Boolean(player || obstacle || collectible || decor);

  return (
    <div
      className={cx("game-stage relative overflow-hidden", tall ? "min-h-44" : "h-36", className)}
      style={{
        background: `linear-gradient(180deg, ${p.sky} 0%, ${p.skyBottom} 70%, ${p.ground} 70%, ${p.ground} 100%)`,
      }}
    >
      {/* ground first so sprites paint above it */}
      <div className="absolute inset-x-0 bottom-0 z-0 h-[30%] border-t-2 border-black/20" style={{ background: p.ground }} />
      <div className="absolute inset-x-0 bottom-[28%] z-0 h-1 opacity-50" style={{ background: p.accent }} />

      {decor && (
        <img alt="" src={decor} className="pixel-art absolute left-[6%] top-[14%] z-10 h-11 w-20 opacity-90 sm:h-14 sm:w-28" />
      )}
      {obstacle && (
        <img
          alt=""
          src={obstacle}
          className="pixel-art absolute right-[12%] bottom-[32%] z-10 h-[4.5rem] w-10 object-contain object-bottom opacity-95 sm:h-24 sm:w-12"
        />
      )}
      {collectible && (
        <img alt="" src={collectible} className="pixel-art absolute left-[44%] top-[22%] z-10 h-8 w-8" />
      )}
      {player && (
        <img
          alt=""
          src={player}
          className={cx(
            "pixel-art absolute bottom-[32%] left-1/2 z-20 h-16 w-16 object-contain sm:h-[4.5rem] sm:w-[4.5rem]",
            interactive ? "game-stage-player" : "pixel-bob",
          )}
        />
      )}

      {!hasArt && (
        <div className="absolute inset-0 z-10 grid place-items-center">
          <span className="pixel-label text-[color:var(--muted)]">no sprite</span>
        </div>
      )}

      <div
        className="pointer-events-none absolute inset-0 z-30 opacity-[0.1]"
        style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.4) 3px)" }}
      />
    </div>
  );
}
