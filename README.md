# Proof-of-Play

Prompt a game, launch its token, and let play back its value. Built for Monad Blitz Mumbai.

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
