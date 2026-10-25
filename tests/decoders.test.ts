import { describe, it, expect } from 'vitest';
import { base58 } from '@scure/base';
import fixtures from './fixtures/accounts.json';
import { decodeRealmV2, decodeGovernanceV2, decodeProposalV2 } from '../src/parse/accounts';
import { b64decode } from '../src/borsh/reader';
import { pkToB58, bytesEqual } from '../src/lib/util';

// Hardcoded truth sourced from the canonical @solana/spl-governance SDK (see
// the probe during development). The fixture data is raw account bytes fetched
// from the mainnet clone, so these assertions are independent of our decoder.
const REALM = 'Dsh5QZbhK7MLoC8cxaNwL5Nta2rrLiDWuRA4gnkLfopi';
const GOV = '5Nn7GMBt1YrPWuzZ7nwY8kBsLkaUhCunnQM9nYaD1MZm';
const COMMUNITY_MINT = 'tboxhozCDDv74fcHuNJuhL1AzZQNi3V2u8PQ2cFLPH8';
const FOUNDATIONAL = 'w4bZTbJjHrdgiJShFcyiP4NziFEYLK1eVRtXSM91KA1';
const VSR_GRANT = 'zo9acVNjdsbmBV1mhSLmRBYoGiCvGDdP6a1SHsfk4CY';

const govBytes = base58.decode(GOV);
const realmBytes = base58.decode(REALM);

function proposalData(pk: string): Uint8Array {
  const f = fixtures.proposals.find((p) => p.pubkey === pk);
  if (!f) throw new Error(`fixture not found: ${pk}`);
  return b64decode(f.data);
}

describe('RealmV2 decoder (real ToolboxDAO data)', () => {
  const d = decodeRealmV2(b64decode(fixtures.realm.data));
  it('decodes name and mint', () => {
    expect(d.name).toBe('ToolboxDAO');
    expect(pkToB58(d.communityMint)).toBe(COMMUNITY_MINT);
  });
  it('decodes absolute max-vote-weight source', () => {
    expect(d.maxVoteWeightSource.type).toBe(1);
    expect(d.maxVoteWeightSource.value).toBe(99999999999000000n);
  });
  it('has a council mint', () => {
    expect(d.councilMint).not.toBeNull();
  });
});

describe('GovernanceV2 decoder (real ToolboxDAO data)', () => {
  const d = decodeGovernanceV2(b64decode(fixtures.governance.data));
  it('points at the ToolboxDAO realm', () => {
    expect(bytesEqual(d.realm, realmBytes)).toBe(true);
  });
  it('decodes voting config', () => {
    expect(d.config.baseVotingTime).toBe(259200);
    expect(d.config.communityVoteThreshold).toEqual({ type: 0, value: 20 });
  });
});

describe('ProposalV2 decoder (real ToolboxDAO data)', () => {
  it('decodes every bootstrapped proposal without layout errors', () => {
    for (const f of fixtures.proposals) {
      const d = decodeProposalV2(b64decode(f.data));
      expect(bytesEqual(d.governance, govBytes), f.pubkey).toBe(true);
      expect(d.state).toBeGreaterThanOrEqual(0);
      expect(d.state).toBeLessThanOrEqual(9);
      expect(d.name.length).toBeGreaterThan(0);
      expect(d.options.length).toBeGreaterThan(0);
    }
  });

  it('matches SDK truth for the currently-voting "Foundational vote"', () => {
    const d = decodeProposalV2(proposalData(FOUNDATIONAL));
    expect(d.name).toBe('Foundational vote');
    expect(d.state).toBe(2); // Voting
    expect(d.options[0].voteWeight).toBe(26665872324208331n); // yes
    expect(d.denyVoteWeight ?? 0n).toBe(0n); // no
    expect(d.maxVoteWeight).toBeNull();
  });

  it('matches SDK truth for a completed "Vsr Grant"', () => {
    const d = decodeProposalV2(proposalData(VSR_GRANT));
    expect(d.name).toBe('Vsr Grant');
    expect(d.state).toBe(5); // Completed (executed)
    expect(d.options[0].voteWeight).toBe(3n);
    expect(d.maxVoteWeight).toBe(4n);
  });
});
