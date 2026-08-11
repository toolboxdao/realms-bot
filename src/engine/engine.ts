/**
 * Pure transition-detection engine: given a proposal's previous snapshot and
 * its current on-chain state, decide which notifications (if any) to emit and
 * what the next snapshot should be.
 *
 * No I/O here — fully unit-testable.
 */
import { isTerminalState, ProposalState } from '../config';
import type { DecodedProposal } from '../parse/accounts';

export interface ProposalSnapshot {
  state: number;
  votingAt: number | null;
  votingCompletedAt: number | null;
  yes: string; // bigint as decimal string (base units)
  no: string;
  name: string;
  reminderSent: boolean;
}

/** Governance + realm context needed for quorum and reminder arithmetic. */
export interface GovernanceCtx {
  baseVotingTime: number;
  communityVoteThresholdPct: number | null;
  /** Realm-level max vote weight (Absolute source) fallback. */
  maxVoteWeight: bigint | null;
}

export type NotificationKind = 'created' | 'voting_open' | 'ended' | 'reminder';

export interface EndedDetail {
  status: string;
  yes: bigint;
  no: bigint;
  quorum: bigint | null;
  pct: number | null;
}

export interface Notification {
  kind: NotificationKind;
  realmName: string;
  proposalName: string;
  proposalPk: string;
  proposalUrl: string;
  ended?: EndedDetail;
}

export interface EventFlags {
  created: boolean;
  votingOpen: boolean;
  ended: boolean;
  reminder: boolean;
}

export interface DetectInput {
  prev: ProposalSnapshot | null;
  proposal: DecodedProposal;
  proposalPk: string;
  proposalUrl: string;
  realmName: string;
  events: EventFlags;
  gov: GovernanceCtx;
  now: number; // unix seconds
}

/** Number of seconds (~5 min) tolerated either side of the 24h reminder window. */
const REMINDER_WINDOW_SEC = 5 * 60;
const REMINDER_LEAD_SEC = 24 * 60 * 60;

function stateLabel(state: number): string {
  switch (state) {
    case ProposalState.Succeeded:
    case ProposalState.Executing:
    case ProposalState.Completed:
      return '✅ Succeeded';
    case ProposalState.Defeated:
      return '❌ Defeated';
    case ProposalState.Cancelled:
      return '🚫 Cancelled';
    case ProposalState.Vetoed:
      return '🛑 Vetoed';
    default:
      return `State ${state}`;
  }
}

/**
 * Build the ended result detail (status label + tally + quorum) from a single
 * decoded proposal snapshot. Extracted so callers can rebuild it from a
 * freshly-read (settled) snapshot instead of a mid-finalization read.
 */
export function buildEndedDetail(proposal: DecodedProposal, gov: GovernanceCtx): EndedDetail {
  const yes = proposal.options[0]?.voteWeight ?? 0n;
  const no = proposal.denyVoteWeight ?? 0n;
  const maxVoteWeight = proposal.maxVoteWeight ?? gov.maxVoteWeight ?? null;
  const pct = gov.communityVoteThresholdPct;
  let quorum: bigint | null = null;
  if (maxVoteWeight != null && pct != null) {
    quorum = (maxVoteWeight * BigInt(pct)) / 100n;
  }
  return { status: stateLabel(proposal.state), yes, no, quorum, pct };
}

export function detectProposalEvents(input: DetectInput): {
  notifications: Notification[];
  next: ProposalSnapshot;
} {
  const { prev, proposal, gov, now, events } = input;
  const yes = proposal.options[0]?.voteWeight ?? 0n;
  const no = proposal.denyVoteWeight ?? 0n;
  const votingAt = proposal.votingAt != null ? Number(proposal.votingAt) : null;
  const votingCompletedAt =
    proposal.votingCompletedAt != null ? Number(proposal.votingCompletedAt) : null;

  const next: ProposalSnapshot = {
    state: proposal.state,
    votingAt,
    votingCompletedAt,
    yes: yes.toString(),
    no: no.toString(),
    name: proposal.name,
    reminderSent: prev?.reminderSent ?? false,
  };

  const notifications: Notification[] = [];
  const base = {
    realmName: input.realmName,
    proposalName: proposal.name || '(untitled)',
    proposalPk: input.proposalPk,
    proposalUrl: input.proposalUrl,
  };

  // 1) Created: first time we ever see this proposal, and it isn't already over.
  if (events.created && prev === null && !isTerminalState(proposal.state)) {
    notifications.push({ kind: 'created', ...base });
  }

  // 2) Voting opened: pre-voting -> now Voting with a votingAt set.
  if (events.votingOpen) {
    const prevVotingAt = prev?.votingAt ?? null;
    if ((prev === null || prevVotingAt === null) && votingAt !== null && proposal.state === ProposalState.Voting) {
      notifications.push({ kind: 'voting_open', ...base });
    }
  }

  // 3) Ended: proposal reached a terminal (final) state. Also fires on first
  // encounter when we missed the non-terminal phase (e.g. a rapid create +
  // finalize/execute) — otherwise a proposal that is already over would only
  // produce a "created" and never report its result.
  if (
    events.ended &&
    isTerminalState(proposal.state) &&
    (prev === null || !isTerminalState(prev.state))
  ) {
    notifications.push({ kind: 'ended', ...base, ended: buildEndedDetail(proposal, gov) });
  }

  // 4) Optional: remind ~24h before voting closes.
  if (events.reminder && !next.reminderSent && proposal.state === ProposalState.Voting && votingAt != null) {
    const end = votingAt + gov.baseVotingTime;
    const toEnd = end - now;
    if (
      toEnd > 0 &&
      toEnd >= REMINDER_LEAD_SEC - REMINDER_WINDOW_SEC &&
      toEnd <= REMINDER_LEAD_SEC + REMINDER_WINDOW_SEC
    ) {
      notifications.push({ kind: 'reminder', ...base });
      next.reminderSent = true;
    }
  }

  return { notifications, next };
}
