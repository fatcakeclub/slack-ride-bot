// Exchange a read_all authorization code and store the resulting refresh token
// directly into the GitHub Actions secret STRAVA_REFRESH_TOKEN.
// The refresh token is NEVER printed.
//
// Usage:
//   STRAVA_CLIENT_SECRET=xxx node scripts/capture-refresh-token.mjs '<redirect URL or code>'

import { execFileSync } from 'node:child_process';

const CLIENT_ID = process.env.STRAVA_CLIENT_ID || '191988';
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const REPO = 'fatcakeclub/slack-ride-bot';
const SECRET_NAME = 'STRAVA_REFRESH_TOKEN';
const arg = process.argv[2] || '';

if (!CLIENT_SECRET) {
  console.error('Set STRAVA_CLIENT_SECRET in the environment.');
  process.exit(1);
}

let code = arg;
try {
  if (arg.includes('://')) code = new URL(arg).searchParams.get('code') || arg;
} catch {}
if (!code) {
  console.error('Pass the redirect URL (or the code) as the argument.');
  process.exit(1);
}

const res = await fetch('https://www.strava.com/oauth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code,
    grant_type: 'authorization_code',
  }),
});
const token = await res.json();
if (!res.ok) {
  console.error('Token exchange failed:', res.status, JSON.stringify(token));
  process.exit(1);
}

console.log('Granted scope:', token.scope);
if (!String(token.scope).split(/[ ,]/).includes('read_all')) {
  console.error('❌ Scope does not include read_all — re-authorize with scope=read,read_all. Secret NOT updated.');
  process.exit(1);
}
if (!token.refresh_token) {
  console.error('❌ No refresh_token in response. Secret NOT updated.');
  process.exit(1);
}

execFileSync('gh', ['secret', 'set', SECRET_NAME, '-R', REPO], { input: token.refresh_token });
console.log(`✅ ${SECRET_NAME} updated in ${REPO} (read_all). Refresh token not printed.`);
