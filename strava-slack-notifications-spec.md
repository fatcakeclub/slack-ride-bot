# Strava → Slack Ride Notification System
## Engineering Specification

**Club:** Fat Cake Club (Strava ID: `40422`)
**Slack:** Fat Cake workspace → `#ride-calls-only`
**Purpose:** Post a ride announcement to Slack **the day before** each club ride, **around noon PT**, linking to the Strava event
**Platform:** GitHub Actions (cron)
**Last updated:** 2026-06-28

---

## 1. Overview

Once a day, around noon Pacific, the system fetches the Fat Cake Club's upcoming group events from Strava and posts a Slack announcement for any ride happening **the next calendar day**. Each ride therefore gets exactly one "ride call" the afternoon before, with a button linking straight to the Strava event.

### Design decisions

- **Trigger:** GitHub Actions cron, daily, targeting ~noon America/Los_Angeles.
- **Filter:** only events whose `upcoming_occurrence` lands on *tomorrow* (LA calendar day). This narrow window means each event matches on exactly one run.
- **No dedup store.** Because the window is a single calendar day and the job runs once daily, each event is posted once naturally. This removes the Redis/SQLite dependency from the original design. (See §11 for the one caveat — manual re-runs.)

### High-Level Flow

```
[GitHub Actions cron — daily ~noon PT]
     │
     ▼
[Guard: is it actually the noon hour in LA? (DST-safe)] ──no──▶ exit 0 (no-op)
     │ yes
     ▼
[Refresh Strava access token]
     │
     ▼
[Fetch club group_events from Strava REST API]
     │
     ▼
[Filter: occurrence is tomorrow (America/Los_Angeles)]
     │
     ▼
[Format Slack Block Kit message per ride]
     │
     ▼
[POST to #ride-calls-only via Slack Incoming Webhook]
```

---

## 2. Architecture

### Components

| Component | Technology | Purpose |
|---|---|---|
| Scheduler | GitHub Actions (cron) | Triggers the notification job daily |
| Notification Service | Node.js (TypeScript) script | Orchestrates guard → fetch → filter → post |
| Strava Data Source | Strava REST API (`/clubs/{id}/group_events`) | Supplies upcoming ride events |
| Notification Sink | Slack Incoming Webhook → `#ride-calls-only` | Delivers formatted messages |

No persistent state store is required.

### Why GitHub Actions

Zero infrastructure, free, secrets management built in, and one call per day is well within Strava's rate limits. The one wrinkle — GitHub cron is UTC-only and does not follow daylight saving — is handled in software (see §3).

> **AWS alternative (not the chosen path).** If exact noon-PT timing ever matters more than simplicity, AWS EventBridge Scheduler supports timezone-aware cron (`America/Los_Angeles`) and fires at noon local year-round with no DST workaround, invoking a Lambda that runs the same `run()` logic. Secrets live in SSM Parameter Store / Secrets Manager. This trades the DST guard below for more setup (Lambda, IAM role, secret wiring).

---

## 3. Scheduling — "the day before, around noon"

### The DST problem

GitHub Actions cron is evaluated in **UTC** and ignores daylight saving. Noon Pacific is:

- `19:00 UTC` during PDT (summer, UTC−7)
- `20:00 UTC` during PST (winter, UTC−8)

A single fixed UTC cron would drift an hour off "noon" for half the year.

### Solution: fire on both hours, gate in code

Schedule the workflow at **both** `19:00` and `20:00 UTC`, then have the script no-op unless the current LA hour is actually 12. Exactly one of the two daily runs survives the guard year-round.

```typescript
// src/time.ts
const TZ = 'America/Los_Angeles';

export function laHour(now = new Date()): number {
  return parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      hour: '2-digit',
      hour12: false,
    }).format(now),
    10
  );
}

/** True only during the noon hour in LA — DST-safe gate for the cron. */
export function isNoonHourLA(now = new Date()): boolean {
  return laHour(now) === 12;
}
```

> Set the env var `SKIP_NOON_GUARD=1` for `workflow_dispatch` test runs so you can trigger manually at any time of day.

---

## 4. Strava Integration

### Authentication

The Strava REST API authenticates via OAuth 2.0. For a headless cron job you need service credentials (the interactive Strava MCP connection in Claude is not usable from CI).

**One-time setup:**
1. Go to [strava.com/settings/api](https://www.strava.com/settings/api) and create an API Application.
2. Note your `client_id` and `client_secret`.
3. Perform the OAuth authorization-code flow once manually to obtain a `refresh_token` (scope: `read`).
4. Store `client_id`, `client_secret`, and `refresh_token` as GitHub Actions secrets.
5. At runtime, exchange the refresh token for a fresh `access_token` before fetching.

**Token refresh (before every run):**

```typescript
// src/strava.ts
export async function getAccessToken(): Promise<string> {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      refresh_token: process.env.STRAVA_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Strava token refresh failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  // Strava may rotate the refresh token — persist it (see §11 gotcha).
  if (data.refresh_token && data.refresh_token !== process.env.STRAVA_REFRESH_TOKEN) {
    await persistRefreshToken(data.refresh_token);
  }
  return data.access_token;
}
```

### Fetching Club Events

```
GET https://www.strava.com/api/v3/clubs/40422/group_events
Authorization: Bearer {access_token}
```

**Response shape (per event):**

```typescript
// src/types.ts
export interface StravaGroupEvent {
  id: number;
  title: string;
  description?: string;
  activity_type: string;        // e.g. "Ride"
  upcoming_occurrence: string;  // ISO 8601 datetime of the next occurrence
  address?: string;
  lat?: number;
  lng?: number;
  route_ids?: number[];
  club_id: number;
}
```

```typescript
// src/strava.ts
export async function fetchUpcomingEvents(accessToken: string): Promise<StravaGroupEvent[]> {
  const res = await fetch('https://www.strava.com/api/v3/clubs/40422/group_events', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Strava API error: ${res.status} ${await res.text()}`);
  return res.json();
}
```

> `/group_events` returns recurring events with their next `upcoming_occurrence` already computed — no recurrence-rule handling needed.

---

## 5. Notification Logic — "is this ride tomorrow?"

Post a Slack message for each event whose `upcoming_occurrence` falls on the **next calendar day in America/Los_Angeles**.

```typescript
// src/filter.ts
const TZ = 'America/Los_Angeles';

/** YYYY-MM-DD for a date, evaluated in LA time. */
function laDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** True if the event occurs on tomorrow's LA calendar day. */
export function isTomorrowLA(event: StravaGroupEvent, now = new Date()): boolean {
  const occurrenceDay = laDay(new Date(event.upcoming_occurrence));
  const tomorrowDay = laDay(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  return occurrenceDay === tomorrowDay;
}
```

Because the job runs around noon LA, `now + 24h` is noon tomorrow LA — the same calendar day as any ride happening tomorrow, so the comparison is robust across DST boundaries.

---

## 6. Slack Integration

### Setup

1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → From Scratch, in the **Fat Cake** workspace.
2. Add the **Incoming Webhooks** feature and activate it.
3. **Add New Webhook to Workspace** → select **`#ride-calls-only`**.
4. Copy the webhook URL (`https://hooks.slack.com/services/T.../B.../...`).
5. Store it as the `SLACK_WEBHOOK_URL` secret. (The webhook is bound to `#ride-calls-only`, so the channel is fixed at creation time — no channel field needed in the payload.)

### Message Format (Block Kit)

```typescript
// src/slack.ts
import type { IncomingWebhookSendArguments } from '@slack/webhook';

const TZ = 'America/Los_Angeles';

export function formatRideMessage(event: StravaGroupEvent): IncomingWebhookSendArguments {
  const date = new Date(event.upcoming_occurrence);

  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: TZ,
  });
  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: TZ,
  });

  const activityEmoji: Record<string, string> = {
    Ride: '🚴', GravelRide: '🚵', MountainBikeRide: '⛰️', VirtualRide: '🖥️',
  };
  const emoji = activityEmoji[event.activity_type] ?? '🚴';

  const stravaUrl = `https://www.strava.com/clubs/40422/group_events/${event.id}`;

  const shortDesc = event.description
    ? event.description.length > 300
      ? event.description.slice(0, 297) + '...'
      : event.description
    : null;

  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${emoji} Tomorrow: ${event.title}`, emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*📅 Date*\n${dateStr}` },
        { type: 'mrkdwn', text: `*⏰ Time*\n${timeStr}` },
      ],
    },
  ];

  if (event.address) {
    blocks.push({
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*📍 Meet*\n${event.address}` },
        { type: 'mrkdwn', text: `*🏃 Type*\n${event.activity_type}` },
      ],
    });
  }

  if (shortDesc) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: shortDesc } });
  }

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: 'View on Strava', emoji: true },
        url: stravaUrl,
        style: 'primary',
      },
    ],
  });

  return {
    text: `${emoji} Ride call — ${event.title} tomorrow (${dateStr})`,
    blocks,
  };
}
```

### Posting

```typescript
// src/slack.ts
import { IncomingWebhook } from '@slack/webhook';

const webhook = new IncomingWebhook(process.env.SLACK_WEBHOOK_URL!);

export async function postToSlack(event: StravaGroupEvent): Promise<void> {
  await webhook.send(formatRideMessage(event));
  console.log(`✅ Posted ride call: ${event.title} (${event.upcoming_occurrence})`);
}
```

---

## 7. Main Orchestrator

```typescript
// src/index.ts
import { isNoonHourLA } from './time';
import { getAccessToken, fetchUpcomingEvents } from './strava';
import { isTomorrowLA } from './filter';
import { postToSlack } from './slack';
import { withRetry } from './retry';

async function run() {
  console.log(`[${new Date().toISOString()}] Strava → Slack ride-call run`);

  if (!process.env.SKIP_NOON_GUARD && !isNoonHourLA()) {
    console.log('Not the noon hour in LA — skipping this trigger.');
    return;
  }

  const accessToken = await getAccessToken();
  const events = await withRetry(() => fetchUpcomingEvents(accessToken));
  console.log(`Fetched ${events.length} club events`);

  const ridesTomorrow = events.filter((e) => isTomorrowLA(e));
  console.log(`${ridesTomorrow.length} ride(s) happening tomorrow`);

  for (const event of ridesTomorrow) {
    await withRetry(() => postToSlack(event));
    await new Promise((r) => setTimeout(r, 500)); // gentle on Slack rate limits
  }

  console.log('Run complete');
}

run().catch(async (err) => {
  console.error('Fatal error:', err);
  try {
    const { IncomingWebhook } = await import('@slack/webhook');
    await new IncomingWebhook(process.env.SLACK_WEBHOOK_URL!).send({
      text: `⚠️ Strava ride-call job failed: \`${err.message}\``,
    });
  } catch {}
  process.exit(1);
});
```

---

## 8. Project Structure

```
slack-ride-bot/
├── src/
│   ├── index.ts          # Orchestrator (guard → fetch → filter → post)
│   ├── config.ts         # Validated env-var configuration
│   ├── time.ts           # LA timezone / noon-hour guard
│   ├── strava.ts         # Token refresh + group_events fetch
│   ├── filter.ts         # isTomorrowLA
│   ├── slack.ts          # Webhook + Block Kit formatter
│   ├── retry.ts          # withRetry helper
│   └── types.ts          # Raw wire type + camelCase domain model + mapper
├── .github/
│   └── workflows/
│       └── notify.yml    # GitHub Actions cron workflow
├── package.json
├── tsconfig.json
└── .env.example
```

---

## 9. GitHub Actions Workflow

```yaml
# .github/workflows/notify.yml
name: Strava Ride Call Notifications

on:
  schedule:
    # Daily, at both candidate "noon PT" hours. The script's noon-hour
    # guard ensures exactly one run proceeds year-round (DST-safe).
    - cron: '0 19 * * *'   # noon PDT (summer)
    - cron: '0 20 * * *'   # noon PST (winter)
  workflow_dispatch:        # Manual test runs

jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run build
      - name: Run notifier
        env:
          STRAVA_CLIENT_ID: ${{ secrets.STRAVA_CLIENT_ID }}
          STRAVA_CLIENT_SECRET: ${{ secrets.STRAVA_CLIENT_SECRET }}
          STRAVA_REFRESH_TOKEN: ${{ secrets.STRAVA_REFRESH_TOKEN }}
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
          # On manual dispatch, bypass the noon guard so you can test any time:
          SKIP_NOON_GUARD: ${{ github.event_name == 'workflow_dispatch' && '1' || '' }}
        run: npm start
```

> **Note on GitHub cron reliability:** scheduled workflows can be delayed several minutes (or skipped under heavy load) on the free tier. For a "the afternoon before" ride call this slack is acceptable. If precise timing becomes important, switch to the AWS EventBridge alternative in §2.

---

## 10. Configuration

### Environment Variables

```bash
# .env.example

# Strava
STRAVA_CLUB_ID=40422
STRAVA_CLIENT_ID=your_client_id
STRAVA_CLIENT_SECRET=your_client_secret
STRAVA_REFRESH_TOKEN=your_initial_refresh_token

# Slack
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
# Intended channel, e.g. #ride-calls-only. Modern incoming webhooks are bound
# to a channel at creation and ignore this; set it for legacy webhooks.
SLACK_CHANNEL=#ride-calls-only

# Testing only — bypass the noon-hour guard
SKIP_NOON_GUARD=
```

> **Secrets vs. variables in GitHub Actions:** put `STRAVA_CLUB_ID` and
> `SLACK_CHANNEL` under **Variables** (non-sensitive, referenced via `vars.*`)
> and the credentials/webhook under **Secrets** (`secrets.*`). All non-secret
> config is read through `src/config.ts`, which fails fast on missing values.

### package.json

```json
{
  "name": "slack-ride-bot",
  "version": "1.0.0",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node src/index.ts"
  },
  "dependencies": {
    "@slack/webhook": "^7.0.2"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.4.0"
  }
}
```

(The `@upstash/redis` dependency from the original design is gone — no dedup store.)

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"]
}
```

### retry.ts

```typescript
export async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 1000): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`Attempt ${attempt} failed, retrying in ${delayMs * attempt}ms...`);
      await new Promise((r) => setTimeout(r, delayMs * attempt));
    }
  }
  throw new Error('Unreachable');
}
```

---

## 11. Known Limitations & Gotchas

- **Manual re-runs can double-post.** With no dedup store, triggering `workflow_dispatch` twice on the same day (with the guard skipped) posts each tomorrow-ride twice. This is the deliberate tradeoff for dropping Redis. If it becomes a problem, the cheapest guard is a GitHub Actions cache/artifact keyed by `event.id:occurrence`, or re-introduce a tiny KV store.
- **Strava refresh-token rotation.** Strava may issue a new refresh token on each exchange. `persistRefreshToken()` must write it back to the GitHub secret (via the GitHub REST API with a PAT) or to an external secret store — otherwise the job breaks after the token rotates. This is the single most likely cause of a silent failure; wire it up before going live.
- **GitHub cron drift/skips.** Scheduled runs may be delayed or dropped under platform load. Acceptable for an afternoon-before ride call; not for time-critical alerts.
- **Timezone correctness.** All date logic explicitly uses `America/Los_Angeles`. Never rely on the runner's local time (GitHub runners are UTC).
- **Block Kit limits.** Section text maxes at 3,000 chars; the 300-char description truncation stays well under.
- **No ride tomorrow = silent run.** On days with no rides the job exits cleanly without posting. The failure webhook only fires on actual errors.

---

## 12. Setup Checklist

- [ ] Create the repo from this spec; `npm install`
- [ ] Create a Strava API application; complete the one-time OAuth flow to get a `refresh_token` (scope `read`)
- [ ] Build `persistRefreshToken()` to write rotated tokens back to the GitHub secret (GitHub REST API + PAT) — **don't skip this**
- [ ] Create a Slack app in the **Fat Cake** workspace with Incoming Webhooks; bind the webhook to **`#ride-calls-only`**; copy the URL
- [ ] Populate `.env`; run `SKIP_NOON_GUARD=1 npm run dev` and confirm a message lands in `#ride-calls-only`
- [ ] Add all secrets to GitHub (Settings → Secrets → Actions)
- [ ] Trigger `workflow_dispatch` to confirm end-to-end
- [ ] Confirm both cron lines are active; verify the next real noon-PT run posts (and the off-hour trigger no-ops)

---

## 13. Future Extensions

- **Weekly digest** on Sunday evening listing the full week's rides (additive to the daily ride call).
- **Map links / weather** appended when `lat`/`lng` are present on the event.
- **Multi-channel routing** by `activity_type` if road and gravel ever want separate channels.
