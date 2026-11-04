"use client";

import { useRef, useState } from "react";
import { GamePlayer, type GamePlayerHandle } from "@/components/GamePlayer";
import { gameConfigSchema, type GameConfig } from "@/lib/game-config";
import { SAMPLE_CONFIGS } from "@/lib/sample-configs";

interface LogLine {
  t: string;
  msg: string;
}

export default function DevPlayPage() {
  const player = useRef<GamePlayerHandle>(null);
  const [sampleId, setSampleId] = useState<string>(SAMPLE_CONFIGS[0].id);
  const [config, setConfig] = useState<GameConfig>(SAMPLE_CONFIGS[0].config);
  const [autoStart, setAutoStart] = useState(false);
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState<{ score: number; durationMs: number } | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [json, setJson] = useState(() => JSON.stringify(SAMPLE_CONFIGS[0].config, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  const addLog = (msg: string) =>
    setLog((l) => [{ t: new Date().toLocaleTimeString(), msg }, ...l].slice(0, 30));

  function pickSample(id: string) {
    const s = SAMPLE_CONFIGS.find((x) => x.id === id);
    if (!s) return;
    setSampleId(id);
    setConfig(s.config);
    setJson(JSON.stringify(s.config, null, 2));
    setJsonError(null);
    setGameOver(null);
    setScore(0);
    addLog(`sample: ${s.name}`);
  }

  function loadJson() {
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch (e) {
      setJsonError(`JSON parse error: ${(e as Error).message}`);
      return;
    }
    const parsed = gameConfigSchema.safeParse(raw);
    if (!parsed.success) {
      setJsonError(parsed.error.issues.map((i) => `${i.path.join(".") || "config"}: ${i.message}`).join("\n"));
      return;
    }
    setJsonError(null);
    setSampleId("");
    setConfig(parsed.data);
    setGameOver(null);
    setScore(0);
    addLog("loaded config from JSON");
  }

  return (
    <main className="min-h-screen bg-neutral-950 p-4 text-neutral-100 md:p-8">
      <h1 className="mb-1 text-2xl font-bold">Game runtime dev page</h1>
      <p className="mb-6 text-sm text-neutral-400">
        Pick a sample or paste a config, press Start, then tap / click / space inside the game.
      </p>

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="w-full max-w-[420px] shrink-0">
          <GamePlayer
            ref={player}
            config={config}
            autoStart={autoStart}
            className="aspect-[2/3] w-full rounded-xl"
            onLoaded={() => addLog("loaded")}
            onScore={(n) => {
              setScore(n);
            }}
            onGameOver={(s, ms) => {
              setGameOver({ score: s, durationMs: ms });
              addLog(`gameOver score=${s} durationMs=${ms}`);
            }}
            onError={(m) => addLog(`error: ${m}`)}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <section className="flex flex-wrap gap-2">
            {SAMPLE_CONFIGS.map((s) => (
              <button
                key={s.id}
                onClick={() => pickSample(s.id)}
                className={`rounded-lg px-3 py-2 text-sm font-medium ${
                  sampleId === s.id ? "bg-violet-600 text-white" : "bg-neutral-800 hover:bg-neutral-700"
                }`}
              >
                {s.name} <span className="text-xs opacity-70">({s.config.template})</span>
              </button>
            ))}
          </section>

          <section className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                setGameOver(null);
                player.current?.start();
                addLog("start()");
              }}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-500"
            >
              Start
            </button>
            <button
              onClick={() => {
                player.current?.reset();
                addLog("reset()");
              }}
              className="rounded-lg bg-neutral-700 px-4 py-2 text-sm font-semibold hover:bg-neutral-600"
            >
              Reset
            </button>
            <label className="ml-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} />
              autoStart
            </label>
          </section>

          <section className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-neutral-900 p-3">
              <div className="text-neutral-400">Live score</div>
              <div className="text-3xl font-bold" data-testid="live-score">
                {score}
              </div>
            </div>
            <div className="rounded-lg bg-neutral-900 p-3">
              <div className="text-neutral-400">Last gameOver</div>
              <pre className="text-xs" data-testid="game-over">
                {gameOver ? JSON.stringify(gameOver, null, 2) : "—"}
              </pre>
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <label className="text-sm text-neutral-400" htmlFor="cfg">
              Raw config JSON
            </label>
            <textarea
              id="cfg"
              value={json}
              onChange={(e) => setJson(e.target.value)}
              spellCheck={false}
              className="h-72 w-full rounded-lg bg-neutral-900 p-3 font-mono text-xs"
            />
            <div className="flex gap-2">
              <button
                onClick={loadJson}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold hover:bg-violet-500"
              >
                Load JSON
              </button>
            </div>
            {jsonError && (
              <pre className="whitespace-pre-wrap rounded-lg bg-red-950 p-3 text-xs text-red-200">{jsonError}</pre>
            )}
          </section>

          <section>
            <div className="mb-1 text-sm text-neutral-400">Events</div>
            <ul className="max-h-48 overflow-auto rounded-lg bg-neutral-900 p-3 font-mono text-xs">
              {log.map((l, i) => (
                <li key={i}>
                  <span className="text-neutral-500">{l.t}</span> {l.msg}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
