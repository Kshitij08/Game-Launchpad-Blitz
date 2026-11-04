import { NextResponse } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { TEMPLATES } from "@/lib/game-config";
import { generateGameConfig, GenerationError } from "@/lib/generate";
import { getConfig, isHash, rateLimit, saveConfig } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  prompt: z.string().trim().min(3).max(400),
  template: z.enum(TEMPLATES).optional(),
  baseHash: z.string().refine(isHash, "must be a 0x-prefixed 32-byte hex hash").optional(),
});

const err = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "), 400);
    }
    body = parsed.data;
  } catch {
    return err("Body must be JSON", 400);
  }

  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] || req.headers.get("x-real-ip") || "local").trim();
  try {
    if (!(await rateLimit(`gen:${ip}`, 20, 60))) return err("Too many requests, slow down", 429);
  } catch (e) {
    console.error("rate limit check failed", e); // don't block generation on Redis hiccups
  }

  try {
    let base;
    if (body.baseHash) {
      base = await getConfig(body.baseHash);
      if (!base) return err("Base config not found", 404);
    }
    const t0 = Date.now();
    const config = await generateGameConfig(body.prompt, { template: body.template, base: base ?? undefined });
    const { hash } = await saveConfig(config);
    console.log(`[generate] ${config.template} "${config.title}" ${hash} in ${Date.now() - t0}ms`);
    return NextResponse.json({ config, hash });
  } catch (e) {
    if (e instanceof GenerationError) return err(e.message, e.status);
    if (e instanceof Anthropic.RateLimitError) return err("AI is busy, try again shortly", 503);
    if (e instanceof Anthropic.APIError) {
      console.error("anthropic error", e.status, e.message);
      return err("AI generation failed", 502);
    }
    console.error("generate failed", e);
    return err("Internal error", 500);
  }
}
