"use client";

import { useReadContract, useReadContracts } from "wagmi";
import { useQueries } from "@tanstack/react-query";
import {
  GAME_FACTORY,
  gameFactoryAbi,
  gameTokenAbi,
  sessionManagerAbi,
  treasuryVaultAbi,
} from "@/lib/contracts";
import type { GameConfig } from "@/lib/game-config";

const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
const getEthBalanceAbi = [
  {
    type: "function",
    name: "getEthBalance",
    stateMutability: "view",
    inputs: [{ name: "addr", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
] as const;

export type GameSummary = {
  id: bigint;
  creator: `0x${string}`;
  token: `0x${string}`;
  vault: `0x${string}`;
  sessions: `0x${string}`;
  curve: `0x${string}`;
  parentId: bigint;
  configHash: `0x${string}`;
  createdAt: bigint;
  name?: string;
  symbol?: string;
  config?: GameConfig;
  stats?: {
    vaultBalance: bigint;
    floorPrice: bigint;
    totalSupply: bigint;
    finishedSessions: bigint;
    uniquePlayers: bigint;
    miningClosed: boolean;
  };
};

/** Fetches a stored game config by its on-chain hash. */
export async function fetchConfig(hash: string): Promise<GameConfig | null> {
  const res = await fetch(`/api/config/${hash}`);
  if (!res.ok) return null;
  const data = await res.json();
  return (data?.config ?? data) as GameConfig;
}

const PER_GAME = 8;

export function useGames(limit = 48) {
  const list = useReadContract({
    address: GAME_FACTORY,
    abi: gameFactoryAbi,
    functionName: "listGames",
    args: [0n, BigInt(limit)],
    query: { refetchInterval: 10_000 },
  });
  const games = (list.data ?? []) as readonly Omit<GameSummary, "stats" | "config" | "name" | "symbol">[];

  const stats = useReadContracts({
    allowFailure: true,
    contracts: games.flatMap((g) => [
      { address: g.token, abi: gameTokenAbi, functionName: "name" },
      { address: g.token, abi: gameTokenAbi, functionName: "symbol" },
      { address: g.token, abi: gameTokenAbi, functionName: "totalSupply" },
      { address: g.vault, abi: treasuryVaultAbi, functionName: "floorPrice" },
      { address: MULTICALL3, abi: getEthBalanceAbi, functionName: "getEthBalance", args: [g.vault] },
      { address: g.sessions, abi: sessionManagerAbi, functionName: "finishedSessions" },
      { address: g.sessions, abi: sessionManagerAbi, functionName: "uniquePlayers" },
      { address: g.sessions, abi: sessionManagerAbi, functionName: "miningClosed" },
    ]),
    query: { enabled: games.length > 0, refetchInterval: 10_000 },
  });

  const configs = useQueries({
    queries: games.map((g) => ({
      queryKey: ["config", g.configHash],
      queryFn: () => fetchConfig(g.configHash),
      staleTime: Infinity,
    })),
  });

  const data: GameSummary[] = games.map((g, i) => {
    const r = stats.data?.slice(i * PER_GAME, (i + 1) * PER_GAME);
    const v = (k: number) => r?.[k]?.result;
    return {
      ...g,
      name: v(0) as string | undefined,
      symbol: v(1) as string | undefined,
      config: configs[i]?.data ?? undefined,
      stats: r
        ? {
            totalSupply: (v(2) as bigint) ?? 0n,
            floorPrice: (v(3) as bigint) ?? 0n,
            vaultBalance: (v(4) as bigint) ?? 0n,
            finishedSessions: (v(5) as bigint) ?? 0n,
            uniquePlayers: (v(6) as bigint) ?? 0n,
            miningClosed: Boolean(v(7)),
          }
        : undefined,
    };
  });

  return { games: data, isLoading: list.isLoading, error: list.error };
}
