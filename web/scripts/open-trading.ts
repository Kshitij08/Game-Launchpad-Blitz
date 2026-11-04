/**
 * Demo helper: as the creator (deployer), closes mining on a game, buys some
 * coins and redeems a few, printing the floor at each step.
 * Run from web/:  GAME=2 npx tsx scripts/open-trading.ts
 */
import fs from "fs";
import path from "path";
import { createPublicClient, createWalletClient, http, parseEther, formatEther } from "viem";
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
  const { GAME_FACTORY, gameFactoryAbi, sessionManagerAbi, bondingCurveAbi, treasuryVaultAbi } = await import("../src/lib/contracts");
  const pub = createPublicClient({ chain: monadTestnet, transport: http() });
  const me = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`);
  const w = createWalletClient({ account: me, chain: monadTestnet, transport: http() });
  const wait = (hash: `0x${string}`) => pub.waitForTransactionReceipt({ hash, timeout: 180_000, pollingInterval: 1_000 });
  const g = await pub.readContract({ address: GAME_FACTORY, abi: gameFactoryAbi, functionName: "getGame", args: [BigInt(process.env.GAME ?? "2")] });
  const floor = async () => formatEther(await pub.readContract({ address: g.vault, abi: treasuryVaultAbi, functionName: "floorPrice" }));

  if (!(await pub.readContract({ address: g.sessions, abi: sessionManagerAbi, functionName: "miningClosed" }))) {
    await wait(await w.writeContract({ address: g.sessions, abi: sessionManagerAbi, functionName: "closeMining" }));
  }
  const f0 = await floor();
  const amount = parseEther(process.env.BUY ?? "100");
  const cost = await pub.readContract({ address: g.curve, abi: bondingCurveAbi, functionName: "quoteBuy", args: [amount] });
  await wait(await w.writeContract({ address: g.curve, abi: bondingCurveAbi, functionName: "buy", args: [amount], value: cost }));
  const f1 = await floor();
  await wait(await w.writeContract({ address: g.vault, abi: treasuryVaultAbi, functionName: "redeem", args: [parseEther("10")] }));
  const f2 = await floor();
  console.log(`floor ${f0} -> buy ${formatEther(amount)} for ${formatEther(cost)} MON -> ${f1} -> redeem 10 -> ${f2}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
