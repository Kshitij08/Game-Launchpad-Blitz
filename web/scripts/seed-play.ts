/**
 * Plays existing games with fresh funded wallets (history for demos), then on
 * the last game closes mining, buys and redeems, and claims the creator escrow.
 * Run from web/:  GAMES=1,2,3,4,5 npx tsx scripts/seed-play.ts   (dev server running for signing)
 */
import fs from "fs";
import path from "path";
import { createPublicClient, createWalletClient, http, parseEther, formatEther, parseEventLogs, type Account } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

for (const f of ["../.env.local", "../../contracts/.env"]) {
  const file = path.resolve(__dirname, f);
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const SIGN_URL = process.env.SIGN_URL ?? "http://localhost:3100/api/sign-session";

async function main() {
  const { monadTestnet } = await import("../src/lib/chain");
  const { GAME_FACTORY, gameFactoryAbi, sessionManagerAbi, bondingCurveAbi, treasuryVaultAbi } = await import("../src/lib/contracts");
  const pub = createPublicClient({ chain: monadTestnet, transport: http() });
  const deployer = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`);
  const wallet = (a: Account) => createWalletClient({ account: a, chain: monadTestnet, transport: http() });
  const wait = async (hash: `0x${string}`) => {
    const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000, pollingInterval: 1_000 });
    if (r.status !== "success") throw new Error(`reverted ${hash}`);
    return r;
  };

  const ids = (process.env.GAMES ?? "1,2,3,4,5").split(",").map((x) => BigInt(x.trim()));
  const games = [];
  for (const id of ids) games.push({ ...(await pub.readContract({ address: GAME_FACTORY, abi: gameFactoryAbi, functionName: "getGame", args: [id] })), id });

  const players = Array.from({ length: 4 }, () => privateKeyToAccount(generatePrivateKey()));
  for (const p of players) await wait(await wallet(deployer).sendTransaction({ to: p.address, value: parseEther("0.4") }));
  console.log(`Funded ${players.length} players`);

  const fee = parseEther("0.02");
  for (const g of games) {
    const floors: string[] = [];
    for (const [i, p] of players.entries()) {
      for (let k = 0; k < (i % 2 === 0 ? 2 : 1); k++) {
        const r1 = await wait(await wallet(p).writeContract({ address: g.sessions, abi: sessionManagerAbi, functionName: "startSession", value: fee }));
        const [st] = parseEventLogs({ abi: sessionManagerAbi, logs: r1.logs, eventName: "SessionStarted" });
        const ask = 5 + Math.floor(Math.random() * 50);
        const res = await fetch(SIGN_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessions: g.sessions, player: p.address, sessionId: st.args.sessionId.toString(), score: ask }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(`sign ${res.status}: ${data.error}`);
        await wait(await wallet(p).writeContract({ address: g.sessions, abi: sessionManagerAbi, functionName: "endSession", args: [st.args.sessionId, BigInt(data.score), data.signature] }));
        floors.push(Number(formatEther(await pub.readContract({ address: g.vault, abi: treasuryVaultAbi, functionName: "floorPrice" }))).toFixed(6));
      }
    }
    await wait(await wallet(deployer).writeContract({ address: g.sessions, abi: sessionManagerAbi, functionName: "claimCreator" }));
    console.log(`#${g.id}: 6 runs, floor after each: ${floors.join(" -> ")}; creator claimed`);
  }

  const last = games.at(-1)!;
  await wait(await wallet(deployer).writeContract({ address: last.sessions, abi: sessionManagerAbi, functionName: "closeMining" }));
  const f0 = await pub.readContract({ address: last.vault, abi: treasuryVaultAbi, functionName: "floorPrice" });
  const amt = parseEther("50");
  const cost = await pub.readContract({ address: last.curve, abi: bondingCurveAbi, functionName: "quoteBuy", args: [amt] });
  await wait(await wallet(players[1]).writeContract({ address: last.curve, abi: bondingCurveAbi, functionName: "buy", args: [amt], value: cost }));
  const f1 = await pub.readContract({ address: last.vault, abi: treasuryVaultAbi, functionName: "floorPrice" });
  await wait(await wallet(players[0]).writeContract({ address: last.vault, abi: treasuryVaultAbi, functionName: "redeem", args: [parseEther("5")] }));
  const f2 = await pub.readContract({ address: last.vault, abi: treasuryVaultAbi, functionName: "floorPrice" });
  console.log(`#${last.id}: floor ${formatEther(f0)} -> buy 50 for ${formatEther(cost)} MON -> ${formatEther(f1)} -> redeem 5 -> ${formatEther(f2)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
