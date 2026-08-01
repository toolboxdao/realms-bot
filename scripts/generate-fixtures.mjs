// Dumps raw base64 account data for ToolboxDAO from a live RPC (Surfpool by
// default) into tests/fixtures/accounts.json. Uses only plain `fetch` — no
// @solana/web3.js — so the repo stays free of the web3.js/Node rpc-websockets
// interop issues. Ground-truth assertions live in the test files (hardcoded
// values sourced from the canonical @solana/spl-governance SDK).
//
// Usage: RPC=http://127.0.0.1:8899 npm run fixtures
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RPC = process.env.RPC || 'http://127.0.0.1:8899';
const PROGRAM = 'GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw';
const REALM = 'Dsh5QZbhK7MLoC8cxaNwL5Nta2rrLiDWuRA4gnkLfopi';
const GOVERNANCE = '5Nn7GMBt1YrPWuzZ7nwY8kBsLkaUhCunnQM9nYaD1MZm';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');

async function call(method, params) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

async function getAccount(pk) {
  const r = await call('getAccountInfo', [pk, { encoding: 'base64' }]);
  return r?.value?.data?.[0] ?? null;
}

async function getProposalAccounts() {
  const r = await call('getProgramAccounts', [
    PROGRAM,
    {
      encoding: 'base64',
      filters: [{ memcmp: { offset: 1, bytes: GOVERNANCE } }],
    },
  ]);
  return (r ?? [])
    .filter((a) => a.account?.owner === PROGRAM && a.account.data?.[0])
    .map((a) => ({
      pubkey: a.pubkey,
      data: a.account.data[0],
      // accountType is the first byte; keep only spl-gov V2 proposals (14)
      type: Buffer.from(a.account.data[0], 'base64')[0],
    }))
    .filter((a) => a.type === 14);
}

(async () => {
  const proposals = await getProposalAccounts();
  const fixture = {
    meta: { generatedFrom: RPC, program: PROGRAM, realm: REALM, governance: GOVERNANCE },
    realm: { pubkey: REALM, data: await getAccount(REALM) },
    governance: { pubkey: GOVERNANCE, data: await getAccount(GOVERNANCE) },
    proposals: proposals.map(({ pubkey, data }) => ({ pubkey, data })),
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'accounts.json'), JSON.stringify(fixture, null, 2));
  console.log(`Wrote realm + governance + ${proposals.length} proposals to ${outDir}/accounts.json`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
