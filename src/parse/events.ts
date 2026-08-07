/**
 * Normalise a Helius webhook payload and extract the set of on-chain accounts
 * involved in governance instructions for the ToolboxDAO program.
 *
 * Handles both delivery shapes:
 *  - "raw"/jsonParsed: `transaction.message.accountKeys` + `instruction.accounts` (indices)
 *  - "enhanced": `accountData[]` (no instruction-level granularity)
 */
export interface HeliusInstruction {
  programIdIndex?: number;
  accounts?: number[];
  data?: string;
}

export interface HeliusEvent {
  signature?: string;
  slot?: number;
  blockTime?: number;
  transaction?: {
    signatures?: string[];
    message?: {
      accountKeys?: Array<string | { pubkey?: string }>;
      instructions?: HeliusInstruction[];
    };
  };
  meta?: {
    logMessages?: string[];
    loadedAddresses?: {
      writable?: string[];
      readonly?: string[];
    };
  };
  accountData?: Array<{ account?: string }>;
}

/** Accepts either a single event object or an array. */
export function normalizeWebhook(payload: unknown): HeliusEvent[] {
  if (payload === null || payload === undefined) return [];
  if (Array.isArray(payload)) {
    return payload.filter((p): p is HeliusEvent => p !== null && typeof p === 'object');
  }
  if (typeof payload === 'object') return [payload as HeliusEvent];
  return [];
}

/**
 * Account key entries can be either a plain base58 string (`encoding: base64`)
 * or an object `{ pubkey, signer, writable, source }` (the jsonParsed form that
 * Helius delivers for `encoding: "json"`). Normalise both to the pubkey string.
 */
function keyAddr(key: string | { pubkey?: string } | undefined): string | undefined {
  if (key == null) return undefined;
  if (typeof key === 'string') return key;
  return key.pubkey;
}

/** Extract candidate account keys that governance instructions touch. */
export function extractCandidateKeys(event: HeliusEvent, programB58: string): string[] {
  const found = new Set<string>();
  const msg = event?.transaction?.message;
  const accountKeys = msg?.accountKeys ?? [];

  if (accountKeys.length > 0 && Array.isArray(msg?.instructions)) {
    for (const ix of msg.instructions) {
      const pid = ix.programIdIndex;
      if (pid === undefined) continue;
      if (keyAddr(accountKeys[pid]) !== programB58) continue;
      for (const idx of ix.accounts ?? []) {
        const key = keyAddr(accountKeys[idx]);
        if (key) found.add(key);
      }
    }
    // Include loaded address table entries too (cheap; filtered later by owner).
    const loaded = event.meta?.loadedAddresses;
    for (const k of loaded?.writable ?? []) found.add(k);
    for (const k of loaded?.readonly ?? []) found.add(k);
  } else if (Array.isArray(event.accountData)) {
    // Enhanced payload: we don't know instruction granularity, so over-fetch
    // every account and let the owner+parse filter decide.
    for (const a of event.accountData) {
      if (a.account) found.add(a.account);
    }
  }

  return [...found];
}

/** Signature to dedup on. Helius "raw" webhooks mirror the getTransaction
 * response, where the signature lives at `transaction.signatures[0]` — not at
 * the top level. Accept both so all delivery shapes are covered. */
export function eventSignature(event: HeliusEvent): string | undefined {
  return event?.signature ?? event?.transaction?.signatures?.[0];
}
