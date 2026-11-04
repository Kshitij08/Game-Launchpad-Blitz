"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccount, useReadContract } from "wagmi";
import { parseEventLogs } from "viem";
import { Header } from "@/components/Header";
import { GamePlayer, type GamePlayerHandle } from "@/components/GamePlayer";
import { GAME_FACTORY, gameFactoryAbi } from "@/lib/contracts";
import { fetchConfig } from "@/lib/hooks/useGames";
import { useTx, errorText } from "@/lib/hooks/useTx";
import { SAMPLE_CONFIGS } from "@/lib/sample-configs";
import { TEMPLATES, TEMPLATE_INFO, type GameConfig, type TemplateId } from "@/lib/game-config";
import { AssetCustomizer } from "@/components/AssetCustomizer";

export default function CreatePage() {
  return (
    <Suspense>
      <Create />
    </Suspense>
  );
}

type Draft = { config: GameConfig; hash: `0x${string}` };

function Create() {
  const router = useRouter();
  const search = useSearchParams();
  const remixId = search.get("remix");
  const parentId = remixId && /^\d+$/.test(remixId) ? BigInt(remixId) : 0n;
  const { address } = useAccount();
  const send = useTx();
  const player = useRef<GamePlayerHandle>(null);

  const [prompt, setPrompt] = useState("");
  const [template, setTemplate] = useState<"" | TemplateId>("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [original, setOriginal] = useState<GameConfig | null>(null); // AI version, for "Reset"
  const [dirty, setDirty] = useState(false); // creator edits not yet saved
  const [base, setBase] = useState<Draft | null>(null); // parent config when remixing
  const [generating, setGenerating] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [launching, setLaunching] = useState(false);
  const [testScore, setTestScore] = useState<number | null>(null);

  // Remix: load the parent game's config as the starting point.
  const parent = useReadContract({
    address: GAME_FACTORY,
    abi: gameFactoryAbi,
    functionName: "getGame",
    args: [parentId],
    query: { enabled: parentId > 0n },
  });
  useEffect(() => {
    const p = parent.data;
    if (!p) return;
    fetchConfig(p.configHash).then((c) => {
      if (!c) return;
      const d = { config: c, hash: p.configHash };
      setBase(d);
      setDraft(d);
      setOriginal(c);
    });
  }, [parent.data]);

  useEffect(() => {
    if (!generating) return;
    const t0 = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 250);
    return () => clearInterval(t);
  }, [generating]);

  async function generate(mode: "new" | "edit") {
    setError(null);
    setGenerating(true);
    setElapsed(0);
    try {
      const baseHash = mode === "edit" ? await ensureSaved() : undefined;
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, template: template || undefined, baseHash }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed. Try again.");
      setDraft({ config: data.config, hash: data.hash });
      setOriginal(data.config);
      setDirty(false);
      setName(data.config.title);
      setSymbol(tickerFrom(data.config.title));
      setTestScore(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setGenerating(false);
    }
  }

  /** Saves creator edits (uploads, effects) as a new config and returns the hash to use. */
  async function ensureSaved(): Promise<`0x${string}` | undefined> {
    if (!draft) return undefined;
    if (!dirty) return draft.hash;
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: draft.config }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Couldn't save your changes");
    setDraft({ config: data.config, hash: data.hash });
    setDirty(false);
    return data.hash;
  }

  async function launch() {
    if (!draft) return;
    setError(null);
    setLaunching(true);
    try {
      const hash = (await ensureSaved())!;
      const receipt = await send({
        address: GAME_FACTORY,
        abi: gameFactoryAbi,
        functionName: "createGame",
        args: [name.trim(), symbol.trim().toUpperCase(), hash, parentId],
      });
      const [ev] = parseEventLogs({ abi: gameFactoryAbi, logs: receipt.logs, eventName: "GameCreated" });
      router.push(`/game/${ev.args.id}`);
    } catch (e) {
      setError(errorText(e));
      setLaunching(false);
    }
  }

  const isRemix = parentId > 0n;
  const canLaunch = !!draft && !!address && name.trim().length >= 2 && /^[A-Za-z0-9]{2,8}$/.test(symbol.trim()) && !launching;
  const unchangedRemix = isRemix && !dirty && draft?.hash === base?.hash;

  return (
    <div className="min-h-screen bg-[#0d0b17] text-white">
      <Header />
      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 py-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <section className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-extrabold tracking-tight">{isRemix ? `Remix game #${remixId}` : "Create a game"}</h1>
            <p className="text-white/70">
              {isRemix
                ? "Describe what to change. 10% of every play fee in your remix flows to the original game's vault."
                : "Describe your game in a sentence. Claude builds it on a 2D arcade template in about 20 seconds."}
            </p>
          </div>

          <label htmlFor="prompt" className="sr-only">Game prompt</label>
          <textarea
            id="prompt"
            rows={3}
            maxLength={400}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={isRemix ? "e.g. season 2: underwater, jellyfish instead of rocks, a bit faster" : "e.g. a cat dodging cucumbers in a neon kitchen"}
            className="w-full rounded-xl border border-white/15 bg-black/40 p-4 text-base outline-none focus:border-[#a58cff]"
          />

          {!isRemix && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-white/60">Style:</span>
              {(["", ...TEMPLATES] as const).map((t) => (
                <button
                  key={t || "auto"}
                  onClick={() => setTemplate(t)}
                  className={`rounded-full border px-3 py-1 ${template === t ? "border-[#a58cff] bg-[#836ef9]/20" : "border-white/15 text-white/70"}`}
                >
                  {t === "" ? "Let Claude pick" : TEMPLATE_INFO[t].label}
                </button>
              ))}
            </div>
          )}

          {!isRemix && !draft && (
            <div className="flex flex-col gap-2">
              <span className="text-sm text-white/60">Or try one of these:</span>
              <div className="flex flex-wrap gap-2">
                {SAMPLE_CONFIGS.map((s) => (
                  <button key={s.id} onClick={() => setPrompt(s.prompt)} className="rounded-lg border border-white/10 px-3 py-1.5 text-left text-sm text-white/80 hover:border-white/30">
                    {s.prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            {(isRemix || draft) && (
              <button className={btn} disabled={generating || prompt.trim().length < 3 || !draft} onClick={() => generate("edit")}>
                {generating ? `Changing… ${elapsed}s` : isRemix ? "Apply change" : "Change this game"}
              </button>
            )}
            {!isRemix && (
              <button className={draft ? btnGhost : btn} disabled={generating || prompt.trim().length < 3} onClick={() => generate("new")}>
                {generating ? `Generating… ${elapsed}s` : draft ? "Start over from prompt" : "Generate game"}
              </button>
            )}
          </div>
          {generating && (
            <p className="text-sm text-white/60">
              Claude is designing the rules, tuning the difficulty and drawing the sprites and effects. This takes about 15–25 seconds.
            </p>
          )}
          {error && <p className="text-sm text-red-300">{error}</p>}

          {draft && original && (
            <AssetCustomizer
              config={draft.config}
              original={original}
              onChange={(next) => {
                setDraft({ config: next, hash: draft.hash });
                setDirty(true);
              }}
            />
          )}

          {draft && (
            <div className="flex flex-col gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <h2 className="font-bold">Launch</h2>
              <p className="text-sm text-white/70">
                Launching deploys the token, its vault and its play contract on Monad testnet (about 0.3 MON in gas). Early tokens can only be mined by playing.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_140px]">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-white/60">Token name</span>
                  <input id="token-name" className={input} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-white/60">Ticker</span>
                  <input id="token-symbol" className={`${input} uppercase`} value={symbol} maxLength={8} onChange={(e) => setSymbol(e.target.value.replace(/[^A-Za-z0-9]/g, ""))} />
                </label>
              </div>
              <button className={btn} disabled={!canLaunch || unchangedRemix} onClick={launch}>
                {!address ? "Connect wallet to launch" : launching ? "Launching…" : unchangedRemix ? "Change something first" : `Launch $${symbol.toUpperCase() || "…"}`}
              </button>
            </div>
          )}
        </section>

        <aside className="flex flex-col gap-3">
          <div className="overflow-hidden rounded-xl border border-white/10 bg-black">
            {draft ? (
              <GamePlayer ref={player} config={draft.config} onGameOver={(s) => setTestScore(s)} />
            ) : (
              <div className="grid aspect-[2/3] place-items-center p-8 text-center text-white/40">
                {generating ? "Building your game…" : "Your game preview appears here."}
              </div>
            )}
          </div>
          {draft && (
            <div className="flex items-center justify-between gap-2">
              <button className={btnGhost} onClick={() => player.current?.start()}>Test play (free)</button>
              {testScore !== null && <span className="font-mono text-sm text-white/70">Last test: {testScore}</span>}
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

function tickerFrom(title: string) {
  const words = title.toUpperCase().replace(/[^A-Z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  const t = words.length > 1 ? words.map((w) => w[0]).join("") : words[0] ?? "GAME";
  return (t.length >= 3 ? t : (words[0] ?? "GAME")).slice(0, 5);
}

const btn =
  "rounded-lg bg-[#836ef9] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#9583ff] disabled:cursor-not-allowed disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-white/20 px-4 py-2.5 text-sm text-white/80 hover:border-white/40 disabled:cursor-not-allowed disabled:opacity-50";
const input =
  "rounded-lg border border-white/15 bg-black/40 px-3 py-2 font-mono text-sm text-white outline-none focus:border-[#a58cff]";
