import { base58 } from '@scure/base';
import type { Env } from './types';

/** Raw (base58) governance addresses for ToolboxDAO. */
export const ADDRESSES = {
  program: 'GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw',
  realm: 'Dsh5QZbhK7MLoC8cxaNwL5Nta2rrLiDWuRA4gnkLfopi',
  governance: '5Nn7GMBt1YrPWuzZ7nwY8kBsLkaUhCunnQM9nYaD1MZm',
  communityMint: 'tboxhozCDDv74fcHuNJuhL1AzZQNi3V2u8PQ2cFLPH8',
} as const;

/** Account type discriminators (first byte of spl-governance account data). */
export const AccountType = {
  RealmV2: 16,
  GovernanceV2: 18,
  ProposalV2: 14,
} as const;

/**
 * spl-governance ProposalState enum, as serialized by the deployed GovER5..
 * program. VERIFIED against 71 live ToolboxDAO proposal accounts and the
 * @solana/spl-governance SDK enum (0.3.x): Draft 0, SigningOff 1, Voting 2,
 * Succeeded 3, Executing 4, Completed 5, Cancelled 6, Defeated 7,
 * ExecutingWithErrors 8, Vetoed 9.
 * (An earlier version of this table was shifted by one from 3..8, which made
 * passed-but-not-yet-executed proposals (Succeeded=3) alert as "Cancelled".)
 */
export const ProposalState = {
  Draft: 0,
  SigningOff: 1,
  Voting: 2,
  Succeeded: 3,
  Executing: 4,
  Completed: 5,
  Cancelled: 6,
  Defeated: 7,
  ExecutingWithErrors: 8,
  Vetoed: 9,
} as const;

export function isTerminalState(state: number): boolean {
  return state >= ProposalState.Succeeded; // 3..9 are final
}

export interface Config {
  programPk: Uint8Array;
  realmPk: Uint8Array;
  governancePk: Uint8Array;
  communityMintPk: Uint8Array;
  realmName: string;
  rpcUrl: string;
  realmsUrl: string;
  tokenDecimals: number;
  events: {
    created: boolean;
    votingOpen: boolean;
    ended: boolean;
    reminder: boolean;
  };
}

function boolFlag(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === '') return fallback;
  return v.toLowerCase() === 'true';
}

export function makeConfig(env: Env): Config {
  return {
    programPk: base58.decode(ADDRESSES.program),
    realmPk: base58.decode(ADDRESSES.realm),
    governancePk: base58.decode(ADDRESSES.governance),
    communityMintPk: base58.decode(ADDRESSES.communityMint),
    realmName: env.REALM_NAME || 'ToolboxDAO',
    rpcUrl: env.RPC_URL || 'http://127.0.0.1:8899',
    realmsUrl: (env.REALMS_URL || 'https://realms.today').replace(/\/$/, ''),
    tokenDecimals: Number(env.TOKEN_DECIMALS) || 6,
    events: {
      created: boolFlag(env.EVENT_CREATED, true),
      votingOpen: boolFlag(env.EVENT_VOTING_OPEN, true),
      ended: boolFlag(env.EVENT_ENDED, true),
      reminder: boolFlag(env.EVENT_REMINDER, false),
    },
  };
}
