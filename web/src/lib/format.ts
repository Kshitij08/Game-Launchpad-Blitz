import { formatEther } from "viem";

/** Formats a wei amount as MON with sensible precision for small values. */
export function mon(wei: bigint | undefined, digits = 4): string {
  if (wei === undefined) return "…";
  const n = Number(formatEther(wei));
  if (n === 0) return "0";
  if (n < 0.0001) return n.toExponential(2);
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

/** Formats an 18-decimal token amount. */
export function tokens(units: bigint | undefined, digits = 2): string {
  if (units === undefined) return "…";
  return Number(formatEther(units)).toLocaleString(undefined, { maximumFractionDigits: digits });
}
