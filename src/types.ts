/** Cloudflare binding types for the realms-bot Worker + Durable Object. */
export interface Env {
  // --- Durable Object binding ---
  GOVERNANCE_BOT: DurableObjectNamespace;

  // --- Static vars (wrangler.jsonc `vars`) ---
  GOV_PROGRAM: string;
  TOOLBOX_REALM: string;
  GOVERNANCE: string;
  COMMUNITY_MINT: string;
  REALM_NAME: string;
  RPC_URL: string;
  REALMS_URL: string;
  TOKEN_DECIMALS: string;
  EVENT_CREATED: string;
  EVENT_VOTING_OPEN: string;
  EVENT_ENDED: string;
  EVENT_REMINDER: string;

  // --- Secrets (wrangler secret put) ---
  WEBHOOK_SECRET?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  DISCORD_WEBHOOK_URL?: string;
}

/** Public methods exposed by the GovernanceBotDO for RPC calls from the Worker. */
export interface GovernanceBotDOStub {
  handleWebhook(payload: unknown): Promise<{ ok: boolean; processed: number }>;
  status(): Promise<Record<string, unknown>>;
  sendTestMessage(): Promise<{ ok: boolean }>;
}
