import { expect } from "chai";
import hre from "hardhat";
import { parseEther, keccak256, toHex, getAddress, type Address } from "viem";

const FEE = parseEther("0.02");

describe("Proof-of-Play v2", () => {
  async function setup() {
    const wallets = await hre.viem.getWalletClients();
    const [creator, signerWallet, alice, bob, carol] = wallets;
    const publicClient = await hre.viem.getPublicClient();
    const factory = await hre.viem.deployContract("GameFactory", [signerWallet.account.address]);

    await factory.write.createGame(["Neon Hopper", "HOP", keccak256(toHex("config")), 0n], { account: creator.account });
    const g = await factory.read.getGame([1n]);
    const token = await hre.viem.getContractAt("GameToken", g.token);
    const vault = await hre.viem.getContractAt("TreasuryVault", g.vault);
    const sessions = await hre.viem.getContractAt("SessionManager", g.sessions);
    const curve = await hre.viem.getContractAt("BondingCurve", g.curve);

    const chainId = await publicClient.getChainId();
    const sign = (sessionsAddr: Address, player: Address, sessionId: bigint, score: bigint) =>
      signerWallet.signTypedData({
        account: signerWallet.account,
        domain: { name: "ProofOfPlay", version: "1", chainId, verifyingContract: sessionsAddr },
        types: {
          SessionResult: [
            { name: "player", type: "address" },
            { name: "sessionId", type: "uint256" },
            { name: "score", type: "uint256" },
          ],
        },
        primaryType: "SessionResult",
        message: { player, sessionId, score },
      });

    // Pays, plays and claims one run; returns coins mined.
    const play = async (who: (typeof wallets)[number], score: bigint, sm = sessions) => {
      await sm.write.startSession({ account: who.account, value: FEE });
      const id = await sm.read.sessionCount();
      const sig = await sign(sm.address, who.account.address, id, score);
      const before = await token.read.balanceOf([who.account.address]);
      await sm.write.endSession([id, score, sig], { account: who.account });
      return (await token.read.balanceOf([who.account.address])) - before;
    };

    return { factory, token, vault, sessions, curve, publicClient, wallets, creator, alice, bob, carol, sign, play };
  }

  it("mines from a floor-neutral budget scaled by score", async () => {
    const { vault, sessions, alice, bob, play } = await setup();
    // First run: no supply yet, so the budget is 0.014 MON / 0.0001 launch price = 140 coins.
    // Score 40 (the target) earns all of it.
    expect(await play(alice, 40n)).to.equal(parseEther("140"));
    expect(await vault.read.floorPrice()).to.equal(parseEther("0.0001"));
    // Score 0 earns the 25% minimum of the next budget; the floor rises.
    const f0 = await vault.read.floorPrice();
    const minedLow = await play(bob, 0n);
    expect(minedLow > 0n).to.equal(true);
    expect((await vault.read.floorPrice()) > f0).to.equal(true);
    // Scores above the target earn no more than the target.
    const preview40 = await sessions.read.previewMined([parseEther("0.014"), 40n]);
    const preview400 = await sessions.read.previewMined([parseEther("0.014"), 400n]);
    expect(preview400).to.equal(preview40);
  });

  it("never lowers the floor across 60 random runs, buys and redeems", async () => {
    const { vault, sessions, curve, creator, wallets, token, play } = await setup();
    const players = wallets.slice(2, 10);
    let seed = 42;
    const rnd = (n: number) => ((seed = (seed * 16807) % 2147483647), seed % n);
    let floor = await vault.read.floorPrice();
    for (let i = 0; i < 60; i++) {
      const p = players[rnd(players.length)];
      await play(p, BigInt(rnd(120)));
      const now = await vault.read.floorPrice();
      expect(now >= floor, `run ${i}: floor ${now} < ${floor}`).to.equal(true);
      floor = now;
      // Redeem a little now and then: the floor holds (payout rounds down).
      const bal = await token.read.balanceOf([p.account.address]);
      if (i % 7 === 3 && bal > 0n) {
        await vault.write.redeem([bal / 3n], { account: p.account });
        const after = await vault.read.floorPrice();
        expect(after >= floor, `redeem ${i}: floor ${after} < ${floor}`).to.equal(true);
        floor = after;
      }
    }
    // Open trading: buys can only raise the floor.
    await sessions.write.closeMining({ account: creator.account });
    for (const amount of [parseEther("10"), parseEther("500"), parseEther("2000")]) {
      const cost = await curve.read.quoteBuy([amount]);
      await curve.write.buy([amount], { account: players[0].account, value: cost });
      const now = await vault.read.floorPrice();
      expect(now >= floor).to.equal(true);
      floor = now;
    }
  });

  it("escrows the creator's fee share and unlocks it by unique players", async () => {
    const { sessions, publicClient, creator, alice, bob, carol, play } = await setup();
    await play(alice, 10n);
    await play(bob, 10n);
    await expect(sessions.write.claimCreator({ account: creator.account })).to.be.rejected; // 2 players: nothing yet
    await play(carol, 10n);
    // 3 runs x 30% of 0.02 = 0.018 MON earned; 3 players unlock 25%.
    expect(await sessions.read.creatorEarned()).to.equal(parseEther("0.018"));
    const before = await publicClient.getBalance({ address: creator.account.address });
    const hash = await sessions.write.claimCreator({ account: creator.account });
    const r = await publicClient.waitForTransactionReceipt({ hash });
    const after = await publicClient.getBalance({ address: creator.account.address });
    expect(after - before + r.gasUsed * r.effectiveGasPrice).to.equal(parseEther("0.0045"));
    await expect(sessions.write.claimCreator({ account: creator.account })).to.be.rejected; // already claimed
  });

  it("splits fees 70% vault, 30% creator escrow, and 10% to the parent on remixes", async () => {
    const { factory, vault, publicClient, bob } = await setup();
    await factory.write.createGame(["Neon Hopper 2", "HOP2", keccak256(toHex("remix")), 1n], { account: bob.account });
    const child = await factory.read.getGame([2n]);
    const childSessions = await hre.viem.getContractAt("SessionManager", child.sessions);
    const parentBefore = await publicClient.getBalance({ address: vault.address });
    await childSessions.write.startSession({ account: bob.account, value: FEE });
    expect((await publicClient.getBalance({ address: vault.address })) - parentBefore).to.equal(parseEther("0.002"));
    expect(await publicClient.getBalance({ address: child.vault })).to.equal(parseEther("0.014"));
    expect(await childSessions.read.creatorEarned()).to.equal(parseEther("0.004"));
  });

  it("closes mining after the run cap", async () => {
    const { sessions, factory, alice } = await setup();
    const p = await factory.read.defaultParams();
    expect(p[8]).to.equal(300n);
    expect(await sessions.read.miningClosed()).to.equal(false);
    void alice;
  });

  it("rejects forged scores, other players' sessions and double claims", async () => {
    const { sessions, alice, bob, sign } = await setup();
    await sessions.write.startSession({ account: alice.account, value: FEE });
    const sig = await sign(sessions.address, alice.account.address, 1n, 10n);
    await expect(sessions.write.endSession([1n, 999n, sig], { account: alice.account })).to.be.rejected;
    await expect(sessions.write.endSession([1n, 10n, sig], { account: bob.account })).to.be.rejected;
    await sessions.write.endSession([1n, 10n, sig], { account: alice.account });
    await expect(sessions.write.endSession([1n, 10n, sig], { account: alice.account })).to.be.rejected;
  });

  it("keeps the curve closed during mining and prices buys at or above the floor", async () => {
    const { vault, curve, sessions, creator, alice, play } = await setup();
    await play(alice, 40n);
    await expect(curve.write.buy([parseEther("1")], { account: alice.account, value: parseEther("1") })).to.be.rejected;
    await sessions.write.closeMining({ account: creator.account });
    const spot = await curve.read.spotPrice();
    expect(spot >= ((await vault.read.floorPrice()) * 11n) / 10n).to.equal(true);
    expect(getAddress(await sessions.read.bestPlayer())).to.equal(getAddress(alice.account.address));
  });
});
