import { NextResponse } from "next/server";
import { saveAsset, AssetError } from "@/lib/assets";
import { rateLimit } from "@/lib/store";

export const runtime = "nodejs";

/** POST multipart/form-data with a `file` field -> { ref: "asset:0x…", id, type, size } */
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  try {
    if (!(await rateLimit(`asset:${ip}`, 40, 60))) {
      return NextResponse.json({ error: "Too many uploads. Wait a minute and try again." }, { status: 429 });
    }
  } catch {
    // Rate limiter down: allow the upload.
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") return NextResponse.json({ error: "Attach a file in the `file` field." }, { status: 400 });

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const saved = await saveAsset(bytes, file.type || guessType(file.name));
    return NextResponse.json({ ref: `asset:${saved.id}`, ...saved });
  } catch (e) {
    if (e instanceof AssetError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("asset upload failed", e);
    return NextResponse.json({ error: "Upload failed. Try again." }, { status: 500 });
  }
}

function guessType(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
    mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac", webm: "audio/webm",
  };
  return map[ext ?? ""] ?? "application/octet-stream";
}
