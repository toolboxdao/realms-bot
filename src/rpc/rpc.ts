/** Minimal JSON-RPC client for reading on-chain accounts over plain `fetch`. */
export interface AccountInfo {
  data: string; // base64
  owner: string;
  executable: boolean;
  lamports: number;
}

type RawAccount = {
  data: string | [string, string];
  owner: string;
  executable: boolean;
  lamports: number;
};

/** Solana JSON-RPC returns `data` as either a bare string or `[data, encoding]`. */
function normalizeData(raw: RawAccount | null): AccountInfo | null {
  if (!raw) return null;
  const data = Array.isArray(raw.data) ? raw.data[0] : raw.data;
  return { data, owner: raw.owner, executable: raw.executable, lamports: raw.lamports };
}

export interface RpcClient {
  getAccountInfo(pk: string): Promise<AccountInfo | null>;
  getMultipleAccounts(pks: string[]): Promise<Array<AccountInfo | null>>;
  getProgramAccounts(
    programId: string,
    filters?: Array<{ memcmp?: { offset: number; bytes: string }; dataSize?: number }>,
  ): Promise<Array<{ pubkey: string; account: AccountInfo | null }>>;
}

interface RpcResponse<T> {
  result?: T;
  error?: { message?: string };
}

export function createRpc(url: string): RpcClient {
  async function call<T>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    });
    if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
    const json = (await res.json()) as RpcResponse<T>;
    if (json.error) throw new Error(`RPC ${method} error: ${json.error.message ?? 'unknown'}`);
    return json.result as T;
  }

  return {
    async getAccountInfo(pk) {
      const info = await call<{ value: RawAccount | null }>('getAccountInfo', [
        pk,
        { encoding: 'base64' },
      ]);
      return normalizeData(info.value);
    },
    async getMultipleAccounts(pks) {
      if (pks.length === 0) return [];
      // getMultipleAccounts caps at 100 per call.
      const out: Array<AccountInfo | null> = [];
      for (let i = 0; i < pks.length; i += 100) {
        const chunk = pks.slice(i, i + 100);
        const { value } = await call<{ value: Array<RawAccount | null> }>(
          'getMultipleAccounts',
          [chunk, { encoding: 'base64' }],
        );
        for (const v of value ?? []) out.push(normalizeData(v));
      }
      return out;
    },
    async getProgramAccounts(programId, filters = []) {
      const result = await call<
        Array<{ pubkey: string; account: RawAccount | null }>
      >('getProgramAccounts', [programId, { encoding: 'base64', filters }]);
      return (result ?? []).map(({ pubkey, account }) => ({
        pubkey,
        account: normalizeData(account),
      }));
    },
  };
}
