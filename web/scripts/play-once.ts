/**
 * Plays one paid session on a game as the deployer (handy for demos and for
 * checking the live feed). Run from web/:  GAME=5 npx tsx scripts/play-once.ts
 */
import fs from "fs";
import path from "path";
import { createPublicClient, createWalletClient, http, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";

for (const f of ["../.env.local", "../../contracts/.env"]) {
  const file = path.resolve(__dirname, f);
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

async function main() {
  const { monadTestnet } = await import("../src/lib/chain");
  const { GAME_FACTORY, gameFactoryAbi, sessionManagerAbi } = await import("../src/lib/contracts");
  const id = BigInt(process.env.GAME ?? "1");
  const score = Number(process.env.SCORE ?? 20 + Math.floor(Math.random() * 25));
  const pub = createPublicClient({ chain: monadTestnet, transport: http() });
  const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`);
  const wallet = createWalletClient({ account, chain: monadTestnet, transport: http() });

  const g = await pub.readContract({ address: GAME_FACTORY, abi: gameFactoryAbi, functionName: "getGame", args: [id] });
  const params = await pub.readContract({ address: g.sessions, abi: sessionManagerAbi, functionName: "params" });
  const r1 = await pub.waitForTransactionReceipt({
    hash: await wallet.writeContract({ address: g.sessions, abi: sessionManagerAbi, functionName: "startSession", value: params[0] }),
  });
  const [started] = parseEventLogs({ abi: sessionManagerAbi, logs: r1.logs, eventName: "SessionStarted" });
  const res = await fetch(process.env.SIGN_URL ?? "http://localhost:3100/api/sign-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessions: g.sessions, player: account.address, sessionId: started.args.sessionId.toString(), score }),
  });
  const { signature, error, score: signed } = await res.json();
  if (!signature) throw new Error(error);
  await pub.waitForTransactionReceipt({
    hash: await wallet.writeContract({ address: g.sessions, abi: sessionManagerAbi, functionName: "endSession", args: [started.args.sessionId, BigInt(signed), signature] }),
  });
  console.log(`Played game #${id}: session ${started.args.sessionId}, score ${signed} (asked ${score})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
