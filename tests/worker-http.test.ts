import { exports, env } from 'cloudflare:workers';
import { describe, it, expect } from 'vitest';

const worker = exports.default as unknown as {
  fetch(request: Request): Promise<Response>;
};

describe('Worker HTTP routes', () => {
  it('serves /health', async () => {
    const res = await worker.fetch(new Request('http://x/health'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; service: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe('realms-bot');
  });

  it('404s unknown routes', async () => {
    const res = await worker.fetch(new Request('http://x/nope'));
    expect(res.status).toBe(404);
  });

  it('requires the shared secret on /status', { skip: !env.WEBHOOK_SECRET }, async () => {
    const unauth = await worker.fetch(new Request('http://x/status'));
    expect(unauth.status).toBe(401);
    const authed = await worker.fetch(
      new Request('http://x/status', { headers: { 'x-webhook-secret': env.WEBHOOK_SECRET! } }),
    );
    expect(authed.status).toBe(200);
  });

  it('rejects unauthenticated /webhook', { skip: !env.WEBHOOK_SECRET }, async () => {
    const res = await worker.fetch(
      new Request('http://x/webhook', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 for malformed /webhook JSON', { skip: !env.WEBHOOK_SECRET }, async () => {
    const res = await worker.fetch(
      new Request('http://x/webhook', {
        method: 'POST',
        body: 'not-json',
        headers: { 'content-type': 'application/json', 'x-webhook-secret': env.WEBHOOK_SECRET! },
      }),
    );
    expect(res.status).toBe(400);
  });
});
