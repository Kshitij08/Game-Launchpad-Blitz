import { NextResponse } from "next/server";
import { createPublicClient, http, getAddress, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { monadTestnet } from "@/lib/chain";
import {
  GAME_FACTORY,
  gameFactoryAbi,
  sessionManagerAbi,
  sessionDomain,
  sessionResultTypes,
} from "@/lib/contracts";

export const runtime = "nodejs";

const body = z.object({
  sessions: z.string().refine(isAddress),
  player: z.string().refine(isAddress),
  sessionId: z.coerce.bigint().positive(),
  score: z.coerce.bigint().nonnegative().max(1_000_000n),
});

const client = createPublicClient({ chain: monadTestnet, transport: http() });

/**
 * Signs a finished session's score so the player can call endSession.
 * Hackathon scope: we trust the score the game reports, but check the session
 * belongs to a registered game, is owned by this player, and is still open.
 */
export async function POST(req: Request) {
  const key = process.env.SCORE_SIGNER_PRIVATE_KEY as `0x${string}` | undefined;
  if (!key) return NextResponse.json({ error: "Score signer is not configured" }, { status: 500 });

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const sessions = getAddress(parsed.data.sessions);
  const player = getAddress(parsed.data.player);
  const { sessionId } = parsed.data;

  const gameId = await client.readContract({
    address: GAME_FACTORY,
    abi: gameFactoryAbi,
    functionName: "gameIdBySessions",
    args: [sessions],
  });
  if (gameId === 0n) return NextResponse.json({ error: "Unknown game" }, { status: 404 });

  const [sessionPlayer, startedAt, ended] = await client.readContract({
    address: sessions,
    abi: sessionManagerAbi,
    functionName: "sessions",
    args: [sessionId],
  });
  if (getAddress(sessionPlayer) !== player) return NextResponse.json({ error: "Not your session" }, { status: 403 });
  if (ended) return NextResponse.json({ error: "Session already ended" }, { status: 409 });

  // Plausibility cap: a score can't outrun the time since the session was paid for.
  // Generous enough for real play (combos, collectibles), but stops a forged 1,000,000.
  const elapsedSec = BigInt(Math.max(0, Math.floor(Date.now() / 1000) - Number(startedAt)));
  const maxScore = 30n + 8n * elapsedSec;
  const score = parsed.data.score > maxScore ? maxScore : parsed.data.score;

  const account = privateKeyToAccount(key);
  const signature = await account.signTypedData({
    domain: sessionDomain(sessions, monadTestnet.id),
    types: sessionResultTypes,
    primaryType: "SessionResult",
    message: { player, sessionId, score },
  });

  return NextResponse.json({ signature, score: score.toString(), sessionId: sessionId.toString() });
}
