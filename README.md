# realms-bot

A stateless notification bot that watches **ToolboxDAO** governance on Solana and pushes
proposal events to a **Telegram** channel (Discord-ready) — powered by a
[Helius](https://www.helius.dev/) webhook feeding a Cloudflare **Worker + Durable Object**.

When a governance proposal is created, opens for voting, or ends, the bot sends a message
to your channel with the proposal name, a link, and (on completion) the yes/no/quorum tally.

## Architecture

```
Helius ──POST ──▶ Cloudflare Worker (stateless /webhook)
                     │  ctx.waitUntil (acknowledges in <1s, as Helius requires)
                     ▼
              GovernanceBotDO (Durable Object, SQLite)
              ├─ idempotency table  (dedup → exactly-once vs Helius retries)
              ├─ proposal snapshots (state, votingAt, yes/no)
              ├─ one-time bootstrap of pre-existing proposals (no deploy spam)
              └─ Notifier ─▶ Telegram (sendMessage) · Discord (ready)
```

The Worker keeps no state; all state lives in the Durable Object, so the webhook endpoint is
stateless and horizontally safe. Parsing is done with **no `web3.js`** (hand-rolled borsh
decoders + plain `fetch` RPC), so it runs cleanly in the Workers runtime.

## Events

| Event | Trigger | Message |
|-------|---------|---------|
| 🆕 Created | a new proposal is seen | title + link |
| 🗳 Opened for voting | proposal enters `Voting` | title + link |
| 🏁 Ended | final state reached | ✅/❌ result, yes / no / quorum + link |
| ⏰ Reminder *(off by default)* | ~24h before voting closes | title + link |

Configure with the `EVENT_CREATED` / `EVENT_VOTING_OPEN` / `EVENT_ENDED` / `EVENT_REMINDER` vars.

## Key addresses (all public on-chain data)

- Governance program: `GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw`
- ToolboxDAO realm: `Dsh5QZbhK7MLoC8cxaNwL5Nta2rrLiDWuRA4gnkLfopi`
- Governance account (webhook subscription): `5Nn7GMBt1YrPWuzZ7nwY8kBsLkaUhCunnQM9nYaD1MZm`
- Community mint ($TOOLBOX): `tboxhozCDDv74fcHuNJuhL1AzZQNi3V2u8PQ2cFLPH8`

## Getting started

```bash
npm install
```

### Local development (against Surfpool)

[Surfpool](https://github.com/txtx/surfpool) at `http://127.0.0.1:8899` serves a mainnet clone
that includes ToolboxDAO's real accounts, so you can develop against ground truth. It is the
default `RPC_URL` for local runs.

```bash
npm run dev        # wrangler dev — reads RPC_URL from .dev.vars if present, else defaults to Surfpool
npm test           # Vitest (decoders vs real data, transition engine, Miniflare DO integration, HTTP routes)
npm run typecheck
npm run fixtures   # re-dump on-chain account fixtures from Surfpool into tests/fixtures/accounts.json
```

### Deployment

The account is selected from a gitignored `.env` file, so deploys always hit the right
Cloudflare account without remembering anything:

```bash
# .env (gitignored)
CLOUDFLARE_ACCOUNT_ID=<your-cloudflare-account-id>

npm run deploy     # sources .env, then: wrangler deploy
```

Secrets are stored in Cloudflare, **not** in the repo:

```bash
wrangler secret put WEBHOOK_SECRET        # shared secret used to authenticate Helius deliveries
wrangler secret put RPC_URL               # Helius mainnet RPC (prod)
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_CHAT_ID      # e.g. @channel or a numeric chat id
wrangler secret put DISCORD_WEBHOOK_URL   # optional — enables Discord delivery
```

Environment variables that are not secret can be set as `vars` in `wrangler.jsonc`
(`REALM_NAME`, `REALMS_URL`, `TOKEN_DECIMALS`, the `EVENT_*` toggles, etc.).

### Creating the Helius webhook

Subscribe to the **governance account** (present in every proposal instruction, so you only
pay for ToolboxDAO events):

```bash
curl -X POST "https://api.helius.xyz/v0/webhooks?api-key=$HELIUS_API_KEY" \
  -H 'content-type: application/json' -d '{
    "webhookURL": "https://<your-worker>.workers.dev/webhook",
    "transactionTypes": ["ANY"],
    "accountAddresses": ["5Nn7GMBt1YrPWuzZ7nwY8kBsLkaUhCunnQM9nYaD1MZm"],
    "webhookType": "raw",
    "txnStatus": "success",
    "encoding": "json",
    "authHeader": "<WEBHOOK_SECRET>"
  }'
```

Helius echoes `authHeader` in the `Authorization` header on each delivery; the Worker checks
it against `WEBHOOK_SECRET`.

### Endpoints

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/health` | GET | — | liveness + service info |
| `/status` | GET | secret | DO state (bootstrap status, proposal/seen counts, active voting) |
| `/webhook` | POST | secret | Helius delivery endpoint |
| `/test` | POST | secret | send a test message to Telegram |

## Security

- **No secrets are committed.** API keys, webhook secrets, and tokens live only as Cloudflare
  secrets and a gitignored local `.env`/`.dev.vars`.
- The webhook validates the `Authorization` header before processing.
- Helius deliveries are deduplicated by transaction signature.
- This repo contains only public on-chain data (Solana addresses + account snapshots).

## Project layout

```
src/
  index.ts                Worker: /health, /status, /webhook, /test
  do/GovernanceBotDO.ts   Durable Object: SQLite state, bootstrap, dedup, processing
  engine/engine.ts        pure transition detection
  parse/accounts.ts       hand-rolled borsh decoders (RealmV2/GovernanceV2/ProposalV2)
  parse/events.ts         Helius payload normalization + account extraction
  rpc/rpc.ts              fetch-based JSON-RPC client
  notify/                 Notifier + Telegram + Discord + message formatting
  config.ts               static addresses + config parsing
scripts/generate-fixtures.mjs   fixture dumper against Surfpool (no web3.js)
tests/                   decoders + engine + Miniflare DO integration + HTTP routes + fixtures
```
