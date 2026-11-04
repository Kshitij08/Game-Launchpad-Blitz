"use client";

import { useRef, useState } from "react";
import {
  isAssetRef,
  assetIdOf,
  TEMPLATE_INFO,
  VFX_STYLES,
  type GameConfig,
  type VfxPreset,
} from "@/lib/game-config";

type SpriteSlot = "player" | "obstacle" | "collectible" | "decor" | "projectile";
type SoundSlot = "jump" | "score" | "collect" | "hit" | "shoot" | "music";
type VfxSlot = "trail" | "collect" | "hit" | "score" | "shoot";

const SPRITE_HELP: Record<SpriteSlot, string> = {
  player: "Your character, about 48×48",
  obstacle: "",
  collectible: "Bonus item, about 32×32",
  decor: "Background detail, about 128×64",
  projectile: "Bullet, about 8×20",
};

const SOUND_LABEL: Record<SoundSlot, string> = {
  jump: "Jump / flap",
  score: "Score",
  collect: "Collect",
  hit: "Hit / game over",
  shoot: "Shoot",
  music: "Music (loops)",
};

const VFX_LABEL: Record<VfxSlot, string> = {
  trail: "Player trail",
  collect: "Collect burst",
  hit: "Hit burst",
  score: "Score burst",
  shoot: "Muzzle flash",
};

export const assetUrl = (ref: string) => `/api/asset/${assetIdOf(ref as `asset:0x${string}`)}`;

/** Inline SVG → data URL. Use charset=utf-8 (not bare `utf8`) so <img> actually paints. */
export function spriteSrc(s: string): string {
  if (!s) return "";
  if (isAssetRef(s)) return assetUrl(s);
  if (s.startsWith("data:")) return s;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;
}

async function upload(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/asset", { method: "POST", body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Upload failed");
  return data.ref as string;
}

/**
 * Lets the creator swap AI-made sprites for their own images, add sound
 * effects, and pick particle effects. Edits are applied to the config in place;
 * `original` is the AI version, used for "Reset".
 */
export function AssetCustomizer({
  config,
  original,
  onChange,
}: {
  config: GameConfig;
  original: GameConfig;
  onChange(next: GameConfig): void;
}) {
  const [tab, setTab] = useState<"sprites" | "sounds" | "effects">("sprites");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const t = config.template;
  const spriteSlots: SpriteSlot[] = ["player", "obstacle", "collectible", "decor", ...(t === "shooter" ? (["projectile"] as const) : [])];
  const soundSlots: SoundSlot[] = t === "shooter" ? ["shoot", "score", "collect", "hit", "music"] : t === "dodge" ? ["score", "collect", "hit", "music"] : ["jump", "score", "collect", "hit", "music"];
  const vfxSlots: VfxSlot[] = t === "shooter" ? ["trail", "shoot", "hit", "score", "collect"] : ["trail", "collect", "hit", "score"];

  async function withUpload(slot: string, file: File, apply: (ref: string) => GameConfig) {
    setError(null);
    setBusy(slot);
    try {
      const ref = await upload(file);
      onChange(apply(ref));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const setSprite = (slot: SpriteSlot, v: string | undefined) => {
    const sprites = { ...config.sprites } as Record<string, string | undefined>;
    if (v === undefined) delete sprites[slot];
    else sprites[slot] = v;
    onChange({ ...config, sprites: sprites as GameConfig["sprites"] });
  };
  const setSound = (slot: SoundSlot, v: string | undefined) => {
    const sfx = { ...(config.sfx ?? {}) } as Record<string, string | undefined>;
    if (v === undefined) delete sfx[slot];
    else sfx[slot] = v;
    onChange({ ...config, sfx: sfx as GameConfig["sfx"] });
  };
  const setVfx = (slot: VfxSlot, v: VfxPreset | undefined) => {
    const vfx = { ...(config.vfx ?? {}) } as Record<string, VfxPreset | undefined>;
    if (v === undefined) delete vfx[slot];
    else vfx[slot] = v;
    onChange({ ...config, vfx: vfx as GameConfig["vfx"] });
  };

  return (
    <div className="pixel-panel flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="pixel-title text-[11px]">Make it yours</h2>
        <div role="tablist" className="flex gap-1 border-2 border-[color:var(--border)] bg-black/40 p-1">
          {(["sprites", "sounds", "effects"] as const).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`pixel-label px-3 py-1 capitalize ${tab === k ? "bg-[color:var(--monad-purple)] text-white" : "text-[color:var(--muted)] hover:text-white"}`}
            >
              {k}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="text-lg text-[color:var(--danger)]">{error}</p>}

      {tab === "sprites" && (
        <ul className="flex flex-col divide-y divide-white/10">
          {spriteSlots.map((slot) => {
            const cur = config.sprites[slot];
            const orig = original.sprites[slot];
            const label = slot === "obstacle" ? capitalize(TEMPLATE_INFO[t].obstacle) : slot[0].toUpperCase() + slot.slice(1);
            return (
              <li key={slot} className="flex items-center gap-3 py-2.5">
                <div className="grid h-12 w-12 shrink-0 place-items-center border-2 border-[color:var(--border)] bg-black/40">
                  {cur ? <img alt="" src={spriteSrc(cur)} className="pixel-art max-h-10 max-w-10 object-contain" /> : <span className="pixel-label text-[color:var(--muted)]">none</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="pixel-label text-white">{label}</div>
                  <div className="truncate text-lg text-[color:var(--muted)]">
                    {cur && isAssetRef(cur) ? "Your upload" : cur ? "Drawn by Claude" : "Not used"} · {slot === "obstacle" ? "about 48×64" : SPRITE_HELP[slot]}
                  </div>
                </div>
                <UploadButton
                  id={`up-sprite-${slot}`}
                  accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                  busy={busy === slot}
                  onFile={(f) => withUpload(slot, f, (ref) => ({ ...config, sprites: { ...config.sprites, [slot]: ref } }))}
                />
                {cur !== orig && (
                  <button className={ghost} onClick={() => setSprite(slot, orig)}>Reset</button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {tab === "sounds" && (
        <ul className="flex flex-col divide-y divide-white/10">
          {soundSlots.map((slot) => {
            const cur = config.sfx?.[slot];
            return (
              <li key={slot} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="pixel-label text-white">{SOUND_LABEL[slot]}</div>
                  <div className="text-lg text-[color:var(--muted)]">
                    {cur === "none" ? "Muted" : cur ? "Your upload" : slot === "music" ? "No music" : "Built-in sound"}
                  </div>
                </div>
                {cur && isAssetRef(cur) && (
                  <button className={ghost} onClick={() => new Audio(assetUrl(cur)).play().catch(() => {})}>Play</button>
                )}
                <UploadButton
                  id={`up-sfx-${slot}`}
                  accept="audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/aac,audio/webm,.mp3,.wav,.ogg,.m4a"
                  busy={busy === slot}
                  onFile={(f) => withUpload(slot, f, (ref) => ({ ...config, sfx: { ...(config.sfx ?? {}), [slot]: ref } }))}
                />
                {slot !== "music" && cur !== "none" && (
                  <button className={ghost} onClick={() => setSound(slot, "none")}>Mute</button>
                )}
                {cur !== undefined && (
                  <button className={ghost} onClick={() => setSound(slot, undefined)}>Default</button>
                )}
              </li>
            );
          })}
          <li className="pt-2.5 text-lg text-[color:var(--muted)]">MP3, WAV, OGG or M4A up to 600 KB each. Short clips work best.</li>
        </ul>
      )}

      {tab === "effects" && (
        <ul className="flex flex-col divide-y divide-white/10">
          {vfxSlots.map((slot) => {
            const cur = config.vfx?.[slot];
            const color = cur?.colors?.[0] ?? config.palette.accent;
            return (
              <li key={slot} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="pixel-label text-white">{VFX_LABEL[slot]}</div>
                  <div className="text-lg text-[color:var(--muted)]">
                    {cur ? `${cur.style}${cur.texture ? " · your particle image" : ""}` : "Default"}
                  </div>
                </div>
                <label className="sr-only" htmlFor={`vfx-style-${slot}`}>{VFX_LABEL[slot]} style</label>
                <select
                  id={`vfx-style-${slot}`}
                  value={cur?.style ?? ""}
                  onChange={(e) =>
                    setVfx(slot, e.target.value ? { ...(cur ?? {}), style: e.target.value as VfxPreset["style"] } : undefined)
                  }
                  className="pixel-input px-2 py-1.5 text-lg"
                >
                  <option value="">Default</option>
                  {VFX_STYLES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <label className="sr-only" htmlFor={`vfx-color-${slot}`}>{VFX_LABEL[slot]} colour</label>
                <input
                  id={`vfx-color-${slot}`}
                  type="color"
                  value={color}
                  disabled={!cur || cur.style === "none"}
                  onChange={(e) => cur && setVfx(slot, { ...cur, colors: [e.target.value] })}
                  className="h-8 w-10 cursor-pointer border-2 border-[color:var(--border)] bg-transparent disabled:opacity-30"
                />
                <UploadButton
                  id={`up-vfx-${slot}`}
                  label="Particle"
                  accept="image/png,image/gif,image/webp,image/svg+xml"
                  busy={busy === `vfx-${slot}`}
                  onFile={(f) =>
                    withUpload(`vfx-${slot}`, f, (ref) => ({
                      ...config,
                      vfx: { ...(config.vfx ?? {}), [slot]: { style: cur?.style && cur.style !== "none" ? cur.style : "sparkle", ...(cur?.colors ? { colors: cur.colors } : {}), texture: ref } },
                    }))
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function UploadButton({ id, accept, busy, onFile, label = "Upload" }: { id: string; accept: string; busy: boolean; onFile(f: File): void; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        id={id}
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <button className={ghost} disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? "Uploading…" : label}
      </button>
    </>
  );
}

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);
const ghost = "pixel-btn-ghost !px-3 !py-1.5";
