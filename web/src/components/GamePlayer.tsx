"use client";

/**
 * <GamePlayer> renders a Proof-of-Play game in a sandboxed iframe
 * (`sandbox="allow-scripts"`, no same-origin) served from /games/engine.html.
 *
 * Usage:
 *   const player = useRef<GamePlayerHandle>(null);
 *   <GamePlayer ref={player} config={cfg} onScore={setScore} onGameOver={(s, ms) => submit(s, ms)} />
 *   player.current?.start(); // begin a run (e.g. after the session is paid for)
 *   player.current?.reset(); // back to the title screen
 *
 * Lifecycle: iframe boots -> "ready" -> we send "load" (validated with
 * gameConfigSchema; invalid configs call onError and are not sent) -> "loaded"
 * (title screen). start() before "loaded" is queued. After start() the game
 * shows "tap to fly/jump"; the run (and durationMs) begins on the first tap.
 * On game over, call start() again for another run or reset() for the title.
 * Changing `config` (deep compare via JSON) re-sends "load" and returns to the
 * title screen; with autoStart the new config starts immediately.
 *
 * Assets: every "asset:0x…" ref in the config (collectAssetRefs) is fetched from
 * GET /api/asset/<0x hash>, turned into a data: URL (cached in memory for the
 * page lifetime) and sent with "load" as `assets`, so the opaque-origin iframe
 * never fetches. A failed fetch is skipped; the engine falls back to a block
 * sprite / synth sound for that slot.
 *
 * Meme layer: `best` (for "NEW BEST") and `ticker` (for "$TICKER TO THE MOON")
 * are sent with every "load"; the engine also raises its local best after each run.
 *
 * Audio: `muted` sends {type:"mute"} on change and after every load.
 *
 * Sizing: by default the wrapper is a 2:3 portrait box, full width up to 480px.
 * Pass className to override (the iframe always fills the wrapper; the game
 * letterboxes itself with Phaser Scale.FIT).
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  assetIdOf,
  collectAssetRefs,
  gameConfigSchema,
  type AssetRef,
  type GameConfig,
  type ParentToGame,
} from "@/lib/game-config";
import { GAME_ENGINE_URL, isGameMessage } from "@/lib/games";

// ref -> data: URL, shared by every player on the page.
const assetCache = new Map<AssetRef, Promise<string | null>>();

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function fetchAsset(ref: AssetRef): Promise<string | null> {
  let p = assetCache.get(ref);
  if (!p) {
    p = fetch(`/api/asset/${assetIdOf(ref)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then(blobToDataUrl)
      .catch((e) => {
        console.warn(`[GamePlayer] asset ${ref} failed to load:`, e);
        assetCache.delete(ref); // allow a retry on the next load
        return null;
      });
    assetCache.set(ref, p);
  }
  return p;
}

/** Fetch every asset the config references. Missing ones are left out. */
export async function loadConfigAssets(config: GameConfig): Promise<Record<string, string>> {
  const refs = collectAssetRefs(config);
  const urls = await Promise.all(refs.map(fetchAsset));
  const out: Record<string, string> = {};
  refs.forEach((ref, i) => {
    const u = urls[i];
    if (u) out[ref] = u;
  });
  return out;
}

export interface GamePlayerHandle {
  /** Start a run (queued until the config is loaded). */
  /** Start a run. Pass a seed to replay the same obstacle pattern (beat-my-score links). */
  start(seed?: number): void;
  /** Return to the title screen. */
  reset(): void;
}

export interface GamePlayerProps {
  config: GameConfig;
  onScore?(score: number): void;
  onGameOver?(score: number, durationMs: number): void;
  /** Invalid config or runtime failure inside the iframe. */
  onError?(message: string): void;
  /** Fired each time a config has been applied (title screen showing). */
  onLoaded?(): void;
  /** Send "start" automatically every time a config finishes loading. */
  autoStart?: boolean;
  /** Mute all game audio (sfx + music). */
  muted?: boolean;
  /** Player's best score on this game, for "NEW BEST" (the sandboxed iframe has no storage). Sent with each load. */
  best?: number;
  /** Token symbol, e.g. "PIZZA", for meme lines like "$PIZZA TO THE MOON". Sent with each load. */
  ticker?: string;
  className?: string;
}

export const GamePlayer = forwardRef<GamePlayerHandle, GamePlayerProps>(function GamePlayer(
  { config, onScore, onGameOver, onError, onLoaded, autoStart = false, muted = false, best, ticker, className },
  ref,
) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Latest props in refs so the message listener never goes stale.
  const cb = useRef({ onScore, onGameOver, onError, onLoaded, autoStart, muted, best, ticker });
  useEffect(() => {
    cb.current = { onScore, onGameOver, onError, onLoaded, autoStart, muted, best, ticker };
  });

  const configKey = useMemo(() => JSON.stringify(config), [config]);
  const st = useRef({ booted: false, sentKey: null as string | null, loaded: false, wantStart: false, seed: null as number | null });

  const send = useCallback((msg: ParentToGame) => {
    iframeRef.current?.contentWindow?.postMessage(msg, "*");
  }, []);

  const fail = useCallback((message: string) => {
    setError(message);
    cb.current.onError?.(message);
  }, []);

  const sendLoad = useCallback(() => {
    const parsed = gameConfigSchema.safeParse(JSON.parse(configKey));
    st.current.sentKey = configKey;
    st.current.loaded = false;
    setLoaded(false);
    if (!parsed.success) {
      fail(
        "Invalid game config: " +
          parsed.error.issues
            .slice(0, 6)
            .map((i) => `${i.path.join(".") || "config"}: ${i.message}`)
            .join("; "),
      );
      return;
    }
    setError(null);
    const key = configKey;
    loadConfigAssets(parsed.data).then((assets) => {
      if (st.current.sentKey !== key) return; // config changed while fetching
      const { best: b, ticker: tk } = cb.current;
      send({
        source: "pop",
        type: "load",
        config: parsed.data,
        assets,
        ...(typeof b === "number" && Number.isFinite(b) ? { best: b } : {}),
        ...(tk ? { ticker: tk } : {}),
      });
    });
  }, [configKey, send, fail]);

  const sendLoadRef = useRef(sendLoad);
  useEffect(() => {
    sendLoadRef.current = sendLoad;
  }, [sendLoad]);

  // Protocol listener
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const win = iframeRef.current?.contentWindow;
      if (!win || e.source !== win || !isGameMessage(e.data)) return;
      const d = e.data;
      switch (d.type) {
        case "ready":
          st.current.booted = true;
          sendLoadRef.current();
          break;
        case "loaded":
          st.current.loaded = true;
          setLoaded(true);
          send({ source: "pop", type: "mute", muted: !!cb.current.muted });
          cb.current.onLoaded?.();
          if (st.current.wantStart || cb.current.autoStart) {
            st.current.wantStart = false;
            send({ source: "pop", type: "start", ...(st.current.seed != null ? { seed: st.current.seed } : {}) });
          }
          break;
        case "score":
          cb.current.onScore?.(d.score);
          break;
        case "gameOver":
          cb.current.onGameOver?.(d.score, d.durationMs);
          break;
        case "error":
          fail(d.message);
          break;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [send, fail]);

  // Re-send when the config actually changes.
  useEffect(() => {
    if (st.current.booted && st.current.sentKey !== configKey) sendLoad();
  }, [configKey, sendLoad]);

  useEffect(() => {
    if (st.current.booted) send({ source: "pop", type: "mute", muted });
  }, [muted, send]);

  useImperativeHandle(
    ref,
    () => ({
      start(seed?: number) {
        iframeRef.current?.focus();
        st.current.seed = seed ?? null;
        if (st.current.loaded) send({ source: "pop", type: "start", ...(seed != null ? { seed } : {}) });
        else st.current.wantStart = true;
      },
      reset() {
        st.current.wantStart = false;
        send({ source: "pop", type: "reset" });
      },
    }),
    [send],
  );

  // Fallback in case "ready" fired before our listener attached.
  const onIframeLoad = useCallback(() => {
    if (!st.current.booted) {
      st.current.booted = true;
      sendLoadRef.current();
    }
  }, []);

  return (
    <div className={`relative overflow-hidden bg-black ${className ?? "aspect-[2/3] w-full max-w-[480px]"}`}>
      <iframe
        ref={iframeRef}
        src={GAME_ENGINE_URL}
        sandbox="allow-scripts"
        title={config.title}
        onLoad={onIframeLoad}
        className="absolute inset-0 h-full w-full border-0"
      />
      {!loaded && !error && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-white/70">
          Loading game…
        </div>
      )}
      {error && (
        <div className="absolute inset-x-0 bottom-0 bg-red-900/90 p-3 text-xs text-red-50">{error}</div>
      )}
    </div>
  );
});

export default GamePlayer;
