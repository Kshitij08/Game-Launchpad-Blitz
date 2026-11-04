"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { parseEventLogs, type Log } from "viem";
import { sessionManagerAbi } from "@/lib/contracts";
import { monadTestnet } from "@/lib/chain";

const RANGE = 100n; // Monad RPC allows at most 100 blocks per eth_getLogs
const BACKFILL_CHUNKS = 20; // ~2,000 blocks of history on load

type Run = { key: string; player: string; score: number };
type Row = { player: string; best: number; runs: number };

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const rankTone = ["text-[color:var(--good)]", "text-[color:var(--monad-lilac)]", "text-white/85"];

/** Live top-10 of best scores per player, built from SessionEnded events. */
export function Leaderboard({ sessions, symbol }: { sessions: `0x${string}`; symbol: string }) {
  const client = usePublicClient({ chainId: monadTestnet.id });
  const { address: me } = useAccount();
  const [runs, setRuns] = useState<Map<string, Run>>(new Map());
  const [loading, setLoading] = useState(true);
  const last = useRef<bigint | null>(null);

  useEffect(() => {
    if (!client) return;
    let stop = false;
    setRuns(new Map());

    const toRuns = (logs: Log[]): Run[] =>
      parseEventLogs({ abi: sessionManagerAbi, logs, eventName: "SessionEnded" }).map((ev) => ({
        key: `${ev.transactionHash}-${ev.logIndex}`,
        player: (ev.args.player as string).toLowerCase(),
        score: Number(ev.args.score),
      }));

    const add = (next: Run[]) => {
      if (!next.length) return;
      setRuns((prev) => {
        const m = new Map(prev);
        for (const r of next) m.set(r.key, r);
        return m;
      });
    };

    (async () => {
      try {
        const head = await client.getBlockNumber();
        last.current = head;
        for (let i = 0; i < BACKFILL_CHUNKS && !stop; i += 5) {
          const batch = await Promise.all(
            Array.from({ length: 5 }, (_, j) => {
              const to = head - BigInt(i + j) * RANGE;
              return client.getLogs({ address: sessions, fromBlock: to - RANGE + 1n, toBlock: to }).catch(() => [] as Log[]);
            }),
          );
          add(toRuns(batch.flat()));
        }
      } finally {
        if (!stop) setLoading(false);
      }
      // Live tail.
      while (!stop) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
          const head = await client.getBlockNumber();
          let from = (last.current ?? head) + 1n;
          while (from <= head && !stop) {
            const to = from + RANGE - 1n < head ? from + RANGE - 1n : head;
            add(toRuns(await client.getLogs({ address: sessions, fromBlock: from, toBlock: to })));
            from = to + 1n;
          }
          last.current = head;
        } catch {
          // RPC hiccup: try again next tick.
        }
      }
    })();
    return () => {
      stop = true;
    };
  }, [client, sessions]);

  const rows = useMemo<Row[]>(() => {
    const by = new Map<string, Row>();
    for (const r of runs.values()) {
      const cur = by.get(r.player);
      if (cur) {
        cur.runs += 1;
        if (r.score > cur.best) cur.best = r.score;
      } else by.set(r.player, { player: r.player, best: r.score, runs: 1 });
    }
    return [...by.values()].sort((a, b) => b.best - a.best || a.runs - b.runs).slice(0, 10);
  }, [runs]);

  const mine = me?.toLowerCase();

  return (
    <div className="pixel-panel flex flex-col gap-2 bg-black/45 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="pixel-title text-[11px]">Leaderboard</h2>
        <span className="pixel-label flex items-center gap-1.5 text-[color:var(--good)]">
          <span className="pixel-pulse inline-block h-2 w-2 bg-[color:var(--good)]" /> live
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="text-lg text-[color:var(--muted)]">
          {loading ? <span className="pixel-loader">Reading the chain</span> : "No runs yet. Set the first score."}
        </p>
      ) : (
        <ol className="flex flex-col gap-1 text-lg" aria-label={`${symbol} leaderboard`}>
          <li className="pixel-label grid grid-cols-[3rem_1fr_4rem_3rem] gap-2 text-[color:var(--muted)]">
            <span>rank</span>
            <span>player</span>
            <span className="text-right">best</span>
            <span className="text-right">runs</span>
          </li>
          {rows.map((r, idx) => {
            const you = mine === r.player;
            return (
              <li
                key={r.player}
                className={`pixel-reveal grid grid-cols-[3rem_1fr_4rem_3rem] items-center gap-2 px-1 leading-relaxed ${
                  you ? "bg-[color:var(--monad-lilac)]/20 outline outline-1 outline-[color:var(--monad-lilac)]" : ""
                }`}
                style={{ animationDelay: `${Math.min(idx, 8) * 40}ms` }}
              >
                <span className={idx < 3 ? rankTone[idx] : "text-[color:var(--muted)]"}>#{idx + 1}</span>
                <span className="flex items-center gap-2 truncate text-[color:var(--monad-lilac)]">
                  {short(r.player)}
                  {you && <span className="pixel-label text-[color:var(--good)]">you</span>}
                </span>
                <span className={`text-right ${idx < 3 ? rankTone[idx] : "text-white/85"}`}>{r.best}</span>
                <span className="text-right text-[color:var(--muted)]">{r.runs}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
