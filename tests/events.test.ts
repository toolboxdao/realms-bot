import { describe, it, expect } from 'vitest';
import { extractCandidateKeys, eventSignature, type HeliusEvent } from '../src/parse/events';

const PROGRAM = 'GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw';
const GOVERNANCE = '5Nn7GMBt1YrPWuzZ7nwY8kBsLkaUhCunnQM9nYaD1MZm';
const PROPOSAL = '6eGkM7hoeKmtHeM1t8mR4LDkbnxDkZz5oXewYBd4G1Vd';

/** Helpers to build a CreateProposal tx where PROGRAM is the last account key. */
function buildWithKeys(keys: unknown[]): HeliusEvent {
  const instructions = [{ programIdIndex: keys.length - 1, accounts: [0, 1, 2] }];
  return {
    signature: `sig-${Math.random()}`,
    transaction: { message: { accountKeys: keys as never, instructions } },
    meta: { loadedAddresses: { writable: [], readonly: [] } },
  };
}

describe('extractCandidateKeys', () => {
  it('reads candidate keys from jsonParsed account keys (objects) — the raw Helius webhook shape', () => {
    const event = buildWithKeys([
      { pubkey: PROPOSAL, signer: false, writable: true, source: 'transaction' },
      { pubkey: GOVERNANCE, signer: false, writable: false, source: 'transaction' },
      { pubkey: 'realm', signer: false, writable: false, source: 'transaction' },
      { pubkey: PROGRAM, signer: false, writable: false, source: 'transaction' },
    ]);
    const keys = extractCandidateKeys(event, PROGRAM);
    expect(keys).toContain(PROPOSAL);
    expect(keys).toContain(GOVERNANCE);
  });

  it('reads candidate keys from plain base58 string account keys', () => {
    const event = buildWithKeys([PROPOSAL, GOVERNANCE, 'realm', PROGRAM]);
    const keys = extractCandidateKeys(event, PROGRAM);
    expect(keys).toContain(PROPOSAL);
    expect(keys).toContain(GOVERNANCE);
  });

  it('reads candidate keys from enhanced accountData payloads', () => {
    const event = { signature: 'sig-e', accountData: [{ account: PROPOSAL }, { account: GOVERNANCE }] };
    const keys = extractCandidateKeys(event, PROGRAM);
    expect(keys).toContain(PROPOSAL);
    expect(keys).toContain(GOVERNANCE);
  });

  it('returns [] when no instruction invokes the governance program', () => {
    const event = buildWithKeys([
      { pubkey: PROPOSAL, signer: false, writable: true },
      { pubkey: 'someOtherProgram', signer: false, writable: false },
    ]);
    expect(extractCandidateKeys(event, PROGRAM)).toEqual([]);
  });

  it('returns [] for a completely empty event', () => {
    expect(extractCandidateKeys({}, PROGRAM)).toEqual([]);
  });
});

describe('eventSignature', () => {
  it("reads the signature from transaction.signatures[0] (real Helius raw shape)", () => {
    const event: HeliusEvent = {
      transaction: { signatures: ['5Nn7sig123'] },
    };
    expect(eventSignature(event)).toBe('5Nn7sig123');
  });

  it('prefers the top-level signature when present (enhanced shape)', () => {
    const event: HeliusEvent = { signature: 'top-sig', transaction: { signatures: ['nested-sig'] } };
    expect(eventSignature(event)).toBe('top-sig');
  });

  it('returns undefined when there is no signature anywhere', () => {
    expect(eventSignature({})).toBeUndefined();
  });
});
