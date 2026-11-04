import { expect } from "chai";
import hre from "hardhat";
import { parseEther, keccak256, toHex, getAddress, type Address } from "viem";

describe("Proof-of-Play happy path", () => {
  async function setup() {
    const [creator, signerWallet, alice, bob, carol] = await hre.viem.getWalletClients();
    const publicClient = await hre.viem.getPublicClient();
    const factory = await hre.viem.deployContract("GameFactory", [signerWallet.account.address]);

    await factory.write.createGame(["Neon Hopper", "HOP", keccak256(toHex("config")), 0n], { account: creator.account });
    const g = await factory.read.getGame([1n]);
    const token = await hre.viem.getContractAt("GameToken", g.token);
    const vault = await hre.viem.getContractAt("TreasuryVault", g.vault);
    const sessions = await hre.viem.getContractAt("SessionManager", g.sessions);
    const curve = await hre.viem.getContractAt("BondingCurve", g.curve);

    const chainId = await publicClient.getChainId();
    const sign = (player: Address, sessionId: bigint, score: bigint) =>
      signerWallet.signTypedData({
        account: signerWallet.account,
        domain: { name: "ProofOfPlay", version: "1", chainId, verifyingContract: g.sessions },
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

    return { factory, token, vault, sessions, curve, publicClient, creator, alice, bob, carol, sign };
  }

  it("play mines tokens, fills the vault, opens the curve, and redeems at the floor", async () => {
    const { token, vault, sessions, curve, publicClient, creator, alice, bob, carol, sign } = await setup();
    const fee = parseEther("0.02");
    const creatorBefore = await publicClient.getBalance({ address: creator.account.address });

    // Three players each play one session.
    const players = [alice, bob, carol];
    const scores = [5n, 12n, 30n];
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      await sessions.write.startSession({ account: p.account, value: fee });
      const id = BigInt(i + 1);
      const sig = await sign(p.account.address, id, scores[i]);
      await sessions.write.endSession([id, scores[i], sig], { account: p.account });
    }

    // Mining: 10 base + 1 per point.
    expect(await token.read.balanceOf([alice.account.address])).to.equal(parseEther("15"));
    expect(await token.read.balanceOf([carol.account.address])).to.equal(parseEther("40"));
    expect(await sessions.read.uniquePlayers()).to.equal(3n);
    expect(getAddress(await sessions.read.bestPlayer())).to.equal(getAddress(carol.account.address));

    // Fees: 70% vault, rest to creator (no parent).
    expect(await publicClient.getBalance({ address: vault.address })).to.equal(parseEther("0.042"));
    const creatorAfter = await publicClient.getBalance({ address: creator.account.address });
    expect(creatorAfter - creatorBefore).to.equal(parseEther("0.018"));

    // Curve is closed during mining.
    await expect(curve.write.buy([parseEther("1")], { account: alice.account, value: parseEther("1") })).to.be.rejected;

    // Creator unlocked 25% after 3 unique players.
    await sessions.write.claimCreator({ account: creator.account });
    expect(await token.read.balanceOf([creator.account.address])).to.equal(parseEther("250"));

    // Creator ends mining; buying never lowers the floor.
    await sessions.write.closeMining({ account: creator.account });
    const floorBefore = await vault.read.floorPrice();
    const amount = parseEther("100");
    const cost = await curve.read.quoteBuy([amount]);
    await curve.write.buy([amount], { account: bob.account, value: cost + parseEther("0.01") });
    const floorAfterBuy = await vault.read.floorPrice();
    expect(floorAfterBuy >= floorBefore).to.equal(true);

    // Redeem at the floor.
    const redeemAmt = parseEther("15");
    const expected = await vault.read.previewRedeem([redeemAmt]);
    const aliceBefore = await publicClient.getBalance({ address: alice.account.address });
    const hash = await vault.write.redeem([redeemAmt], { account: alice.account });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const gas = receipt.gasUsed * receipt.effectiveGasPrice;
    const aliceAfter = await publicClient.getBalance({ address: alice.account.address });
    expect(aliceAfter - aliceBefore + gas).to.equal(expected);
    expect(await token.read.balanceOf([alice.account.address])).to.equal(0n);
    // Floor is unchanged (up to rounding) after a redeem.
    const floorAfterRedeem = await vault.read.floorPrice();
    expect(floorAfterRedeem + 1n >= floorAfterBuy).to.equal(true);
  });

  it("rejects forged scores and double claims", async () => {
    const { sessions, alice, bob, sign } = await setup();
    await sessions.write.startSession({ account: alice.account, value: parseEther("0.02") });
    const forged = await sign(alice.account.address, 1n, 10n);
    await expect(sessions.write.endSession([1n, 999n, forged], { account: alice.account })).to.be.rejected;
    await expect(sessions.write.endSession([1n, 10n, forged], { account: bob.account })).to.be.rejected;
    await sessions.write.endSession([1n, 10n, forged], { account: alice.account });
    await expect(sessions.write.endSession([1n, 10n, forged], { account: alice.account })).to.be.rejected;
  });

  it("remixes send a share of fees to the parent vault", async () => {
    const { factory, vault, publicClient, bob } = await setup();
    await factory.write.createGame(["Neon Hopper 2", "HOP2", keccak256(toHex("remix")), 1n], { account: bob.account });
    const child = await factory.read.getGame([2n]);
    const childSessions = await hre.viem.getContractAt("SessionManager", child.sessions);
    const parentBefore = await publicClient.getBalance({ address: vault.address });
    await childSessions.write.startSession({ account: bob.account, value: parseEther("0.02") });
    const parentAfter = await publicClient.getBalance({ address: vault.address });
    expect(parentAfter - parentBefore).to.equal(parseEther("0.002"));
  });
});
