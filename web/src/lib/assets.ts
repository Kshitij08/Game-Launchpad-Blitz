// Server-only: creator-uploaded sprites, particle textures and sounds.
import { keccak256 } from "viem";
import { redis, isHash } from "@/lib/store";
import { sanitizeSvg } from "@/lib/generate";

export const MAX_ASSET_BYTES = 600 * 1024; // keeps the base64 body under Upstash's 1 MB request limit

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];
export const AUDIO_TYPES = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave", "audio/ogg", "audio/webm", "audio/mp4", "audio/aac"];

const assetKey = (id: string) => `game:asset:${id.toLowerCase()}`;

type Stored = { type: string; b64: string };

export class AssetError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Validates and stores a file. Same bytes -> same id. */
export async function saveAsset(bytes: Uint8Array, contentType: string): Promise<{ id: `0x${string}`; type: string; size: number }> {
  let type = contentType.split(";")[0].trim().toLowerCase();
  if (type === "audio/mp3") type = "audio/mpeg";
  if (!IMAGE_TYPES.includes(type) && !AUDIO_TYPES.includes(type)) {
    throw new AssetError("Use PNG, JPG, GIF, WebP or SVG for images, and MP3, WAV, OGG or M4A for sounds.", 415);
  }
  if (type === "image/svg+xml") {
    const clean = sanitizeSvg(new TextDecoder().decode(bytes));
    bytes = new TextEncoder().encode(clean);
  }
  if (bytes.byteLength === 0) throw new AssetError("The file is empty.");
  if (bytes.byteLength > MAX_ASSET_BYTES) {
    throw new AssetError(`Files can be up to ${Math.round(MAX_ASSET_BYTES / 1024)} KB. Compress it or trim the sound and try again.`, 413);
  }
  const id = keccak256(bytes);
  const value: Stored = { type, b64: Buffer.from(bytes).toString("base64") };
  await redis().set(assetKey(id), JSON.stringify(value));
  return { id, type, size: bytes.byteLength };
}

export async function getAsset(id: string): Promise<{ type: string; bytes: Buffer } | null> {
  if (!isHash(id)) return null;
  const raw = await redis().get<unknown>(assetKey(id));
  if (raw == null) return null;
  const v = (typeof raw === "string" ? JSON.parse(raw) : raw) as Stored;
  return { type: v.type, bytes: Buffer.from(v.b64, "base64") };
}
