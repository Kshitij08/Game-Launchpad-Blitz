"use client";

import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { BaseError, type Abi, type TransactionReceipt } from "viem";
import { monadTestnet } from "@/lib/chain";

/** Sends a contract write on Monad testnet (switching network first if needed) and waits for the receipt. */
export function useTx() {
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient({ chainId: monadTestnet.id });

  return async function send(args: {
    address: `0x${string}`;
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
    value?: bigint;
  }): Promise<TransactionReceipt> {
    if (chainId !== monadTestnet.id) await switchChainAsync({ chainId: monadTestnet.id });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hash = await writeContractAsync({ ...(args as any), chainId: monadTestnet.id });
    const receipt = await client!.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("Transaction reverted");
    return receipt;
  };
}

/** Short, readable message from a wallet or contract error. */
export function errorText(e: unknown): string {
  if (e instanceof BaseError) {
    if (e.shortMessage?.toLowerCase().includes("user rejected")) return "You cancelled the transaction.";
    return e.shortMessage || e.message;
  }
  return e instanceof Error ? e.message : String(e);
}
