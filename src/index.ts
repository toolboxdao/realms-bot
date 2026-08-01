import { ADDRESSES } from './config';
import type { Env, GovernanceBotDOStub } from './types';

export { GovernanceBotDO } from './do/GovernanceBotDO';

function stubFor(env: Env): GovernanceBotDOStub {
  const id = env.GOVERNANCE_BOT.idFromName('toolbox');
  return env.GOVERNANCE_BOT.get(id) as unknown as GovernanceBotDOStub;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function authorized(request: Request, env: Env): boolean {
  if (!env.WEBHOOK_SECRET) return true;
  // Helius echoes `authHeader` in the Authorization header on deliveries;
  // x-webhook-secret is accepted for local/admin calls.
  const value =
    request.headers.get('authorization') ??
    request.headers.get('x-webhook-secret') ??
    '';
  return value === env.WEBHOOK_SECRET;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const stub = stubFor(env);

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return json({ ok: true, service: 'realms-bot', program: ADDRESSES.program, realm: ADDRESSES.realm });
    }

    if (request.method === 'POST' && url.pathname === '/webhook') {
      if (!authorized(request, env)) return new Response('unauthorized', { status: 401 });
      let payload: unknown;
      try {
        payload = await request.json();
      } catch {
        return json({ ok: false, error: 'invalid json' }, 400);
      }
      // Helius requires a 200 within 1s and retries otherwise. Process in the
      // background (dedup makes retries safe) and acknowledge immediately.
      ctx.waitUntil(stub.handleWebhook(payload).catch(() => {}));
      return json({ ok: true, accepted: true });
    }

    if (request.method === 'POST' && url.pathname === '/test') {
      if (!authorized(request, env)) return new Response('unauthorized', { status: 401 });
      try {
        const res = await stub.sendTestMessage();
        return json(res);
      } catch (err) {
        return json({ ok: false, error: String(err) }, 500);
      }
    }

    if (request.method === 'GET' && url.pathname === '/status') {
      if (!authorized(request, env)) return new Response('unauthorized', { status: 401 });
      const status = await stub.status();
      return json(status);
    }

    return new Response('not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
