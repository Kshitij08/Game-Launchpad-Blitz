"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { Leaderboard } from "@/components/Leaderboard";
import {
  PixelBadge,
  PixelButton,
  PixelInput,
  PixelLoader,
  PixelPanel,
  PopValue,
  ProgressBar,
  Reveal,
  StatBlock,
} from "@/components/PixelUI";
import { shell, title } from "@/lib/ui";

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
          { address: g.sessions, abi: sessionManagerAbi, functionName: "creatorEarned" },
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
  const targetScore = p?.[4];
  const walletCap = p?.[6];
  const supplyCap = p?.[7];
  const runCap = p?.[8];
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
  const launchPrice = p?.[3];
  // ORE-style "cost to mine": MON a full-skill run pays per coin it mines (deposit / budget).
  const costToMine =
    entryFee !== undefined && launchPrice !== undefined && floor !== undefined
      ? (entryFee * 10000n * (floor > launchPrice ? floor : launchPrice)) / ((entryFee * 7000n) || 1n)
      : undefined;
  const priceRef = miningClosed ? spot : costToMine;
  const floorPct = floor !== undefined && priceRef ? Number((floor * 10000n) / priceRef) / 100 : undefined;
  const beatLink = (s: number) =>
    typeof window === "undefined" ? "" : `${window.location.origin}/game/${params.id}?seed=${runSeed.current ?? 0}&beat=${s}`;
  const creatorEarned = r(17) as bigint | undefined;

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
  const runSeed = useRef<number | null>(null);
  // "Beat my score" links: ?seed=<n>&beat=<score> replays the same obstacle pattern.
  const [challenge, setChallenge] = useState<{ seed: number; beat: number } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const seed = Number(q.get("seed")), beat = Number(q.get("beat"));
    if (Number.isFinite(seed) && q.get("seed") && Number.isFinite(beat)) setChallenge({ seed: seed >>> 0, beat });
  }, []);

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
      runSeed.current = challenge ? challenge.seed : (Number(ev.args.sessionId % 1000000n) * 7919 + Number(id) * 104729) >>> 0;
      setPhase("playing");
      player.current?.start(runSeed.current);
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
        args: [sessionId.current, BigInt(data.score), data.signature],
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
        <p className="text-xl text-[color:var(--muted)]">
          Game #{params.id} doesn&apos;t exist.{" "}
          <Link className="text-[color:var(--monad-lilac)] underline" href="/">
            Back to games
          </Link>
        </p>
      </Shell>
    );
  }

  const cfg = config.data;
  const gameTitle = cfg?.title ?? name ?? `Game #${params.id}`;
  const miningPct =
    totalMined !== undefined && supplyCap ? Math.min(100, Number((totalMined * 10000n) / supplyCap) / 100) : 0;

  const playBusy = phase === "paying" || phase === "playing" || phase === "claiming";

  return (
    <Shell>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,480px)_minmax(0,1fr)]">
        <section className="flex flex-col gap-4">
          <Reveal className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-3">
              <h1 className={`${title} text-sm sm:text-base`}>{gameTitle}</h1>
              <span className="pixel-label text-[color:var(--monad-cyan)]">${symbol}</span>
            </div>
            {cfg?.tagline && <p className="text-xl text-[color:var(--muted)]">{cfg.tagline}</p>}
            {g && g.parentId > 0n && (
              <Link href={`/game/${g.parentId}`} className="pixel-label pixel-nav text-[color:var(--monad-lilac)]">
                Remix of game #{g.parentId.toString()}
              </Link>
            )}
          </Reveal>

          <div className="pixel-panel overflow-hidden bg-black">
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
              <div className="grid aspect-[2/3] place-items-center text-xl text-[color:var(--muted)]">
                {config.isLoading || game.isLoading ? <PixelLoader label="Loading game" /> : "Game config not found."}
              </div>
            )}
          </div>

          <PixelPanel className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="pixel-label tabular-nums">
                Score{" "}
                <PopValue value={score} className="text-[color:var(--monad-lilac)]" />
                {cfg?.scoreLabel && <span className="text-[color:var(--muted)]"> {cfg.scoreLabel}</span>}
              </div>
              {phase === "signing" && sessionId.current !== null && !msg ? (
                <PixelLoader label="Signing score" />
              ) : phase === "signing" && sessionId.current !== null ? (
                <PixelButton onClick={() => onGameOver(score)}>Claim score</PixelButton>
              ) : (
                <PixelButton busy={playBusy} disabled={!address || !cfg} onClick={play}>
                  {!address
                    ? "Connect wallet to play"
                    : phase === "paying"
                      ? "Confirm in wallet"
                      : phase === "playing"
                        ? "Playing"
                        : phase === "claiming"
                          ? "Claiming"
                          : `Play · ${mon(entryFee)} MON`}
                </PixelButton>
              )}
            </div>
            <p className="text-lg text-[color:var(--muted)]">
              70% of every entry fee goes to the vault, so the floor only goes up.
              {!miningClosed && ` While mining is open, each run mines coins worth its vault deposit at the floor; score ${targetScore?.toString() ?? "40"}+ gets the full amount, so no run can lower the floor.`}
            </p>
            {challenge && (
              <p className="text-lg text-[color:var(--good)]">
                Challenge: beat {challenge.beat} on the same seeded run.{phase === "done" ? (score > challenge.beat ? " You won it. GG." : " Not this time. Run it back.") : ""}
              </p>
            )}
            {phase === "done" && lastMined !== null && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-lg text-[color:var(--good)]">
                  {lastMined > 0n ? `You mined ${tokens(lastMined)} $${symbol}. LFG.` : "Run recorded on-chain. Mining is closed, so no tokens this time."} Every run pumps the floor.
                </p>
                <a
                  className="pixel-btn-ghost"
                  target="_blank"
                  rel="noreferrer"
                  href={`https://x.com/intent/post?text=${encodeURIComponent(
                    `${score >= 30 ? "built different:" : score <= 5 ? "got rekt:" : "gm. just scored"} ${score} ${cfg?.scoreLabel ?? "points"} in ${gameTitle} ($${symbol}) on @monad_xyz testnet.\n\nevery run pumps an unruggable floor. ape in:`,
                  )}&url=${encodeURIComponent(beatLink(score))}`}
                >
                  Share on X
                </a>
                <button
                  className="pixel-btn-ghost"
                  onClick={() => navigator.clipboard?.writeText(beatLink(score)).then(() => setMsg("Beat-my-score link copied. Friends get the same run.")).catch(() => setMsg(beatLink(score)))}
                >
                  Copy beat-my-score link
                </button>
              </div>
            )}
            {msg && <p className="text-lg text-[color:var(--danger)]">{msg}</p>}
          </PixelPanel>
        </section>

        <section className="flex flex-col gap-6">
          <Reveal delay={1} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatBlock label="Unruggable floor" value={`${mon(floor, 6)} MON`} hint="vault ÷ supply" accent />
            <StatBlock label={miningClosed ? "Floor vs buy price" : "Floor vs cost to mine"} value={floorPct !== undefined ? `${floorPct.toFixed(0)}%` : "…"} hint={miningClosed ? `buy ${mon(spot, 6)}` : `mine 1 for ${mon(costToMine, 6)}`} />
            <StatBlock label="Vault" value={`${mon(vaultBal.data?.value, 4)} MON`} />
            <StatBlock label="Supply" value={`${tokens(supply, 0)} ${symbol}`} />
            <StatBlock label="Players" value={players?.toString() ?? "…"} />
            <StatBlock label="Runs" value={finished?.toString() ?? "…"} />
            <StatBlock label="Best score" value={bestScore?.toString() ?? "…"} hint={bestPlayer && bestScore ? short(bestPlayer) : undefined} />
          </Reveal>

          {g && (
            <DegenFeed sessions={g.sessions} curve={g.curve} vault={g.vault} symbol={symbol} creator={g.creator} />
          )}
          {g && <Leaderboard sessions={g.sessions} symbol={symbol} />}

          <MarketPanel heading={miningClosed ? "Trading is open" : "Play-mining is open"}>
            {!miningClosed ? (
              <>
                <p className="text-xl text-[color:var(--muted)]">
                  Coins can only be earned by playing until {tokens(supplyCap, 0)} {symbol} are mined or {runCap?.toString() ?? "300"} runs are played. Then the curve opens for buyers.
                </p>
                <ProgressBar pct={miningPct} />
                <p className="pixel-label tabular-nums text-[color:var(--muted)]">
                  {tokens(totalMined, 0)} / {tokens(supplyCap, 0)} mined · you: {tokens(myMined, 0)} / {tokens(walletCap, 0)}
                </p>
              </>
            ) : (
              <>
                <p className="text-xl text-[color:var(--muted)]">
                  Buy price is {mon(spot, 6)} MON per {symbol}, always at least 10% above the floor. Every MON spent goes into the vault, so each buy pumps the floor for all holders.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <PixelInput id="buy-amount" className="w-32" value={buyAmt} onChange={(e) => setBuyAmt(e.target.value)} inputMode="decimal" />
                  <span className="pixel-label text-[color:var(--muted)]">{symbol}</span>
                  <PixelButton
                    busy={busy === "Buy"}
                    disabled={!address || !buyUnits || !quote.data || !!busy}
                    onClick={() =>
                      act("Buy", () =>
                        send({ address: g!.curve, abi: bondingCurveAbi, functionName: "buy", args: [buyUnits!], value: (quote.data! * 101n) / 100n }),
                      )
                    }
                  >
                    {busy === "Buy" ? "Buying" : `Buy for ~${mon(quote.data, 4)} MON`}
                  </PixelButton>
                </div>
              </>
            )}
          </MarketPanel>

          <MarketPanel heading="Redeem from the vault">
            <p className="text-xl text-[color:var(--muted)]">
              Burn {symbol} and get your share of the vault, at the floor price. You hold {tokens(myBalance)} {symbol}.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <PixelInput id="redeem-amount" className="w-32" placeholder="Amount" value={redeemAmt} onChange={(e) => setRedeemAmt(e.target.value)} inputMode="decimal" />
              <PixelButton variant="ghost" disabled={!myBalance} onClick={() => setRedeemAmt(trimNum(myBalance))}>
                Max
              </PixelButton>
              <PixelButton
                busy={busy === "Redeem"}
                disabled={!address || !redeemUnits || !!busy || (myBalance !== undefined && redeemUnits! > myBalance)}
                onClick={() => act("Redeem", () => send({ address: g!.vault, abi: treasuryVaultAbi, functionName: "redeem", args: [redeemUnits!] }))}
              >
                {busy === "Redeem" ? "Redeeming" : `Redeem for ${mon(preview.data, 6)} MON`}
              </PixelButton>
            </div>
          </MarketPanel>

          <MarketPanel heading="Creator unlocks">
            <p className="text-xl text-[color:var(--muted)]">
              The creator&apos;s 30% of entry fees ({mon(creatorEarned)} MON so far) sits in escrow and unlocks 25% at a time as real players arrive. No free dev coins, so the floor is never diluted.
            </p>
            <div className="flex flex-wrap gap-2">
              {milestones?.map((m, i) => {
                const hit = players !== undefined && players >= m;
                return (
                  <PixelBadge key={i} tone={hit ? "trading" : "default"}>
                    {m.toString()} players
                  </PixelBadge>
                );
              })}
            </div>
            <p className="pixel-label tabular-nums text-[color:var(--muted)]">
              Unlocked {mon(unlocked)} MON · claimed {mon(claimed)} MON
            </p>
            {isCreator && (
              <div className="flex flex-wrap gap-2">
                <PixelButton
                  busy={busy === "Claim"}
                  disabled={!!busy || unlocked === undefined || claimed === undefined || unlocked <= claimed}
                  onClick={() => act("Claim", () => send({ address: g!.sessions, abi: sessionManagerAbi, functionName: "claimCreator" }))}
                >
                  {busy === "Claim" ? "Claiming" : "Claim unlocked MON"}
                </PixelButton>
                {!miningClosed && (
                  <PixelButton
                    variant="ghost"
                    busy={busy === "Close mining"}
                    disabled={!!busy}
                    onClick={() => act("Close mining", () => send({ address: g!.sessions, abi: sessionManagerAbi, functionName: "closeMining" }))}
                  >
                    {busy === "Close mining" ? "Closing" : "End mining and open trading"}
                  </PixelButton>
                )}
              </div>
            )}
          </MarketPanel>

          {cfg && (
            <Link href={`/create?remix=${params.id}`} className="pixel-label pixel-nav w-fit text-[color:var(--monad-lilac)]">
              Remix this game with a new prompt →
            </Link>
          )}
          {marketMsg && <p className="text-xl text-white/80">{marketMsg}</p>}
        </section>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className={shell}>
      <Header />
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}

function MarketPanel({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <PixelPanel className="flex flex-col gap-3">
      <h2 className={`${title} text-[11px]`}>{heading}</h2>
      {children}
    </PixelPanel>
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
