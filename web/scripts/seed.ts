/**
 * Seeds the demo games and exercises the full flow on Monad testnet:
 * save config -> createGame -> players pay, play, get a signed score from the
 * running dev server's /api/sign-session, and claim mined tokens. On the last
 * game it also closes mining, buys from the curve, redeems and claims creator tokens.
 *
 * Run from web/:  npx tsx scripts/seed.ts   (dev server must be running; SIGN_URL to override)
 */
import fs from "fs";
import path from "path";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  parseEventLogs,
  type Account,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

function loadEnv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv(path.resolve(__dirname, "../.env.local"));
loadEnv(path.resolve(__dirname, "../../contracts/.env"));

const SIGN_URL = process.env.SIGN_URL ?? "http://localhost:3100/api/sign-session";

async function main() {
  const { monadTestnet } = await import("../src/lib/chain");
  const { GAME_FACTORY, gameFactoryAbi, sessionManagerAbi, bondingCurveAbi, treasuryVaultAbi } = await import("../src/lib/contracts");
  const { SAMPLE_CONFIGS } = await import("../src/lib/sample-configs");
  const { saveConfig } = await import("../src/lib/store");

  const pub = createPublicClient({ chain: monadTestnet, transport: http() });
  const deployer = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`);
  const wallet = (account: Account) => createWalletClient({ account, chain: monadTestnet, transport: http() });
  const wait = async (hash: `0x${string}`) => {
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`tx reverted ${hash}`);
    return r;
  };

  console.log(`Deployer ${deployer.address}: ${formatEther(await pub.getBalance({ address: deployer.address }))} MON`);

  // 1) Launch the three sample games.
  const tickers: Record<string, string> = { "orbit-hopper": "ORBIT", "jungle-dash": "JUNGL", "neon-rush": "NEON" };
  const games: { id: bigint; title: string; sessions: `0x${string}`; curve: `0x${string}`; vault: `0x${string}` }[] = [];
  for (const s of SAMPLE_CONFIGS) {
    const { hash } = await saveConfig(s.config);
    const tx = await wallet(deployer).writeContract({
      address: GAME_FACTORY,
      abi: gameFactoryAbi,
      functionName: "createGame",
      args: [s.config.title, tickers[s.id] ?? "GAME", hash as `0x${string}`, 0n],
    });
    const r = await wait(tx);
    const [ev] = parseEventLogs({ abi: gameFactoryAbi, logs: r.logs, eventName: "GameCreated" });
    games.push({ id: ev.args.id, title: s.config.title, sessions: ev.args.sessions, curve: ev.args.curve, vault: ev.args.vault });
    console.log(`Launched #${ev.args.id} ${s.config.title} (gas ${r.gasUsed})`);
  }

  // 2) Fresh player wallets, funded by the deployer.
  const players = Array.from({ length: 4 }, () => privateKeyToAccount(generatePrivateKey()));
  for (const p of players) {
    await wait(await wallet(deployer).sendTransaction({ to: p.address, value: parseEther("0.4") }));
  }
  console.log(`Funded ${players.length} players with 0.4 MON each`);

  // 3) Each player plays each game once or twice through the real signer API.
  const fee = parseEther("0.02");
  for (const g of games) {
    for (const [i, p] of players.entries()) {
      const runs = i % 2 === 0 ? 2 : 1;
      for (let k = 0; k < runs; k++) {
        const r1 = await wait(
          await wallet(p).writeContract({ address: g.sessions, abi: sessionManagerAbi, functionName: "startSession", value: fee }),
        );
        const [started] = parseEventLogs({ abi: sessionManagerAbi, logs: r1.logs, eventName: "SessionStarted" });
        const score = 5 + Math.floor(Math.random() * 40);
        const res = await fetch(SIGN_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessions: g.sessions, player: p.address, sessionId: started.args.sessionId.toString(), score }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(`sign-session ${res.status}: ${data.error}`);
        const r2 = await wait(
          await wallet(p).writeContract({
            address: g.sessions,
            abi: sessionManagerAbi,
            functionName: "endSession",
            args: [started.args.sessionId, BigInt(score), data.signature],
          }),
        );
        const [ended] = parseEventLogs({ abi: sessionManagerAbi, logs: r2.logs, eventName: "SessionEnded" });
        console.log(`  #${g.id} player ${i + 1} run ${k + 1}: score ${score}, mined ${formatEther(ended.args.mined)}`);
      }
    }
  }

  // 4) Creator unlock on every game (4 unique players => first milestone).
  for (const g of games) {
    await wait(await wallet(deployer).writeContract({ address: g.sessions, abi: sessionManagerAbi, functionName: "claimCreator" }));
  }
  console.log("Creator claimed the first 25% on each game");

  // 5) Last game: open trading, buy, redeem.
  const last = games[games.length - 1];
  await wait(await wallet(deployer).writeContract({ address: last.sessions, abi: sessionManagerAbi, functionName: "closeMining" }));
  const floor0 = await pub.readContract({ address: last.vault, abi: treasuryVaultAbi, functionName: "floorPrice" });
  const amount = parseEther("50");
  const cost = await pub.readContract({ address: last.curve, abi: bondingCurveAbi, functionName: "quoteBuy", args: [amount] });
  await wait(
    await wallet(players[1]).writeContract({ address: last.curve, abi: bondingCurveAbi, functionName: "buy", args: [amount], value: (cost * 101n) / 100n }),
  );
  const floor1 = await pub.readContract({ address: last.vault, abi: treasuryVaultAbi, functionName: "floorPrice" });
  await wait(
    await wallet(players[0]).writeContract({ address: last.vault, abi: treasuryVaultAbi, functionName: "redeem", args: [parseEther("5")] }),
  );
  const floor2 = await pub.readContract({ address: last.vault, abi: treasuryVaultAbi, functionName: "floorPrice" });
  console.log(
    `#${last.id}: floor ${formatEther(floor0)} -> after buy of 50 for ${formatEther(cost)} MON: ${formatEther(floor1)} -> after redeem of 5: ${formatEther(floor2)}`,
  );

  for (const g of games) {
    const v = await pub.getBalance({ address: g.vault });
    console.log(`#${g.id} ${g.title}: vault ${formatEther(v)} MON`);
  }
  console.log(`Deployer left: ${formatEther(await pub.getBalance({ address: deployer.address }))} MON`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
