/** Notification delivery targets. Telegram now, Discord later. */

export interface Notifier {
  /** Send a text message; throws on failure so the caller can retry. */
  send(text: string): Promise<void>;
}

export class NoopNotifier implements Notifier {
  async send(): Promise<void> {
    /* intentional no-op (e.g. tests / no token configured) */
  }
}

interface TelegramResponse {
  ok?: boolean;
  description?: string;
}

export class TelegramNotifier implements Notifier {
  private readonly token: string;
  private readonly chatId: string;

  constructor(token: string, chatId: string) {
    this.token = token;
    this.chatId = chatId;
  }

  async send(text: string): Promise<void> {
    const url = `https://api.telegram.org/bot${this.token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: this.chatId,
        text,
        disable_web_page_preview: true,
      }),
    });
    if (res.status !== 200) {
      throw new Error(`Telegram sendMessage returned ${res.status}`);
    }
    const body = (await res.json()) as TelegramResponse;
    if (!body.ok) {
      throw new Error(`Telegram sendMessage failed: ${body.description ?? 'unknown'}`);
    }
  }
}

export class DiscordNotifier implements Notifier {
  private readonly webhookUrl: string;

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl;
  }

  async send(text: string): Promise<void> {
    const res = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: text }),
    });
    if (!res.ok) throw new Error(`Discord webhook returned ${res.status}`);
  }
}
