import { describe, it, expect } from 'vitest';
import {
  detectProposalEvents,
  type ProposalSnapshot,
  type GovernanceCtx,
  type EventFlags,
} from '../src/engine/engine';
import type { DecodedProposal } from '../src/parse/accounts';

const PROGRAM_B58 = 'GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw';
const REALM_B58 = 'Dsh5QZbhK7MLoC8cxaNwL5Nta2rrLiDWuRA4gnkLfopi';
const GOV_B58 = '5Nn7GMBt1YrPWuzZ7nwY8kBsLkaUhCunnQM9nYaD1MZm';

import { base58 } from '@scure/base';
const govPk = base58.decode(GOV_B58);

const ALL_FLAGS: EventFlags = { created: true, votingOpen: true, ended: true, reminder: false };

// baseVotingTime 259200s (3d), 20% threshold, absolute maxVoteWeight 99999999999000000n
const GOV_CTX: GovernanceCtx = {
  baseVotingTime: 259200,
  communityVoteThresholdPct: 20,
  maxVoteWeight: 99999999999000000n,
};

function makeProposal(overrides: Partial<DecodedProposal>): DecodedProposal {
  return {
    accountType: 14,
    governance: govPk,
    governingTokenMint: new Uint8Array(32),
    state: 2,
    tokenOwnerRecord: new Uint8Array(32),
    voteType: { kind: 0 },
    options: [{ label: 'Approve', voteWeight: 0n, voteResult: 0 }],
    denyVoteWeight: 0n,
    abstainVoteWeight: null,
    draftAt: 0n,
    signingOffAt: null,
    votingAt: 100n,
    votingCompletedAt: null,
    executingAt: null,
    closedAt: null,
    maxVoteWeight: null,
    maxVotingTime: null,
    voteThreshold: null,
    name: 'Test proposal',
    descriptionLink: '',
    vetoVoteWeight: 0n,
    ...overrides,
  };
}

const base = {
  proposalPk: 'abc',
  proposalUrl: `https://realms.today/dao/${REALM_B58}/proposal/abc`,
  realmName: 'ToolboxDAO',
  events: ALL_FLAGS,
  gov: GOV_CTX,
  now: 2000,
};

describe('detectProposalEvents', () => {
  it('emits `created` when a proposal is first seen', () => {
    const res = detectProposalEvents({ prev: null, proposal: makeProposal({ state: 0, votingAt: null }), ...base });
    expect(res.notifications.map((n) => n.kind)).toContain('created');
    expect(res.next.state).toBe(0);
  });

  it('emits `created` and `voting_open` when a brand-new proposal is already voting', () => {
    const res = detectProposalEvents({ prev: null, proposal: makeProposal({ state: 2, votingAt: 100n }), ...base });
    const kinds = res.notifications.map((n) => n.kind);
    expect(kinds).toContain('created');
    expect(kinds).toContain('voting_open');
  });

  it('emits `voting_open` only on the pre-voting -> voting transition', () => {
    const prev: ProposalSnapshot = { state: 0, votingAt: null, votingCompletedAt: null, yes: '0', no: '0', name: 'x', reminderSent: false };
    const res = detectProposalEvents({ prev, proposal: makeProposal({ state: 2, votingAt: 100n }), ...base });
    expect(res.notifications.map((n) => n.kind)).toContain('voting_open');
    // no repeat once already voting
    const res2 = detectProposalEvents({ prev: res.next, proposal: makeProposal({ state: 2, votingAt: 100n }), ...base });
    expect(res2.notifications.map((n) => n.kind)).not.toContain('voting_open');
  });

  it('does not emit `ended` for a terminal proposal that is first seen (no spam on backfill)', () => {
    const res = detectProposalEvents({ prev: null, proposal: makeProposal({ state: 5, votingCompletedAt: 150n }), ...base });
    const kinds = res.notifications.map((n) => n.kind);
    expect(kinds).toContain('created');
    expect(kinds).not.toContain('ended');
  });

  it('emits `ended` Succeeded with quorum when voting transitions to a final state', () => {
    const prev: ProposalSnapshot = { state: 2, votingAt: 100n, votingCompletedAt: null, yes: '0', no: '0', name: 'x', reminderSent: false };
    const proposal = makeProposal({ state: 5, options: [{ label: 'Approve', voteWeight: 30000000000000000n, voteResult: 0 }], denyVoteWeight: 0n, votingCompletedAt: 150n, maxVoteWeight: 99999999999000000n });
    const res = detectProposalEvents({ prev, proposal, ...base });
    const ended = res.notifications.find((n) => n.kind === 'ended');
    expect(ended).toBeDefined();
    expect(ended!.ended!.status).toBe('✅ Succeeded');
    expect(ended!.ended!.yes).toBe(30000000000000000n);
    // quorum = 20% of 99999999999000000n
    expect(ended!.ended!.quorum).toBe((99999999999000000n * 20n) / 100n);
    expect(ended!.ended!.pct).toBe(20);
  });

  it('emits `ended` Defeated when no-side wins', () => {
    const prev: ProposalSnapshot = { state: 2, votingAt: 100n, votingCompletedAt: null, yes: '0', no: '0', name: 'x', reminderSent: false };
    const proposal = makeProposal({ state: 4, options: [{ label: 'Approve', voteWeight: 0n, voteResult: 0 }], denyVoteWeight: 500n, votingCompletedAt: 150n, maxVoteWeight: 99999999999000000n });
    const res = detectProposalEvents({ prev, proposal, ...base });
    expect(res.notifications.find((n) => n.kind === 'ended')!.ended!.status).toBe('❌ Defeated');
  });

  it('persists the next snapshot for later transitions', () => {
    const res = detectProposalEvents({
      prev: null,
      proposal: makeProposal({ state: 2, votingAt: 100n, options: [{ label: 'Approve', voteWeight: 7n, voteResult: 0 }], denyVoteWeight: 2n }),
      ...base,
    });
    expect(res.next.yes).toBe('7');
    expect(res.next.no).toBe('2');
    expect(res.next.votingAt).toBe(100);
  });

  it('emits a single `reminder` when voting closes in ~24h', () => {
    const FLAGS: EventFlags = { created: false, votingOpen: false, ended: false, reminder: true };
    // votingAt such that end (votingAt + baseVotingTime) is ~24h from now
    const end = base.now + 24 * 3600 + 60;
    const votingAt = BigInt(end - GOV_CTX.baseVotingTime);
    const proposal = makeProposal({ state: 2, votingAt });
    const r1 = detectProposalEvents({ prev: null, proposal, ...base, events: FLAGS, now: base.now });
    const kinds = r1.notifications.map((n) => n.kind);
    expect(kinds).toContain('reminder');
    expect(kinds).not.toContain('created');
    expect(r1.next.reminderSent).toBe(true);
    // second pass: no repeat
    const r2 = detectProposalEvents({ prev: r1.next, proposal, ...base, events: FLAGS, now: base.now + 60 });
    expect(r2.notifications).toHaveLength(0);
  });
});
