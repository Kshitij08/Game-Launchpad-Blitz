"use client";

import { useEffect, useRef, useState } from "react";
import { usePublicClient } from "wagmi";
import { parseEventLogs, type Log } from "viem";
import { sessionManagerAbi, bondingCurveAbi, treasuryVaultAbi } from "@/lib/contracts";
import { monadTestnet } from "@/lib/chain";
import { mon, tokens } from "@/lib/format";

const RANGE = 100n; // Monad RPC allows at most 100 blocks per eth_getLogs
const BACKFILL_CHUNKS = 20; // ~2,000 blocks (~13 min) of history on load
const abi = [...sessionManagerAbi, ...bondingCurveAbi, ...treasuryVaultAbi];

type Item = { key: string; block: bigint; who: string; text: string; tone: "good" | "bad" | "neutral" | "hype" };

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const pick = <T,>(xs: T[], seed: number) => xs[seed % xs.length];

/** Live trading-terminal style feed of everything happening in one game. */
export function DegenFeed({
  sessions,
  curve,
  vault,
  symbol,
  creator,
}: {
  sessions: `0x${string}`;
  curve: `0x${string}`;
  vault: `0x${string}`;
  symbol: string;
  creator: `0x${string}`;
}) {
  const client = usePublicClient({ chainId: monadTestnet.id });
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const last = useRef<bigint | null>(null);
  const symRef = useRef(symbol);
  symRef.current = symbol;

  useEffect(() => {
    if (!client) return;
    let stop = false;
    const address = [sessions, curve, vault];

    const toItems = (logs: Log[]): Item[] => {
      const parsed = parseEventLogs({ abi, logs });
      const out: Item[] = [];
      for (const ev of parsed) {
        const key = `${ev.transactionHash}-${ev.logIndex}`;
        const block = ev.blockNumber ?? 0n;
        const seed = Number(ev.logIndex ?? 0) + Number(block % 97n);
        const sym = `$${symRef.current}`;
        const a = ev.args as Record<string, unknown>;
        switch (ev.eventName) {
          case "SessionStarted":
            out.push({ key, block, who: a.player as string, tone: "neutral", text: `aped ${mon(a.fee as bigint)} MON into a run` });
            break;
          case "SessionEnded": {
            const score = Number(a.score);
            const mined = a.mined as bigint;
            const flavour = score >= 30 ? pick(["absolute chad", "built different", "cracked"], seed) : score <= 5 ? pick(["ngmi", "skill issue", "gn"], seed) : pick(["based", "solid", "wagmi"], seed);
            out.push({
              key, block, who: a.player as string, tone: score >= 30 ? "hype" : "good",
              text: `scored ${score}${mined > 0n ? ` · mined ${tokens(mined, 0)} ${sym}` : ""} · ${flavour}`,
            });
            break;
          }
          case "Bought":
            out.push({ key, block, who: a.buyer as string, tone: "hype", text: `bought ${tokens(a.amount as bigint, 0)} ${sym} for ${mon(a.cost as bigint)} MON · floor pumped` });
            break;
          case "Redeemed":
            out.push({ key, block, who: a.holder as string, tone: "bad", text: `redeemed ${tokens(a.tokens as bigint, 0)} ${sym} for ${mon(a.payout as bigint, 6)} MON · ${pick(["paper hands", "took profit", "exit liquidity? no, exit floor"], seed)}` });
            break;
          case "MiningClosed":
            out.push({ key, block, who: creator, tone: "hype", text: `mining closed at ${tokens(a.totalMined as bigint, 0)} ${sym} · trading is LIVE` });
            break;
          case "CreatorClaimed":
            out.push({ key, block, who: creator, tone: "neutral", text: `dev unlocked ${tokens(a.amount as bigint, 0)} ${sym} (earned by real players, not a rug)` });
            break;
        }
      }
      return out;
    };

    const add = (next: Item[]) => {
      if (!next.length) return;
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.key));
        return [...next.filter((i) => !seen.has(i.key)), ...prev].sort((x, y) => (y.block > x.block ? 1 : y.block < x.block ? -1 : 0)).slice(0, 60);
      });
    };

    (async () => {
      try {
        const head = await client.getBlockNumber();
        last.current = head;
        // Backfill newest chunks first so the feed fills from the top.
        for (let i = 0; i < BACKFILL_CHUNKS && !stop; i += 5) {
          const batch = await Promise.all(
            Array.from({ length: 5 }, (_, j) => {
              const to = head - BigInt(i + j) * RANGE;
              return client.getLogs({ address, fromBlock: to - RANGE + 1n, toBlock: to }).catch(() => [] as Log[]);
            }),
          );
          add(toItems(batch.flat()));
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
            add(toItems(await client.getLogs({ address, fromBlock: from, toBlock: to })));
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
  }, [client, sessions, curve, vault, creator]);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-black/40 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">Degen feed</h2>
        <span className="flex items-center gap-1.5 font-mono text-xs text-emerald-300">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" /> live
        </span>
      </div>
      <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto font-mono text-xs">
        {items.length === 0 && (
          <li className="text-white/50">{loading ? "Reading the chain…" : "Quiet in here. Be the first to ape in."}</li>
        )}
        {items.map((i) => (
          <li key={i.key} className="flex gap-2 leading-relaxed">
            <span className="shrink-0 text-[#a58cff]">{short(i.who)}</span>
            <span className={i.tone === "bad" ? "text-red-300" : i.tone === "hype" ? "text-emerald-300" : i.tone === "good" ? "text-white/85" : "text-white/60"}>
              {i.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
