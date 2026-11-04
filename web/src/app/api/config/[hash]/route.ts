import { NextResponse } from "next/server";
import { getConfig, isHash } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  if (!isHash(hash)) return NextResponse.json({ error: "Invalid hash" }, { status: 400 });
  try {
    const config = await getConfig(hash);
    if (!config) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Content-addressed, so it's safe to cache forever.
    return NextResponse.json(config, { headers: { "Cache-Control": "public, max-age=31536000, immutable" } });
  } catch (e) {
    console.error("config fetch failed", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
