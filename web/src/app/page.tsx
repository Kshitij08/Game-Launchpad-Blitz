"use client";

import Link from "next/link";
import { Header } from "@/components/Header";
import { useGames, type GameSummary } from "@/lib/hooks/useGames";
import { mon } from "@/lib/format";

export default function Explore() {
  const { games, isLoading, error } = useGames();

  return (
    <div className="min-h-screen bg-[#0d0b17] text-white">
      <Header />
      <main className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-10">
        <section className="flex flex-col gap-4">
          <h1 className="max-w-3xl text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            Prompt a game. Launch its token. <span className="text-[#a58cff]">Play backs its value.</span>
          </h1>
          <p className="max-w-2xl text-white/70">
            Early tokens are mined only by playing. Every paid play fills a vault, and any holder can redeem
            from it at the floor price: <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-sm">floor = vault ÷ supply</code>.
          </p>
          <div>
            <Link
              href="/create"
              className="inline-flex rounded-lg bg-[#836ef9] px-5 py-2.5 font-semibold text-white hover:bg-[#9583ff]"
            >
              Create a game
            </Link>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-bold">Games</h2>
          {error && <p className="text-red-300">Couldn&apos;t load games from Monad testnet. Check your connection.</p>}
          {isLoading && <p className="text-white/60">Loading games…</p>}
          {!isLoading && !error && games.length === 0 && (
            <p className="text-white/60">No games yet. Be the first to launch one.</p>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {games.map((g) => (
              <GameCard key={g.id.toString()} g={g} />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function GameCard({ g }: { g: GameSummary }) {
  const title = g.config?.title ?? g.name ?? `Game #${g.id}`;
  const sky = g.config?.palette.sky ?? "#2a2350";
  const skyBottom = g.config?.palette.skyBottom ?? "#141024";
  const mining = g.stats ? !g.stats.miningClosed : true;
  return (
    <Link
      href={`/game/${g.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] transition hover:border-[#a58cff]/60"
    >
      <div className="relative h-32" style={{ background: `linear-gradient(${sky}, ${skyBottom})` }}>
        {g.config?.sprites.player && (
          <img
            alt=""
            className="absolute bottom-4 left-1/2 h-16 w-16 -translate-x-1/2 transition group-hover:scale-110"
            src={`data:image/svg+xml;utf8,${encodeURIComponent(g.config.sprites.player)}`}
          />
        )}
        <span
          className={`absolute right-3 top-3 rounded-full px-2 py-0.5 text-xs font-semibold ${
            mining ? "bg-amber-400/90 text-black" : "bg-emerald-400/90 text-black"
          }`}
        >
          {mining ? "Mining" : "Trading"}
        </span>
        {g.parentId > 0n && (
          <span className="absolute left-3 top-3 rounded-full bg-black/50 px-2 py-0.5 text-xs">Remix of #{g.parentId.toString()}</span>
        )}
      </div>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="truncate font-bold">{title}</h3>
          <span className="font-mono text-xs text-white/60">${g.symbol ?? "…"}</span>
        </div>
        {g.config?.tagline && <p className="line-clamp-2 text-sm text-white/60">{g.config.tagline}</p>}
        <dl className="grid grid-cols-3 gap-2 text-xs tabular-nums">
          <Stat label="Players" value={g.stats?.uniquePlayers.toString() ?? "…"} />
          <Stat label="Vault" value={`${mon(g.stats?.vaultBalance, 3)} MON`} />
          <Stat label="Floor" value={mon(g.stats?.floorPrice, 6)} />
        </dl>
      </div>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-white/50">{label}</dt>
      <dd className="font-mono text-white">{value}</dd>
    </div>
  );
}
