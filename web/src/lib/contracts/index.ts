import deployment from "./deployment.10143.json";
import {
  gameFactoryAbi,
  gameTokenAbi,
  treasuryVaultAbi,
  sessionManagerAbi,
  bondingCurveAbi,
} from "./abis";

export { gameFactoryAbi, gameTokenAbi, treasuryVaultAbi, sessionManagerAbi, bondingCurveAbi };

export const GAME_FACTORY = deployment.gameFactory as `0x${string}`;
export const FACTORY_DEPLOY_BLOCK = BigInt(deployment.deployBlock);

/** EIP-712 typed data the score signer signs; must match SessionManager.SESSION_TYPEHASH. */
export const sessionResultTypes = {
  SessionResult: [
    { name: "player", type: "address" },
    { name: "sessionId", type: "uint256" },
    { name: "score", type: "uint256" },
  ],
} as const;

export function sessionDomain(sessionsAddress: `0x${string}`, chainId: number) {
  return { name: "ProofOfPlay", version: "1", chainId, verifyingContract: sessionsAddress } as const;
}
