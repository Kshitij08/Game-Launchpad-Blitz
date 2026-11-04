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
import {
  PixelButton,
  PixelChip,
  PixelInput,
  PixelLoader,
  PixelPanel,
  PixelTextarea,
  PopValue,
  Reveal,
} from "@/components/PixelUI";
import { shell, title } from "@/lib/ui";

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
    <div className={shell}>
      <Header />
      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 py-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <section className="flex min-w-0 flex-col gap-5">
          <Reveal className="flex flex-col gap-2">
            <p className="pixel-label text-[color:var(--monad-cyan)]">{isRemix ? "remix mode" : "new cartridge"}</p>
            <h1 className={`${title} text-sm sm:text-base`}>{isRemix ? `Remix game #${remixId}` : "Create a game"}</h1>
            <p className="copy">
              {isRemix
                ? "Describe what to change. 10% of every play fee in your remix flows to the original game's vault."
                : "Describe your game in a sentence. Claude builds it on a 2D arcade template in about 20 seconds."}
            </p>
          </Reveal>

          <Reveal delay={1}>
            <label htmlFor="prompt" className="sr-only">Game prompt</label>
            <PixelTextarea
              id="prompt"
              rows={3}
              maxLength={400}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={isRemix ? "e.g. season 2: underwater, jellyfish instead of rocks, a bit faster" : "e.g. a cat dodging cucumbers in a neon kitchen"}
              className="w-full min-h-[6rem] text-xl"
            />
          </Reveal>

          {!isRemix && (
            <Reveal delay={2} className="flex flex-wrap items-center gap-2">
              <span className="pixel-label text-[color:var(--muted)]">Style</span>
              {(["", ...TEMPLATES] as const).map((t) => (
                <PixelChip key={t || "auto"} active={template === t} onClick={() => setTemplate(t)}>
                  {t === "" ? "Let Claude pick" : TEMPLATE_INFO[t].label}
                </PixelChip>
              ))}
            </Reveal>
          )}

          {!isRemix && !draft && (
            <Reveal delay={3} className="flex flex-col gap-2">
              <span className="pixel-label text-[color:var(--muted)]">Need alpha? Try one</span>
              <div className="flex flex-wrap gap-2">
                {[...MEME_PROMPTS, ...SAMPLE_CONFIGS.map((s) => s.prompt)].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPrompt(p)}
                    className="pixel-panel max-w-full px-3 py-2 text-left text-lg text-white/85 hover:border-[color:var(--monad-purple)]"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </Reveal>
          )}

          <div className="flex flex-wrap gap-3">
            {(isRemix || draft) && (
              <PixelButton busy={generating} disabled={prompt.trim().length < 3 || !draft} onClick={() => generate("edit")}>
                {generating ? `Changing ${elapsed}s` : isRemix ? "Apply change" : "Change this game"}
              </PixelButton>
            )}
            {!isRemix && (
              <PixelButton
                variant={draft ? "ghost" : "solid"}
                busy={generating}
                disabled={prompt.trim().length < 3}
                onClick={() => generate("new")}
              >
                {generating ? `Generating ${elapsed}s` : draft ? "Start over from prompt" : "Generate game"}
              </PixelButton>
            )}
          </div>
          {generating && (
            <div className="flex flex-col gap-1">
              <PixelLoader label="Claude is drawing sprites" />
              <p className="text-lg text-[color:var(--muted)]">Rules, difficulty, and effects usually take 15–25 seconds.</p>
            </div>
          )}
          {error && <p className="text-lg text-[color:var(--danger)]">{error}</p>}

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
            <PixelPanel className="flex flex-col gap-4">
              <h2 className={`${title} text-[11px]`}>Launch</h2>
              <p className="text-xl text-[color:var(--muted)]">
                Launching deploys the token, its vault and its play contract on Monad testnet (about 0.3 MON in gas). Early tokens can only be mined by playing.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_140px]">
                <label className="flex flex-col gap-1">
                  <span className="pixel-label text-[color:var(--muted)]">Token name</span>
                  <PixelInput id="token-name" className="w-full" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="pixel-label text-[color:var(--muted)]">Ticker</span>
                  <PixelInput
                    id="token-symbol"
                    className="w-full uppercase"
                    value={symbol}
                    maxLength={8}
                    onChange={(e) => setSymbol(e.target.value.replace(/[^A-Za-z0-9]/g, ""))}
                  />
                </label>
              </div>
              <PixelButton busy={launching} disabled={!canLaunch || unchangedRemix} onClick={launch}>
                {!address
                  ? "Connect wallet to launch"
                  : launching
                    ? "Launching"
                    : unchangedRemix
                      ? "Change something first"
                      : `Launch $${symbol.toUpperCase() || "…"}`}
              </PixelButton>
            </PixelPanel>
          )}
        </section>

        <aside className="flex flex-col gap-3">
          <div className="pixel-panel overflow-hidden bg-black">
            {draft ? (
              <GamePlayer
                ref={player}
                config={draft.config}
                ticker={symbol.trim().toUpperCase() || undefined}
                onGameOver={(s) => setTestScore(s)}
              />
            ) : (
              <div className="grid aspect-[2/3] place-items-center gap-3 p-8 text-center text-xl text-[color:var(--muted)]">
                {generating ? <PixelLoader label="Building preview" /> : "Your game preview appears here."}
              </div>
            )}
          </div>
          {draft && (
            <div className="flex items-center justify-between gap-2">
              <PixelButton variant="ghost" onClick={() => player.current?.start()}>
                Test play (free)
              </PixelButton>
              {testScore !== null && (
                <span className="pixel-label text-[color:var(--muted)]">
                  Last test: <PopValue value={testScore} className="text-[color:var(--monad-lilac)]" />
                </span>
              )}
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

const MEME_PROMPTS = [
  "a frog dodging red candles and catching green ones",
  "a purple cat shooting down jeets and paper-handed bears",
  "tap to keep the chart flying above the liquidation line",
  "a degen sprinting from a rug pull, jumping over gas fees",
  "a dog in a spacesuit catching airdrops while dodging scam links",
];

function tickerFrom(title: string) {
  const words = title.toUpperCase().replace(/[^A-Z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  const t = words.length > 1 ? words.map((w) => w[0]).join("") : words[0] ?? "GAME";
  return (t.length >= 3 ? t : (words[0] ?? "GAME")).slice(0, 5);
}
