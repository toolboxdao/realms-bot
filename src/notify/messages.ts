/** Pure instruction-message (chat text) formatters. Kept free of I/O. */
import type { Notification } from '../engine/engine';
import type { Config } from '../config';

function comma(s: string): string {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Format a raw token amount (base units) into a human-readable string. */
export function fmtToken(raw: bigint, decimals: number): string {
  const div = 10n ** BigInt(decimals);
  const whole = raw / div;
  const frac = raw % div;
  if (frac === 0n) return comma(whole.toString());
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, 2).replace(/0+$/, '');
  return comma(whole.toString()) + (fracStr ? '.' + fracStr : '');
}

export function formatNotification(n: Notification, cfg: Config): string {
  switch (n.kind) {
    case 'created':
      return [
        `🆕 New proposal in ${n.realmName}`,
        `“${n.proposalName}”`,
        ``,
        `🔗 ${n.proposalUrl}`,
      ].join('\n');
    case 'voting_open':
      return [
        `🗳 Proposal opened for voting`,
        `“${n.proposalName}”`,
        ``,
        `🔗 ${n.proposalUrl}`,
      ].join('\n');
    case 'ended': {
      const e = n.ended!;
      const lines = [`🏁 Proposal ended`, `“${n.proposalName}”`, ``, `Result: ${e.status}`];
      lines.push(
        `Yes: ${fmtToken(e.yes, cfg.tokenDecimals)} | No: ${fmtToken(e.no, cfg.tokenDecimals)}`,
      );
      if (e.pct != null) {
        lines.push(
          `Quorum: ${fmtToken(e.quorum ?? 0n, cfg.tokenDecimals)} (${e.pct}% threshold)`,
        );
      }
      lines.push(``, `🔗 ${n.proposalUrl}`);
      return lines.join('\n');
    }
    case 'reminder':
      return [
        `⏰ “${n.proposalName}” closes for voting in ~24 hours`,
        ``,
        `🔗 ${n.proposalUrl}`,
      ].join('\n');
    default:
      return n.proposalName;
  }
}
