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

/** spl-governance ProposalState enum. */
export const ProposalState = {
  Draft: 0,
  SigningOff: 1,
  Voting: 2,
  Cancelled: 3,
  Defeated: 4,
  Succeeded: 5,
  Executing: 6,
  Completed: 7,
  Vetoed: 8,
} as const;

export function isTerminalState(state: number): boolean {
  return state >= ProposalState.Cancelled; // 3..8 are final
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
