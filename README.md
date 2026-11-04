# Proof-of-Play

Prompt a game. Launch a coin. Every run pumps an unruggable floor. Built for Monad Blitz Mumbai.

**Live:** https://proof-of-play-wheat.vercel.app (Monad testnet) ·
**GameFactory:** [`0xc25e…e3eb`](https://testnet.monadexplorer.com/contracts/full_match/10143/0xc25e90f474f7c4f69ddfac66e4a91ff3f9e6e3eb/)

- Early tokens can only be mined by playing.
- Every paid play fills a vault that sets a floor price (`floor = vault ÷ supply`).
- Creators unlock their share only when real players show up.

## Layout

| Folder       | What                                             |
| ------------ | ------------------------------------------------ |
| `contracts/` | Solidity + Hardhat (viem toolbox), OpenZeppelin  |
| `web/`       | Next.js 15, Tailwind, wagmi + viem + RainbowKit  |

## Setup

```bash
cd contracts && npm install && cp .env.example .env
cd ../web && npm install && cp .env.example .env.local
```

Fill in the env files, then:

```bash
cd contracts && npx hardhat compile
cd ../web && npm run dev
```

Network: Monad testnet, chain id `10143`, RPC `https://testnet-rpc.monad.xyz`.
