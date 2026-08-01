/** Test-only typing for the GovernanceBotDO RPC stub returned by the DO binding. */
export interface GovBotStub {
  handleWebhook(payload: unknown): Promise<{ ok: boolean; processed: number }>;
  status(): Promise<Record<string, unknown>>;
}
