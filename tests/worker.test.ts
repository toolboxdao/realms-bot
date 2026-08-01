import { env } from 'cloudflare:workers';
import { describe, it, expect, afterEach, vi } from 'vitest';
import fixtures from './fixtures/accounts.json';
import type { GovBotStub } from './stubs';

const PROGRAM = 'GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw';
const RPC = 'http://127.0.0.1:8899';
const FOUNDATIONAL = 'w4bZTbJjHrdgiJShFcyiP4NziFEYLK1eVRtXSM91KA1';

interface FakeLog {
  telegram: Array<{ chat_id: string; text: string }>;
  discord: string[];
}

function makeFakeFetch(opts: { bootstrapCount?: number } = {}): { log: FakeLog; fetch: typeof fetch } {
  const log: FakeLog = { telegram: [], discord: [] };
  const byPk = new Map<string, string>();
  for (const p of fixtures.proposals) byPk.set(p.pubkey, p.data);
  byPk.set(fixtures.realm.pubkey, fixtures.realm.data);
  byPk.set(fixtures.governance.pubkey, fixtures.governance.data);

  const accountFor = (pk: string) => {
    const data = byPk.get(pk);
    return data ? { data, owner: PROGRAM, executable: false, lamports: 1 } : null;
  };

  const handle = async (req: Request): Promise<Response> => {
    const url = req.url;
    if (url.startsWith(RPC)) {
      const body = (await req.json()) as { method: string; params: unknown[] };
      const respond = (result: unknown) =>
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
          headers: { 'content-type': 'application/json' },
        });
      if (body.method === 'getProgramAccounts') {
        const n = opts.bootstrapCount ?? fixtures.proposals.length;
        const accts = fixtures.proposals.slice(0, n).map((p) => ({ pubkey: p.pubkey, account: accountFor(p.pubkey) }));
        return respond(accts);
      }
      if (body.method === 'getAccountInfo') {
        return respond({ value: accountFor(body.params![0] as string) });
      }
      if (body.method === 'getMultipleAccounts') {
        const keys = body.params![0] as string[];
        return respond({ value: keys.map(accountFor) });
      }
      return respond(null);
    }
    if (url.includes('api.telegram.org')) {
      const b = (await req.json()) as { chat_id: string; text: string };
      log.telegram.push(b);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (url.includes('discord.com')) {
      log.discord.push(await req.text());
      return new Response('', { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };

  return { log, fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
    handle(new Request(input, init))) as typeof fetch };
}

function freshStub(name: string): GovBotStub {
  const ns = env.GOVERNANCE_BOT;
  return ns.get(ns.idFromName(`test-${name}-${Math.random()}`)) as GovBotStub;
}

afterEach(() => vi.unstubAllGlobals());

describe('GovernanceBotDO integration (Miniflare + real ToolboxDAO fixtures)', () => {
  it('bootstraps existing proposals and reports them in status', async () => {
    const fake = makeFakeFetch();
    vi.stubGlobal('fetch', fake.fetch);
    const stub = freshStub('boot');
    const before = await stub.status();
    expect(before.bootstrapped).toBe(false);

    await stub.handleWebhook([{ signature: 'bootstrap-trigger', accountData: [{ account: fixtures.proposals[0].pubkey }] }]);

    const after = await stub.status();
    expect(after.bootstrapped).toBe(true);
    expect(after.proposalCount).toBe(fixtures.proposals.length);
    expect(after.seenCount).toBeGreaterThanOrEqual(1);
  });

  it('deduplicates repeated deliveries of the same signature', async () => {
    const fake = makeFakeFetch();
    vi.stubGlobal('fetch', fake.fetch);
    const stub = freshStub('dedup');
    const payload = [{ signature: 'sig-dup-1', accountData: [{ account: FOUNDATIONAL }] }];
    const r1 = await stub.handleWebhook(payload);
    expect(r1.processed).toBe(1);
    const r2 = await stub.handleWebhook(payload);
    expect(r2.processed).toBe(0);
  });

  it('publishes created + voting_open to Telegram for a new active proposal', { skip: !env.TELEGRAM_BOT_TOKEN }, async () => {
    const fake = makeFakeFetch({ bootstrapCount: 0 });
    vi.stubGlobal('fetch', fake.fetch);
    const stub = freshStub('notify');
    const payload = [{ signature: 'sig-new-active', accountData: [{ account: FOUNDATIONAL }] }];
    const r = await stub.handleWebhook(payload);
    expect(r.ok).toBe(true);

    expect(fake.log.telegram.length).toBeGreaterThanOrEqual(2);
    const texts = fake.log.telegram.map((t) => t.text);
    expect(texts.some((t) => t.includes('New proposal'))).toBe(true);
    expect(texts.some((t) => t.includes('opened for voting'))).toBe(true);
    expect(fake.log.telegram.every((t) => t.chat_id)).toBeTruthy();
  });
});
