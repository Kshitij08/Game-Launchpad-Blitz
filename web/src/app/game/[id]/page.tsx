"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useReadContract, useReadContracts, useBalance } from "wagmi";
import { parseEther, parseEventLogs, getAddress } from "viem";
import { Header } from "@/components/Header";
import { GamePlayer, type GamePlayerHandle } from "@/components/GamePlayer";
import {
  GAME_FACTORY,
  gameFactoryAbi,
  gameTokenAbi,
  sessionManagerAbi,
  treasuryVaultAbi,
  bondingCurveAbi,
} from "@/lib/contracts";
import { fetchConfig } from "@/lib/hooks/useGames";
import { useTx, errorText } from "@/lib/hooks/useTx";
import { mon, tokens } from "@/lib/format";
import { monadTestnet } from "@/lib/chain";
import { DegenFeed } from "@/components/DegenFeed";

type Phase = "idle" | "paying" | "playing" | "signing" | "claiming" | "done";

export default function GamePage() {
  const params = useParams<{ id: string }>();
  const id = BigInt(params.id);
  const { address } = useAccount();
  const send = useTx();
  const player = useRef<GamePlayerHandle>(null);

  const game = useReadContract({ address: GAME_FACTORY, abi: gameFactoryAbi, functionName: "getGame", args: [id] });
  const g = game.data;
  const config = useQuery({
    queryKey: ["config", g?.configHash],
    queryFn: () => fetchConfig(g!.configHash),
    enabled: !!g,
    staleTime: Infinity,
  });

  const me = address ?? "0x0000000000000000000000000000000000000000";
  const reads = useReadContracts({
    allowFailure: true,
    contracts: g
      ? [
          { address: g.token, abi: gameTokenAbi, functionName: "name" },
          { address: g.token, abi: gameTokenAbi, functionName: "symbol" },
          { address: g.token, abi: gameTokenAbi, functionName: "totalSupply" },
          { address: g.token, abi: gameTokenAbi, functionName: "balanceOf", args: [me] },
          { address: g.vault, abi: treasuryVaultAbi, functionName: "floorPrice" },
          { address: g.sessions, abi: sessionManagerAbi, functionName: "params" },
          { address: g.sessions, abi: sessionManagerAbi, functionName: "finishedSessions" },
          { address: g.sessions, abi: sessionManagerAbi, functionName: "uniquePlayers" },
          { address: g.sessions, abi: sessionManagerAbi, functionName: "totalMined" },
          { address: g.sessions, abi: sessionManagerAbi, functionName: "miningClosed" },
          { address: g.sessions, abi: sessionManagerAbi, functionName: "bestScore" },
          { address: g.sessions, abi: sessionManagerAbi, functionName: "bestPlayer" },
          { address: g.sessions, abi: sessionManagerAbi, functionName: "minedBy", args: [me] },
          { address: g.sessions, abi: sessionManagerAbi, functionName: "creatorUnlocked" },
          { address: g.sessions, abi: sessionManagerAbi, functionName: "creatorClaimed" },
          { address: g.sessions, abi: sessionManagerAbi, functionName: "getMilestones" },
          { address: g.curve, abi: bondingCurveAbi, functionName: "spotPrice" },
        ]
      : [],
    query: { enabled: !!g, refetchInterval: 5_000 },
  });
  const vaultBal = useBalance({ address: g?.vault, chainId: monadTestnet.id, query: { enabled: !!g, refetchInterval: 5_000 } });

  const r = (i: number) => reads.data?.[i]?.result;
  const name = r(0) as string | undefined;
  const symbol = (r(1) as string | undefined) ?? "…";
  const supply = r(2) as bigint | undefined;
  const myBalance = r(3) as bigint | undefined;
  const floor = r(4) as bigint | undefined;
  const p = r(5) as readonly bigint[] | undefined;
  const entryFee = p?.[0];
  const walletCap = p?.[5];
  const supplyCap = p?.[6];
  const creatorAlloc = p?.[7];
  const finished = r(6) as bigint | undefined;
  const players = r(7) as bigint | undefined;
  const totalMined = r(8) as bigint | undefined;
  const miningClosed = r(9) as boolean | undefined;
  const bestScore = r(10) as bigint | undefined;
  const bestPlayer = r(11) as string | undefined;
  const myMined = r(12) as bigint | undefined;
  const unlocked = r(13) as bigint | undefined;
  const claimed = r(14) as bigint | undefined;
  const milestones = r(15) as readonly bigint[] | undefined;
  const spot = r(16) as bigint | undefined;

  const isCreator = !!address && !!g && getAddress(address) === getAddress(g.creator);

  // Personal best on this game, kept in this browser (the game iframe has no storage).
  const bestKey = `pop:best:${params.id}`;
  const [best, setBest] = useState<number | undefined>(undefined);
  useEffect(() => {
    try {
      const v = Number(localStorage.getItem(bestKey));
      if (Number.isFinite(v) && v > 0) setBest(v);
    } catch {}
  }, [bestKey]);
  function saveBest(s: number) {
    if (best !== undefined && s <= best) return;
    setBest(s);
    try {
      localStorage.setItem(bestKey, String(s));
    } catch {}
  }

  // ------------------------------------------------------------ play loop
  const [phase, setPhase] = useState<Phase>("idle");
  const [score, setScore] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [lastMined, setLastMined] = useState<bigint | null>(null);
  const sessionId = useRef<bigint | null>(null);

  async function play() {
    if (!g || entryFee === undefined) return;
    setMsg(null);
    setLastMined(null);
    setScore(0);
    try {
      setPhase("paying");
      const receipt = await send({
        address: g.sessions,
        abi: sessionManagerAbi,
        functionName: "startSession",
        value: entryFee,
      });
      const [ev] = parseEventLogs({ abi: sessionManagerAbi, logs: receipt.logs, eventName: "SessionStarted" });
      sessionId.current = ev.args.sessionId;
      setPhase("playing");
      player.current?.start();
      reads.refetch();
    } catch (e) {
      setMsg(errorText(e));
      setPhase("idle");
    }
  }

  async function onGameOver(finalScore: number) {
    if (!g || !address || sessionId.current === null) return;
    setScore(finalScore);
    try {
      setPhase("signing");
      const res = await fetch("/api/sign-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessions: g.sessions,
          player: address,
          sessionId: sessionId.current.toString(),
          score: finalScore,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't sign the score");
      setPhase("claiming");
      const receipt = await send({
        address: g.sessions,
        abi: sessionManagerAbi,
        functionName: "endSession",
        args: [sessionId.current, BigInt(finalScore), data.signature],
      });
      const [ev] = parseEventLogs({ abi: sessionManagerAbi, logs: receipt.logs, eventName: "SessionEnded" });
      setLastMined(ev?.args.mined ?? 0n);
      sessionId.current = null;
      setPhase("done");
      reads.refetch();
      vaultBal.refetch();
    } catch (e) {
      setMsg(`${errorText(e)} Your score is kept; press "Claim score" to retry.`);
      setPhase("signing");
    }
  }

  // ------------------------------------------------------------ market
  const [buyAmt, setBuyAmt] = useState("100");
  const [redeemAmt, setRedeemAmt] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [marketMsg, setMarketMsg] = useState<string | null>(null);

  const buyUnits = safeParse(buyAmt);
  const quote = useReadContract({
    address: g?.curve,
    abi: bondingCurveAbi,
    functionName: "quoteBuy",
    args: [buyUnits ?? 0n],
    query: { enabled: !!g && !!buyUnits && !!miningClosed, refetchInterval: 5_000 },
  });
  const redeemUnits = safeParse(redeemAmt);
  const preview = useReadContract({
    address: g?.vault,
    abi: treasuryVaultAbi,
    functionName: "previewRedeem",
    args: [redeemUnits ?? 0n],
    query: { enabled: !!g && !!redeemUnits, refetchInterval: 5_000 },
  });

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setMarketMsg(null);
    try {
      await fn();
      setMarketMsg(`${label}: done.`);
      reads.refetch();
      vaultBal.refetch();
    } catch (e) {
      setMarketMsg(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  if (game.isError) {
    return (
      <Shell>
        <p className="text-white/70">Game #{params.id} doesn&apos;t exist. <Link className="underline" href="/">Back to games</Link></p>
      </Shell>
    );
  }

  const cfg = config.data;
  const title = cfg?.title ?? name ?? `Game #${params.id}`;
  const miningPct =
    totalMined !== undefined && supplyCap ? Math.min(100, Number((totalMined * 10000n) / supplyCap) / 100) : 0;

  return (
    <Shell>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,480px)_minmax(0,1fr)]">
        {/* --------------------------------------------------- game column */}
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline gap-3">
              <h1 className="text-3xl font-extrabold tracking-tight">{title}</h1>
              <span className="font-mono text-sm text-white/60">${symbol}</span>
            </div>
            {cfg?.tagline && <p className="text-white/70">{cfg.tagline}</p>}
            {g && g.parentId > 0n && (
              <Link href={`/game/${g.parentId}`} className="text-sm text-[#a58cff] hover:underline">
                Remix of game #{g.parentId.toString()}
              </Link>
            )}
          </div>

          <div className="overflow-hidden rounded-xl border border-white/10 bg-black">
            {cfg ? (
              <GamePlayer
                ref={player}
                config={cfg}
                best={best}
                ticker={symbol !== "…" ? symbol : undefined}
                onScore={setScore}
                onGameOver={(s) => {
                  saveBest(s);
                  onGameOver(s);
                }}
              />
            ) : (
              <div className="grid aspect-[2/3] place-items-center text-white/50">
                {config.isLoading || game.isLoading ? "Loading game…" : "Game config not found."}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="font-mono text-sm tabular-nums">
                Score <span className="text-lg font-bold text-white">{score}</span>
                {cfg?.scoreLabel && <span className="text-white/50"> {cfg.scoreLabel}</span>}
              </div>
              {phase === "signing" && sessionId.current !== null && !msg ? (
                <span className="text-sm text-white/70">Signing score…</span>
              ) : phase === "signing" && sessionId.current !== null ? (
                <button className={btn} onClick={() => onGameOver(score)}>Claim score</button>
              ) : (
                <button
                  className={btn}
                  disabled={!address || !cfg || phase === "paying" || phase === "playing" || phase === "claiming"}
                  onClick={play}
                >
                  {!address
                    ? "Connect wallet to play"
                    : phase === "paying"
                      ? "Confirm in wallet…"
                      : phase === "playing"
                        ? "Playing…"
                        : phase === "claiming"
                          ? "Claiming…"
                          : `Play · ${mon(entryFee)} MON`}
                </button>
              )}
            </div>
            <p className="text-xs text-white/50">
              70% of every entry fee goes to the vault, so the floor only goes up.
              {!miningClosed && " While mining is open, finishing a run mines tokens: 10 + 1 per point."}
            </p>
            {phase === "done" && lastMined !== null && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-emerald-300">
                  {lastMined > 0n ? `You mined ${tokens(lastMined)} $${symbol}. LFG.` : "Run recorded on-chain. Mining is closed, so no tokens this time."} Every run pumps the floor.
                </p>
                <a
                  className={btnGhost}
                  target="_blank"
                  rel="noreferrer"
                  href={`https://x.com/intent/post?text=${encodeURIComponent(
                    `${score >= 30 ? "built different:" : score <= 5 ? "got rekt:" : "gm. just scored"} ${score} ${cfg?.scoreLabel ?? "points"} in ${title} ($${symbol}) on @monad_xyz testnet.\n\nevery run pumps an unruggable floor. ape in:`,
                  )}&url=${encodeURIComponent(typeof window !== "undefined" ? window.location.href : "")}`}
                >
                  Share on X
                </a>
              </div>
            )}
            {msg && <p className="text-sm text-red-300">{msg}</p>}
          </div>
        </section>

        {/* -------------------------------------------------- stats column */}
        <section className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Big label="Unruggable floor" value={`${mon(floor, 6)} MON`} hint="vault ÷ supply" accent />
            <Big label="Vault" value={`${mon(vaultBal.data?.value, 4)} MON`} />
            <Big label="Supply" value={`${tokens(supply, 0)} ${symbol}`} />
            <Big label="Players" value={players?.toString() ?? "…"} />
            <Big label="Runs" value={finished?.toString() ?? "…"} />
            <Big label="Best score" value={bestScore?.toString() ?? "…"} hint={bestPlayer && bestScore ? short(bestPlayer) : undefined} />
          </div>

          {g && (
            <DegenFeed sessions={g.sessions} curve={g.curve} vault={g.vault} symbol={symbol} creator={g.creator} />
          )}

          {/* Mining / trading */}
          <Panel title={miningClosed ? "Trading is open" : "Play-mining is open"}>
            {!miningClosed ? (
              <>
                <p className="text-sm text-white/70">
                  Tokens can only be earned by playing until {tokens(supplyCap, 0)} {symbol} are mined. Then the curve opens for buyers.
                </p>
                <Bar pct={miningPct} />
                <p className="font-mono text-xs text-white/60 tabular-nums">
                  {tokens(totalMined, 0)} / {tokens(supplyCap, 0)} mined · you: {tokens(myMined, 0)} / {tokens(walletCap, 0)}
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-white/70">
                  Buy price is {mon(spot, 6)} MON per {symbol} and never drops below the floor. Every MON spent goes into the vault.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <input id="buy-amount" className={input} value={buyAmt} onChange={(e) => setBuyAmt(e.target.value)} inputMode="decimal" />
                  <span className="text-sm text-white/60">{symbol}</span>
                  <button
                    className={btn}
                    disabled={!address || !buyUnits || !quote.data || !!busy}
                    onClick={() =>
                      act("Buy", () =>
                        send({ address: g!.curve, abi: bondingCurveAbi, functionName: "buy", args: [buyUnits!], value: (quote.data! * 101n) / 100n }),
                      )
                    }
                  >
                    {busy === "Buy" ? "Buying…" : `Buy for ~${mon(quote.data, 4)} MON`}
                  </button>
                </div>
              </>
            )}
          </Panel>

          {/* Redeem */}
          <Panel title="Redeem from the vault">
            <p className="text-sm text-white/70">
              Burn {symbol} and get your share of the vault, at the floor price. You hold {tokens(myBalance)} {symbol}.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input id="redeem-amount" className={input} placeholder="Amount" value={redeemAmt} onChange={(e) => setRedeemAmt(e.target.value)} inputMode="decimal" />
              <button className={btnGhost} disabled={!myBalance} onClick={() => setRedeemAmt(trimNum(myBalance))}>Max</button>
              <button
                className={btn}
                disabled={!address || !redeemUnits || !!busy || (myBalance !== undefined && redeemUnits! > myBalance)}
                onClick={() => act("Redeem", () => send({ address: g!.vault, abi: treasuryVaultAbi, functionName: "redeem", args: [redeemUnits!] }))}
              >
                {busy === "Redeem" ? "Redeeming…" : `Redeem for ${mon(preview.data, 6)} MON`}
              </button>
            </div>
          </Panel>

          {/* Creator */}
          <Panel title="Creator unlocks">
            <p className="text-sm text-white/70">
              The creator&apos;s {tokens(creatorAlloc, 0)} {symbol} unlock 25% at a time as real players arrive.
            </p>
            <div className="flex flex-wrap gap-2">
              {milestones?.map((m, i) => {
                const hit = players !== undefined && players >= m;
                return (
                  <span key={i} className={`rounded-full px-3 py-1 font-mono text-xs ${hit ? "bg-emerald-400/90 text-black" : "bg-white/10 text-white/60"}`}>
                    {m.toString()} players
                  </span>
                );
              })}
            </div>
            <p className="font-mono text-xs text-white/60 tabular-nums">
              Unlocked {tokens(unlocked, 0)} · claimed {tokens(claimed, 0)}
            </p>
            {isCreator && (
              <div className="flex flex-wrap gap-2">
                <button
                  className={btn}
                  disabled={!!busy || unlocked === undefined || claimed === undefined || unlocked <= claimed}
                  onClick={() => act("Claim", () => send({ address: g!.sessions, abi: sessionManagerAbi, functionName: "claimCreator" }))}
                >
                  {busy === "Claim" ? "Claiming…" : "Claim unlocked tokens"}
                </button>
                {!miningClosed && (
                  <button
                    className={btnGhost}
                    disabled={!!busy}
                    onClick={() => act("Close mining", () => send({ address: g!.sessions, abi: sessionManagerAbi, functionName: "closeMining" }))}
                  >
                    {busy === "Close mining" ? "Closing…" : "End mining and open trading"}
                  </button>
                )}
              </div>
            )}
          </Panel>

          {cfg && (
            <Link href={`/create?remix=${params.id}`} className="text-sm text-[#a58cff] hover:underline">
              Remix this game with a new prompt →
            </Link>
          )}
          {marketMsg && <p className="text-sm text-white/80">{marketMsg}</p>}
        </section>
      </div>
    </Shell>
  );
}

// ------------------------------------------------------------------ bits

const btn =
  "rounded-lg bg-[#836ef9] px-4 py-2 text-sm font-semibold text-white hover:bg-[#9583ff] disabled:cursor-not-allowed disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-white/20 px-3 py-2 text-sm text-white/80 hover:border-white/40 disabled:cursor-not-allowed disabled:opacity-50";
const input =
  "w-32 rounded-lg border border-white/15 bg-black/40 px-3 py-2 font-mono text-sm text-white outline-none focus:border-[#a58cff]";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0d0b17] text-white">
      <Header />
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <h2 className="font-bold">{title}</h2>
      {children}
    </div>
  );
}

function Big({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 rounded-xl border p-3 ${accent ? "border-[#a58cff]/60 bg-[#836ef9]/10" : "border-white/10 bg-white/[0.03]"}`}>
      <span className="text-xs text-white/60">{label}</span>
      <span className="font-mono text-lg font-bold tabular-nums">{value}</span>
      {hint && <span className="font-mono text-[11px] text-white/40">{hint}</span>}
    </div>
  );
}

function Bar({ pct }: { pct: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-white/10">
      <div className="h-full bg-amber-400 transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

function safeParse(v: string): bigint | null {
  try {
    if (!v || Number(v) <= 0) return null;
    return parseEther(v as `${number}`);
  } catch {
    return null;
  }
}

function trimNum(units: bigint | undefined) {
  if (!units) return "";
  const s = (Number(units) / 1e18).toString();
  // Avoid rounding above the real balance.
  return Number(s) * 1e18 > Number(units) ? (Math.floor(Number(units) / 1e14) / 1e4).toString() : s;
}

function short(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
