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
    message?: {
      accountKeys?: string[];
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

/** Extract candidate account keys that governance instructions touch. */
export function extractCandidateKeys(event: HeliusEvent, programB58: string): string[] {
  const found = new Set<string>();
  const msg = event?.transaction?.message;
  const accountKeys = msg?.accountKeys ?? [];

  if (accountKeys.length > 0 && Array.isArray(msg?.instructions)) {
    for (const ix of msg.instructions) {
      const pid = ix.programIdIndex;
      if (pid === undefined) continue;
      const program = accountKeys[pid];
      if (program !== programB58) continue;
      for (const idx of ix.accounts ?? []) {
        const key = accountKeys[idx];
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

export function eventSignature(event: HeliusEvent): string | undefined {
  return event?.signature;
}
