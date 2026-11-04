import { connectorsForWallets, getDefaultConfig } from "@rainbow-me/rainbowkit";
import { injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { monadTestnet } from "./chain";

const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID;
const transports = { [monadTestnet.id]: http() };

// With a WalletConnect project id we offer every wallet (incl. mobile QR).
// Without one, only browser wallets like MetaMask, so WalletConnect doesn't error.
export const wagmiConfig = projectId
  ? getDefaultConfig({ appName: "Proof-of-Play", projectId, chains: [monadTestnet], transports, ssr: true })
  : createConfig({
      chains: [monadTestnet],
      transports,
      ssr: true,
      connectors: connectorsForWallets([{ groupName: "Browser wallet", wallets: [injectedWallet] }], {
        appName: "Proof-of-Play",
        projectId: "unused",
      }),
    });
