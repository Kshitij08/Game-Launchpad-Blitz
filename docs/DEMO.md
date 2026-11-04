# Proof-of-Play: 3-minute demo

Live app: https://proof-of-play-wheat.vercel.app (Monad testnet)

**Before you go on stage**

- MetaMask on Monad testnet (chain `10143`, RPC `https://testnet-rpc.monad.xyz`) with at least 1 testnet MON.
- Open these tabs: home, game #1 **Orbit Hopper** (mining open), game #2 **Jungle Dash** (trading open), and `/create`.
- Have a backup video ready and a pre-generated game open in another tab (see Fallbacks).

---

## 0:00 to 0:15: Hook

**Say:** "Pump.fun, but you can't snipe it. You have to outplay everyone."

"Proof-of-Play: prompt a game, launch a coin, and every run pumps a floor that can't be rugged."

## 0:15 to 1:05: Create a game

1. **Click** *Create*. **Type** the prompt: `a frog dodging red candles and catching green ones`. **Click** *Generate game* (about 20 s).
2. **While Claude works (~20 s), explain the floor:**
   "Every game gets its own vault. Each run costs 0.02 MON, and 70% goes into the vault. The floor is just the vault divided by the supply. Runs mint at most what they deposit, buys pay at least the floor plus 10%, and redeems pay an exact share. So the floor can only go up. There are no free dev coins. The creator earns MON from an escrow that unlocks at 3, 10, 25 and 50 unique players."
3. When the game appears: **play it for free once** (test play, no wallet). Point out the combo counter, a near miss and the REKT screen.
4. **Open** *Make it yours*: show uploading a sprite, a sound and particles. "Creators can make it their own."
5. **Click** *Launch* and confirm **one transaction**. "One tx deploys the token, the vault, the session manager and the bonding curve."

## 1:05 to 1:45: Play to mine (game #1 Orbit Hopper)

1. **Switch** to the Orbit Hopper tab (mining open). **Click** *Play · 0.02 MON* and confirm.
2. **Play** one run. Aim for 40+ points to get the full share. Score 0 still gets 25%.
3. When the run ends, the score is signed automatically: **confirm** the claim transaction in the wallet.
4. **Point at** the floor price ticking up and the **degen feed** showing your run. "Every number here comes from chain events. Better players mine more. Bots and snipers can't skip the game."
5. Optional: **click** *Share to X*.

## 1:45 to 2:25: Trading (game #2 Jungle Dash)

1. **Switch** to Jungle Dash (mining closed, trading open). "Mining closes at 10,000 coins or 300 runs. Then the curve opens."
2. **Buy** a small amount. "The price is never below floor plus 10%, and the whole payment goes into the vault." **Point at** the floor going up.
3. **Redeem** a few coins. "Redeems pay an exact share of the vault, so the floor doesn't change. Holders always have a way out."

## 2:25 to 2:45: Creator and remix

1. **Show** the **creator escrow** panel: MON earned, the 3/10/25/50 unique-player milestones, and what's unlocked. "Creators get paid when real players show up, not when they dump."
2. **Click** *Remix this game with a new prompt*. "Anyone can fork a game. 10% of every remix run goes into the parent's vault."

## 2:45 to 3:00: Close

**Say:** "ORE made mining a lottery. We made it a skill game."

"Why Monad: every run is two transactions, start and end, plus a claim. That only works with fast blocks and cheap gas. On Monad a game session feels like a game, not a checkout."

---

## Fallbacks

| Problem | Do this |
| --- | --- |
| Wi-Fi or app is down | Play the **backup video** and narrate over it. |
| Claude generation is slow (>30 s) | Switch to a **pre-generated game** in the other tab and keep going with *Make it yours* and *Launch*. |
| Out of MON | Monad testnet faucet: top up before the demo. Keep a second funded wallet. |
| Wrong network in MetaMask | Add Monad testnet: chain id `10143`, RPC `https://testnet-rpc.monad.xyz`, symbol `MON`. |
| Feed or floor looks stale | From `web/`, run `GAME=1 npx tsx scripts/play-once.ts` to push a fresh run. |
| Jungle Dash isn't in trading yet | From `web/`, run `GAME=2 npx tsx scripts/open-trading.ts` before the demo. |
