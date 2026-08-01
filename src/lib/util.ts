import { base58 } from '@scure/base';

/** Encode a 32-byte pubkey to its base58 string. */
export function pkToB58(bytes: Uint8Array): string {
  return base58.encode(bytes);
}

/** Constant-time-ish byte equality (for fixed 32-byte pubkeys). */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** Realms proposal deep-link. Uses the realm pubkey so it works for any DAO. */
export function realmProposalUrl(
  realmsUrl: string,
  realmPkB58: string,
  proposalPk: string,
): string {
  return `${realmsUrl}/dao/${realmPkB58}/proposal/${proposalPk}`;
}
