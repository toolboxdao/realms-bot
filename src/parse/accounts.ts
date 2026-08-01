/**
 * Borsh decoders for the spl-governance account layouts used by ToolboxDAO:
 * RealmV2 (16), GovernanceV2 (18), ProposalV2 (14).
 *
 * Layouts are derived from `@solana/spl-governance` serialisation.js schema and
 * validated against real mainnet-clone data in tests/fixtures.
 */
import { BorshReader } from '../borsh/reader';
import { AccountType } from '../config';

export interface VoteThreshold {
  type: number;
  value: number | null;
}

function readVoteThreshold(r: BorshReader): VoteThreshold {
  const type = r.u8();
  // YesVotePercentage(0) / QuorumPercentage(1) carry a u8 value; Disabled(2) does not.
  if (type === 0 || type === 1) return { type, value: r.u8() };
  return { type, value: null };
}

export interface DecodedRealm {
  accountType: number;
  communityMint: Uint8Array;
  useCommunityVoterWeightAddin: number;
  useMaxCommunityVoterWeightAddin: number;
  minCommunityTokensToCreateGovernance: bigint;
  maxVoteWeightSource: { type: number; value: bigint };
  councilMint: Uint8Array | null;
  votingProposalCount: number;
  authority: Uint8Array | null;
  name: string;
}

export function decodeRealmV2(buf: Uint8Array): DecodedRealm {
  const r = new BorshReader(buf);
  const accountType = r.u8();
  if (accountType !== AccountType.RealmV2) {
    throw new Error(`Expected RealmV2 (16), got ${accountType}`);
  }
  const communityMint = r.pubkey();
  const useCommunityVoterWeightAddin = r.u8();
  const useMaxCommunityVoterWeightAddin = r.u8();
  r.bytes(6); // reserved
  const minCommunityTokensToCreateGovernance = r.u64();
  const maxVoteWeightSource = { type: r.u8(), value: r.u64() };
  const councilMint = r.pubkeyOption();
  r.bytes(6); // reserved
  const votingProposalCount = r.u16();
  const authority = r.pubkeyOption();
  const name = r.string();
  return {
    accountType,
    communityMint,
    useCommunityVoterWeightAddin,
    useMaxCommunityVoterWeightAddin,
    minCommunityTokensToCreateGovernance,
    maxVoteWeightSource,
    councilMint,
    votingProposalCount,
    authority,
    name,
  };
}

export interface DecodedGovernance {
  accountType: number;
  realm: Uint8Array;
  governedAccount: Uint8Array;
  proposalCount: number;
  config: {
    communityVoteThreshold: VoteThreshold;
    baseVotingTime: number;
    communityVoteTipping: number;
    councilVoteTipping: number;
    communityVetoVoteThreshold: VoteThreshold;
    votingCoolOffTime: number;
  };
  activeProposalCount: bigint;
}

export function decodeGovernanceV2(buf: Uint8Array): DecodedGovernance {
  const r = new BorshReader(buf);
  const accountType = r.u8();
  if (accountType !== AccountType.GovernanceV2) {
    throw new Error(`Expected GovernanceV2 (18), got ${accountType}`);
  }
  const realm = r.pubkey();
  const governedAccount = r.pubkey();
  const proposalCount = r.u32();
  const communityVoteThreshold = readVoteThreshold(r);
  r.u64(); // minCommunityTokensToCreateProposal
  r.u32(); // minInstructionHoldUpTime
  const baseVotingTime = r.u32();
  const communityVoteTipping = r.u8();
  readVoteThreshold(r); // councilVoteThreshold (discard)
  const councilVetoVoteThreshold = readVoteThreshold(r);
  r.u64(); // minCouncilTokensToCreateProposal
  const councilVoteTipping = r.u8();
  const communityVetoVoteThreshold = readVoteThreshold(r);
  const votingCoolOffTime = r.u32();
  r.u8(); // depositExemptProposalCount
  r.bytes(120); // reserved
  const activeProposalCount = r.u64();
  return {
    accountType,
    realm,
    governedAccount,
    proposalCount,
    config: {
      communityVoteThreshold,
      baseVotingTime,
      communityVoteTipping,
      councilVoteTipping,
      communityVetoVoteThreshold,
      votingCoolOffTime,
    },
    activeProposalCount,
  };
}

export interface ProposalOptionData {
  label: string;
  voteWeight: bigint;
  voteResult: number;
}

export interface VoteTypeData {
  kind: number; // 0 = SingleChoice, 1 = MultiChoice
  choiceType?: number;
  minVoterOptions?: number;
  maxVoterOptions?: number;
  maxWinningOptions?: number;
}

export interface DecodedProposal {
  accountType: number;
  governance: Uint8Array;
  governingTokenMint: Uint8Array;
  state: number;
  tokenOwnerRecord: Uint8Array;
  voteType: VoteTypeData;
  options: ProposalOptionData[];
  denyVoteWeight: bigint | null;
  abstainVoteWeight: bigint | null;
  draftAt: bigint;
  signingOffAt: bigint | null;
  votingAt: bigint | null;
  votingCompletedAt: bigint | null;
  executingAt: bigint | null;
  closedAt: bigint | null;
  maxVoteWeight: bigint | null;
  maxVotingTime: number | null;
  voteThreshold: VoteThreshold | null;
  name: string;
  descriptionLink: string;
  vetoVoteWeight: bigint;
}

export function decodeProposalV2(buf: Uint8Array): DecodedProposal {
  const r = new BorshReader(buf);
  const accountType = r.u8();
  if (accountType !== AccountType.ProposalV2) {
    throw new Error(`Expected ProposalV2 (14), got ${accountType}`);
  }
  const governance = r.pubkey();
  const governingTokenMint = r.pubkey();
  const state = r.u8();
  const tokenOwnerRecord = r.pubkey();
  r.u8(); // signatoriesCount
  r.u8(); // signatoriesSignedOffCount

  // voteType (custom reader)
  const voteKind = r.u8();
  const voteType: VoteTypeData = { kind: voteKind };
  if (voteKind === 1) {
    voteType.choiceType = r.u8();
    voteType.minVoterOptions = r.u8();
    voteType.maxVoterOptions = r.u8();
    voteType.maxWinningOptions = r.u8();
  }

  // options: vec<ProposalOption>
  const options: ProposalOptionData[] = r.vec(() => {
    const label = r.string();
    const voteWeight = r.u64();
    const voteResult = r.u8();
    r.u16(); // instructionsExecutedCount
    r.u16(); // instructionsCount
    r.u16(); // instructionsNextIndex
    return { label, voteWeight, voteResult };
  });

  const denyVoteWeight = r.u64Option();
  r.u8(); // reserved1
  const abstainVoteWeight = r.u64Option();
  r.u64Option(); // startVotingAt
  const draftAt = r.u64();
  const signingOffAt = r.u64Option();
  const votingAt = r.u64Option();
  r.u64Option(); // votingAtSlot
  const votingCompletedAt = r.u64Option();
  const executingAt = r.u64Option();
  const closedAt = r.u64Option();
  r.u8(); // executionFlags
  const maxVoteWeight = r.u64Option();
  const maxVotingTime = r.u32Option();
  const voteThreshold = r.option(() => readVoteThreshold(r));
  r.bytes(64); // reserved
  const name = r.string();
  const descriptionLink = r.string();
  const vetoVoteWeight = r.u64();
  return {
    accountType,
    governance,
    governingTokenMint,
    state,
    tokenOwnerRecord,
    voteType,
    options,
    denyVoteWeight,
    abstainVoteWeight,
    draftAt,
    signingOffAt,
    votingAt,
    votingCompletedAt,
    executingAt,
    closedAt,
    maxVoteWeight,
    maxVotingTime,
    voteThreshold,
    name,
    descriptionLink,
    vetoVoteWeight,
  };
}
