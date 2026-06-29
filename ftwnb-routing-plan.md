# Plan: Route women-only ride calls to `#ftwnb`

**Goal:** When a Strava club ride is **women-only**, post its ride call to the
`#ftwnb` channel (in addition to / instead of `#ride-calls-only`).

---

## 1. The signal we'll use: `women_only`

The raw Strava `/group_events` payload includes a boolean **`women_only`** on
every event — confirmed in production diagnostics. Examples from the live club
data:

| Title | `women_only` |
|---|---|
| `FTWNB Wildcard` | `true` |
| `FCC: FTWNB City Loop` (Jul 13) | `true` |
| `FTWNB Mondays` | `true` |
| `FTWNB+ & Allies Ride p/b Bicycle Law` | `false` |
| `FCC: FTWNB City Loop` (Jun 22) | `false` |
| `FCC: Breadbelly` | `false` |

**Use the `women_only` flag, not the title.** The data shows the title is an
unreliable signal: `FTWNB+ & Allies` is `women_only=false`, and the same
`FCC: FTWNB City Loop` event appears once as `false` and once as `true`. The
boolean is the source of truth; "FTWNB" in the title is just branding.

> Optional hardening: also treat a title match (`/ftwnb|women'?s? only/i`) as a
> fallback signal, behind a config flag, in case an organizer forgets to tick
> the women-only box. Off by default — start by trusting the flag.

---

## 2. Open decision (needs your call)

When a ride is women-only, should it post to:

- **(A) `#ftwnb` only** — keep women-only rides off the general channel.
- **(B) both `#ride-calls-only` and `#ftwnb`** — general channel still sees every ride; `#ftwnb` gets an additional copy of the women-only ones.

The phrasing "post to `#ftwnb` when women only" reads most naturally as **(A)**,
but it's a community/visibility decision. The implementation below is written so
this is a **one-line routing change** either way (`destinationsFor(event)`).

Recommended default: **(A)** — women-only rides go to `#ftwnb` only; everything
else goes to `#ride-calls-only`.

---

## 3. Why a second webhook is required

Slack incoming webhooks are **bound to a single channel at creation**. The
existing `SLACK_WEBHOOK_URL` can only ever post to `#ride-calls-only`. To reach
`#ftwnb` we must create a **second incoming webhook** bound to `#ftwnb` and store
it as a new secret. (Same Slack app, just "Add New Webhook to Workspace" again.)

---

## 4. Implementation steps

### 4.1 Slack setup
- In the existing Slack app → **Incoming Webhooks** → **Add New Webhook to
  Workspace** → select **`#ftwnb`** → copy the URL.
- Add GitHub secret **`SLACK_WEBHOOK_URL_FTWNB`**.

### 4.2 `src/config.ts`
Add the second webhook (optional so the bot still runs if it's unset):
```ts
slack: {
  webhookUrl: required('SLACK_WEBHOOK_URL'),          // #ride-calls-only
  ftwnbWebhookUrl: process.env.SLACK_WEBHOOK_URL_FTWNB || undefined, // #ftwnb
  channel: process.env.SLACK_CHANNEL || undefined,
},
```

### 4.3 `src/types.ts`
Add `womenOnly` to the domain model and map it:
```ts
// StravaGroupEventRaw
women_only?: boolean;

// GroupEvent
womenOnly: boolean;

// toGroupEvent(...)
womenOnly: Boolean(raw.women_only),
```

### 4.4 `src/slack.ts`
Make the webhook a parameter instead of a module singleton, and add a router:
```ts
import { IncomingWebhook } from '@slack/webhook';
import { config } from './config';

const general = new IncomingWebhook(config.slack.webhookUrl);
const ftwnb = config.slack.ftwnbWebhookUrl
  ? new IncomingWebhook(config.slack.ftwnbWebhookUrl)
  : null;

/** Which channels should this ride be announced to. */
export function destinationsFor(event: GroupEvent): IncomingWebhook[] {
  if (event.womenOnly) {
    // Option A: ftwnb only (fall back to general if ftwnb webhook missing).
    return ftwnb ? [ftwnb] : [general];
    // Option B (both): return ftwnb ? [general, ftwnb] : [general];
  }
  return [general];
}

export async function postToSlack(event: GroupEvent, occurrenceIso: string): Promise<void> {
  const payload = formatRideMessage(event, occurrenceIso);
  for (const hook of destinationsFor(event)) {
    await hook.send(payload);
  }
  console.log(`✅ Posted "${event.title}" → ${destinationsFor(event).length} channel(s)`);
}
```
- `postFailureNotice()` keeps using `general` only (#ride-calls-only) — ops
  noise shouldn't land in `#ftwnb`.
- If you want the `#ftwnb` post to read slightly differently (e.g. header
  `🚲 FTWNB ride tomorrow`), pass a variant flag into `formatRideMessage`.
  Otherwise the same message is fine.

### 4.5 `src/index.ts`
No change to the orchestrator loop — it already calls
`postToSlack(event, occurrence)`. Routing is now internal to `postToSlack`.

### 4.6 `.github/workflows/notify.yml`
Add the secret to the env block:
```yaml
SLACK_WEBHOOK_URL_FTWNB: ${{ secrets.SLACK_WEBHOOK_URL_FTWNB }}
```

### 4.7 `.env.example`
```bash
SLACK_WEBHOOK_URL_FTWNB=https://hooks.slack.com/services/...  # bound to #ftwnb
```

---

## 5. Edge cases & notes
- **Missing `#ftwnb` webhook:** the bot degrades gracefully — women-only rides
  fall back to `#ride-calls-only` (Option A) so nothing is silently dropped.
- **No dedup needed:** still one post per channel per day; the narrow
  "tomorrow" window guarantees a single fire.
- **Failure notices** stay on `#ride-calls-only` only.
- **Title-only "FTWNB" rides with `women_only=false`** (e.g. `FTWNB+ & Allies`)
  will route to the general channel by design — confirm that's intended, or
  enable the optional title-fallback in §1.

---

## 6. Test plan
1. Add the `SLACK_WEBHOOK_URL_FTWNB` secret.
2. Temporarily extend the debug `TEST_POST` path (or widen the window) to post
   one known women-only event (e.g. `FTWNB Wildcard`) and confirm it lands in
   `#ftwnb` and **not** `#ride-calls-only` (Option A).
3. Confirm a non-women-only event still posts only to `#ride-calls-only`.
4. Remove the test shim.

---

## 7. Effort
Small — ~30 minutes. One new secret, ~15 lines across `config.ts`, `types.ts`,
`slack.ts`, plus the workflow env line. The orchestrator and scheduling are
untouched.
```
