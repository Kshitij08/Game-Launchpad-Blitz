"use client";

import { Header } from "@/components/Header";
import { GameStage } from "@/components/GameStage";
import {
  BlinkCursor,
  PixelBadge,
  PixelCard,
  PixelLink,
  PixelLoader,
  PixelSkeleton,
  Reveal,
} from "@/components/PixelUI";
import { useGames, type GameSummary } from "@/lib/hooks/useGames";
import { SAMPLE_CONFIGS } from "@/lib/sample-configs";
import { resolvePreviewConfig } from "@/lib/preview-config";
import { mon } from "@/lib/format";
import { label, shell } from "@/lib/ui";

const HERO = SAMPLE_CONFIGS[0].config;

export default function Explore() {
  const { games, isLoading, error } = useGames();

  return (
    <div className={shell}>
      <Header />
      <main className="mx-auto flex max-w-6xl flex-col gap-14 px-4 py-8 sm:py-10">
        {/* One composition: brand + line + CTA + arcade stage */}
        <section className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-10">
          <div className="flex flex-col gap-5">
            <Reveal>
              <p className="pixel-label text-[color:var(--monad-cyan)]">
                Monad testnet
                <BlinkCursor />
              </p>
            </Reveal>
            <Reveal delay={1}>
              <h1 className="pixel-brand text-white">
                Proof
                <span className="text-[color:var(--monad-purple)]">-of-</span>
                Play
              </h1>
            </Reveal>
            <Reveal delay={2}>
              <p className="pixel-title text-[11px] text-[color:var(--monad-lilac)] sm:text-xs">
                Prompt a game. Launch a coin.
              </p>
            </Reveal>
            <Reveal delay={3}>
              <p className="copy">
                Play mines the early supply. Fees fill a vault. Holders redeem the floor —{" "}
                <code className="pixel-code">vault ÷ supply</code>.
              </p>
            </Reveal>
            <Reveal delay={4} className="flex flex-wrap gap-3">
              <PixelLink href="/create">Launch a game coin</PixelLink>
              <a href="#games" className="pixel-btn-ghost">
                Browse games
              </a>
            </Reveal>
          </div>

          <Reveal delay={2} className="arcade-bezel">
            <div className="arcade-bezel-bar">
              <span className="pixel-label text-[color:var(--muted)]">{HERO.title}</span>
              <span className="pixel-label text-[color:var(--monad-orange)]">demo cart</span>
            </div>
            <GameStage config={HERO} tall className="min-h-52 sm:min-h-64" />
            <div className="arcade-bezel-bar">
              <span className="pixel-label text-[color:var(--muted)]">insert mon to play</span>
              <span className="pixel-pulse pixel-label text-[color:var(--good)]">● online</span>
            </div>
          </Reveal>
        </section>

        <section id="games" className="flex flex-col gap-4">
          <div className="flex items-end justify-between gap-3">
            <h2 className="pixel-title text-xs sm:text-sm">Games</h2>
            <span className={label}>{isLoading ? "…" : `${games.length} live`}</span>
          </div>

          {error && (
            <p className="text-[color:var(--danger)]">
              Couldn&apos;t load games from Monad testnet. Check your connection.
            </p>
          )}

          {isLoading && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <PixelSkeleton key={i} className="h-64" />
                ))}
              </div>
              <PixelLoader label="Scanning Monad" />
            </div>
          )}

          {!isLoading && !error && games.length === 0 && (
            <p className="copy">No games yet. Be the first to launch one.</p>
          )}

          {!isLoading && !error && games.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {games.map((g, i) => (
                <GameCard key={g.id.toString()} g={g} index={i} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function GameCard({ g, index }: { g: GameSummary; index: number }) {
  const cardTitle = g.config?.title ?? g.name ?? `Game #${g.id}`;
  const mining = g.stats ? !g.stats.miningClosed : true;
  const delay = Math.min(index, 5) as 0 | 1 | 2 | 3 | 4 | 5;
  const stageConfig = resolvePreviewConfig(g.config, g.name, g.symbol);

  return (
    <PixelCard href={`/game/${g.id}`} delay={delay}>
      <div className="relative">
        <GameStage config={stageConfig} interactive />
        <PixelBadge tone={mining ? "mining" : "trading"} className="absolute right-3 top-3 z-10">
          {mining ? "Mining" : "Trading"}
        </PixelBadge>
        {g.parentId > 0n && (
          <PixelBadge className="absolute left-3 top-3 z-10">Remix #{g.parentId.toString()}</PixelBadge>
        )}
      </div>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="pixel-title truncate text-[10px]">{cardTitle}</h3>
          <span className="pixel-label text-[color:var(--monad-cyan)]">${g.symbol ?? "…"}</span>
        </div>
        {g.config?.tagline && <p className="line-clamp-2 text-[1.15rem] text-[color:var(--muted)]">{g.config.tagline}</p>}
        <dl className="grid grid-cols-3 gap-2">
          <MiniStat label="Players" value={g.stats?.uniquePlayers.toString() ?? "…"} />
          <MiniStat label="Vault" value={`${mon(g.stats?.vaultBalance, 3)}`} />
          <MiniStat label="Floor" value={mon(g.stats?.floorPrice, 6)} />
        </dl>
      </div>
    </PixelCard>
  );
}

function MiniStat({ label: l, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className={label}>{l}</dt>
      <dd className="pixel-num text-[1.15rem] text-white">{value}</dd>
    </div>
  );
}
