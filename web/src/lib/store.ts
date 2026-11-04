// Server-only module (uses Upstash credentials).
import { Redis } from "@upstash/redis";
import { keccak256, toBytes } from "viem";
import { gameConfigSchema, type GameConfig } from "@/lib/game-config";
import { stableStringify } from "@/lib/stable-stringify";

let _redis: Redis | null = null;
export function redis(): Redis {
  if (!_redis) _redis = Redis.fromEnv();
  return _redis;
}

const configKey = (hash: string) => `game:config:${hash.toLowerCase()}`;
const DRAFTS_KEY = "game:drafts";

export const isHash = (s: string) => /^0x[0-9a-fA-F]{64}$/.test(s);

/** keccak256 of the canonical (key-sorted) JSON. This is what goes on-chain. */
export function hashConfig(config: GameConfig): `0x${string}` {
  return keccak256(toBytes(stableStringify(config)));
}

export async function saveConfig(config: GameConfig): Promise<{ hash: `0x${string}` }> {
  const hash = hashConfig(config);
  // Content-addressed: same config -> same key, so overwriting is harmless.
  await redis().set(configKey(hash), stableStringify(config));
  await redis().lpush(DRAFTS_KEY, hash);
  await redis().ltrim(DRAFTS_KEY, 0, 49);
  return { hash };
}

export async function getConfig(hash: string): Promise<GameConfig | null> {
  if (!isHash(hash)) return null;
  const raw = await redis().get<unknown>(configKey(hash));
  if (raw == null) return null;
  // Upstash auto-parses JSON strings; handle both just in case.
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  const parsed = gameConfigSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/** Most recently generated config hashes (newest first, may contain duplicates). */
export async function listRecentDrafts(limit = 20): Promise<string[]> {
  const hashes = await redis().lrange<string>(DRAFTS_KEY, 0, Math.max(0, limit - 1));
  return [...new Set(hashes)];
}

/** Fixed-window rate limit. Returns true if the call is allowed. */
export async function rateLimit(id: string, max: number, windowSec: number): Promise<boolean> {
  const key = `rl:${id}`;
  const n = await redis().incr(key);
  if (n === 1) await redis().expire(key, windowSec);
  return n <= max;
}
