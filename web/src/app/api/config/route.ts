import { NextResponse } from "next/server";
import { gameConfigSchema } from "@/lib/game-config";
import { saveConfig } from "@/lib/store";

export const runtime = "nodejs";

/** Saves a creator-edited config (e.g. after uploading custom assets). Returns its hash. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = gameConfigSchema.safeParse(body?.config);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid game config", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
  }
  try {
    const { hash } = await saveConfig(parsed.data);
    return NextResponse.json({ hash, config: parsed.data });
  } catch (e) {
    console.error("save config failed", e);
    return NextResponse.json({ error: "Couldn't save the game. Try again." }, { status: 500 });
  }
}
