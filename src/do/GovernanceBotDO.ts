import { DurableObject } from 'cloudflare:workers';
import { AccountType, makeConfig, ProposalState } from '../config';
import { createRpc } from '../rpc/rpc';
import { b64decode } from '../borsh/reader';
import {
  decodeProposalV2,
  decodeGovernanceV2,
  decodeRealmV2,
} from '../parse/accounts';
import {
  normalizeWebhook,
  extractCandidateKeys,
  eventSignature,
  type HeliusEvent,
} from '../parse/events';
import {
  detectProposalEvents,
  type GovernanceCtx,
  type ProposalSnapshot,
  type Notification,
} from '../engine/engine';
import { formatNotification } from '../notify/messages';
import {
  DiscordNotifier,
  NoopNotifier,
  TelegramNotifier,
  type Notifier,
} from '../notify/notifier';
import { bytesEqual, pkToB58, realmProposalUrl } from '../lib/util';
import type { Env } from '../types';

const GOV_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Stateless webhook pattern: the Worker's /webhook endpoint keeps no state.
 * All idempotency + proposal snapshots live in this Durable Object's SQLite
 * storage, giving exactly-once processing even with Helius retries/duplicates.
 */
export class GovernanceBotDO extends DurableObject<Env> {
  private cfg = makeConfig(this.env);
  private rpc = createRpc(this.cfg.rpcUrl);
  private notifiers: Notifier[] | null = null;
  private govCache: { ts: number; ctx: GovernanceCtx } | null = null;

  private get sql() {
    return this.ctx.storage.sql;
  }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS seen (
        sig TEXT PRIMARY KEY,
        at INTEGER NOT NULL
      )
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS proposals (
        pk TEXT PRIMARY KEY,
        state INTEGER NOT NULL,
        voting_at INTEGER,
        voting_completed_at INTEGER,
        yes TEXT NOT NULL,
        no TEXT NOT NULL,
        name TEXT NOT NULL,
        reminder INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  // ---------------- meta helpers ----------------

  private getMeta(key: string): string | null {
    const rows = this.sql
      .exec('SELECT value FROM meta WHERE key = ?', key)
      .toArray() as Array<{ value: string }>;
    return rows.length ? rows[0]!.value : null;
  }

  private setMeta(key: string, value: string): void {
    this.sql.exec(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      key,
      value,
    );
  }

  private isSeen(sig: string): boolean {
    const rows = this.sql
      .exec('SELECT 1 FROM seen WHERE sig = ?', sig)
      .toArray();
    return rows.length > 0;
  }

  private markSeen(sig: string): void {
    this.sql.exec('INSERT OR IGNORE INTO seen (sig, at) VALUES (?, ?)', sig, Date.now());
  }

  // ---------------- proposal snapshots ----------------

  private getSnapshot(pk: string): ProposalSnapshot | null {
    const rows = this.sql
      .exec(
        `SELECT state, voting_at, voting_completed_at, yes, no, name, reminder
         FROM proposals WHERE pk = ?`,
        pk,
      )
      .toArray() as Array<{
      state: number;
      voting_at: number | null;
      voting_completed_at: number | null;
      yes: string;
      no: string;
      name: string;
      reminder: number;
    }>;
    if (!rows.length) return null;
    const r = rows[0]!;
    return {
      state: r.state,
      votingAt: r.voting_at,
      votingCompletedAt: r.voting_completed_at,
      yes: r.yes,
      no: r.no,
      name: r.name,
      reminderSent: r.reminder === 1,
    };
  }

  private putSnapshot(pk: string, snap: ProposalSnapshot): void {
    this.sql.exec(
      `INSERT INTO proposals
         (pk, state, voting_at, voting_completed_at, yes, no, name, reminder, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(pk) DO UPDATE SET
         state = excluded.state,
         voting_at = excluded.voting_at,
         voting_completed_at = excluded.voting_completed_at,
         yes = excluded.yes,
         no = excluded.no,
         name = excluded.name,
         reminder = excluded.reminder,
         updated_at = excluded.updated_at`,
      pk,
      snap.state,
      snap.votingAt,
      snap.votingCompletedAt,
      snap.yes,
      snap.no,
      snap.name,
      snap.reminderSent ? 1 : 0,
      Date.now(),
    );
  }

  // ---------------- governance / realm context ----------------

  private async governanceCtx(): Promise<GovernanceCtx> {
    if (this.govCache && Date.now() - this.govCache.ts < GOV_CACHE_TTL_MS) {
      return this.govCache.ctx;
    }
    let ctx: GovernanceCtx = { baseVotingTime: 0, communityVoteThresholdPct: null, maxVoteWeight: null };
    try {
      const programB58 = pkToB58(this.cfg.programPk);
      const govInfo = await this.rpc.getAccountInfo(pkToB58(this.cfg.governancePk));
      if (govInfo && govInfo.owner === programB58) {
        const gov = decodeGovernanceV2(b64decode(govInfo.data));
        ctx.baseVotingTime = gov.config.baseVotingTime;
        if (gov.config.communityVoteThreshold.type === 0) {
          ctx.communityVoteThresholdPct = gov.config.communityVoteThreshold.value;
        }
      }
      const realmInfo = await this.rpc.getAccountInfo(pkToB58(this.cfg.realmPk));
      if (realmInfo && realmInfo.owner === programB58) {
        const realm = decodeRealmV2(b64decode(realmInfo.data));
        // Absolute max-vote-weight source: use the fixed value as fallback.
        if (realm.maxVoteWeightSource.type === 1) {
          ctx.maxVoteWeight = realm.maxVoteWeightSource.value;
        }
      }
    } catch {
      // best-effort; ended notifications just won't have quorum numbers
    }
    this.govCache = { ts: Date.now(), ctx };
    return ctx;
  }

  // ---------------- bootstrap ----------------

  /**
   * On first use, snapshot all of ToolboxDAO's existing proposals silently so
   * that future webhooks only notify on genuine transitions (no spam of the
   * 45 pre-existing proposals at deploy time).
   */
  private async ensureBootstrapped(): Promise<void> {
    if (this.getMeta('bootstrapped') === '1') return;
    const programB58 = pkToB58(this.cfg.programPk);
    const governanceB58 = pkToB58(this.cfg.governancePk);
    const accounts = await this.rpc.getProgramAccounts(programB58, [
      { memcmp: { offset: 1, bytes: governanceB58 } },
    ]);
    for (const { pubkey, account } of accounts) {
      if (!account || account.owner !== programB58) continue;
      const data = b64decode(account.data);
      if (data[0] !== AccountType.ProposalV2) continue;
      let decoded;
      try {
        decoded = decodeProposalV2(data);
      } catch {
        continue;
      }
      if (!bytesEqual(decoded.governance, this.cfg.governancePk)) continue;
      const yes = decoded.options[0]?.voteWeight ?? 0n;
      const snap: ProposalSnapshot = {
        state: decoded.state,
        votingAt: decoded.votingAt != null ? Number(decoded.votingAt) : null,
        votingCompletedAt:
          decoded.votingCompletedAt != null ? Number(decoded.votingCompletedAt) : null,
        yes: yes.toString(),
        no: (decoded.denyVoteWeight ?? 0n).toString(),
        name: decoded.name,
        reminderSent: false,
      };
      this.putSnapshot(pubkey, snap);
    }
    this.setMeta('bootstrapped', '1');
  }

  // ---------------- notifications ----------------

  private getNotifiers(): Notifier[] {
    if (this.notifiers) return this.notifiers;
    const list: Notifier[] = [];
    if (this.env.TELEGRAM_BOT_TOKEN && this.env.TELEGRAM_CHAT_ID) {
      list.push(new TelegramNotifier(this.env.TELEGRAM_BOT_TOKEN, this.env.TELEGRAM_CHAT_ID));
    }
    if (this.env.DISCORD_WEBHOOK_URL) {
      list.push(new DiscordNotifier(this.env.DISCORD_WEBHOOK_URL));
    }
    if (list.length === 0) list.push(new NoopNotifier());
    this.notifiers = list;
    return list;
  }

  // ---------------- RPC entry points ----------------

  async handleWebhook(payload: unknown): Promise<{ ok: boolean; processed: number }> {
    await this.ensureBootstrapped();
    const events = normalizeWebhook(payload);
    const notifiers = this.getNotifiers();
    const programB58 = pkToB58(this.cfg.programPk);
    const realmB58 = pkToB58(this.cfg.realmPk);
    const gov = await this.governanceCtx();
    let processed = 0;

    for (const event of events) {
      const sig = eventSignature(event);
      if (!sig) continue; // can't dedup without a signature; skip
      if (this.isSeen(sig)) continue;

      const keys = extractCandidateKeys(event, programB58);
      if (keys.length === 0) {
        this.markSeen(sig);
        processed++;
        continue;
      }

      const infos = await this.rpc.getMultipleAccounts(keys);
      const touched: Array<{ pk: string; decoded: ReturnType<typeof decodeProposalV2> }> = [];
      for (let i = 0; i < keys.length; i++) {
        const info = infos[i];
        if (!info || info.owner !== programB58) continue;
        const data = b64decode(info.data);
        if (data[0] !== AccountType.ProposalV2) continue;
        try {
          const decoded = decodeProposalV2(data);
          if (bytesEqual(decoded.governance, this.cfg.governancePk)) {
            touched.push({ pk: keys[i]!, decoded });
          }
        } catch {
          /* not a parseable proposal for our governance */
        }
      }
      if (touched.length === 0) {
        this.markSeen(sig);
        processed++;
        continue;
      }

      // Collect notifications for this transaction; send all, then persist.
      const planned: Array<{ pk: string; next: ProposalSnapshot; notifications: Notification[] }> = [];
      const now = Math.floor(Date.now() / 1000);
      for (const { pk, decoded } of touched) {
        const prev = this.getSnapshot(pk);
        const proposalUrl = realmProposalUrl(this.cfg.realmsUrl, realmB58, pk);
        const { notifications, next } = detectProposalEvents({
          prev,
          proposal: decoded,
          proposalPk: pk,
          proposalUrl,
          realmName: this.cfg.realmName,
          events: this.cfg.events,
          gov,
          now,
        });
        planned.push({ pk, next, notifications });
      }

      // Send everything first (so a failure triggers a Helius retry, keeping
      // snapshots un-updated and preventing missed events).
      for (const p of planned) {
        for (const n of p.notifications) {
          const text = formatNotification(n, this.cfg);
          for (const notifier of notifiers) {
            await notifier.send(text);
          }
        }
      }
      for (const p of planned) this.putSnapshot(p.pk, p.next);
      this.markSeen(sig);
      processed++;
    }

    return { ok: true, processed };
  }

  async sendTestMessage(): Promise<{ ok: boolean }> {
    const notifiers = this.getNotifiers();
    const text =
      `🧪 ToolboxDAO governance bot — test message\n` +
      `Notifications are live. Timestamp: ${new Date().toISOString()}`;
    for (const notifier of notifiers) {
      await notifier.send(text);
    }
    return { ok: true };
  }

  async status(): Promise<Record<string, unknown>> {
    const proposalRows = this.sql.exec('SELECT COUNT(*) AS n FROM proposals').toArray() as Array<{
      n: number;
    }>;
    const seenRows = this.sql.exec('SELECT COUNT(*) AS n FROM seen').toArray() as Array<{ n: number }>;
    const active = this.sql
      .exec('SELECT pk, state, name FROM proposals WHERE state = ?', ProposalState.Voting)
      .toArray() as Array<{ pk: string; state: number; name: string }>;
    return {
      realm: this.cfg.realmName,
      program: pkToB58(this.cfg.programPk),
      governance: pkToB58(this.cfg.governancePk),
      rpcUrl: this.cfg.rpcUrl,
      bootstrapped: this.getMeta('bootstrapped') === '1',
      proposalCount: proposalRows[0]?.n ?? 0,
      seenCount: seenRows[0]?.n ?? 0,
      activeVoting: active,
    };
  }
}
