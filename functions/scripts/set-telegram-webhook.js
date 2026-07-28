#!/usr/bin/env node
// Registers the Telegram webhook WITH a secret_token.
//
// The telegramWebhook function is a public URL, so it authenticates every
// delivery against this token (Telegram sends it back in the
// X-Telegram-Bot-Api-Secret-Token header). Until the webhook is registered with
// the matching value, every update is rejected with 401 — so run this once
// after deploying, and again whenever BOT_SECRET is rotated.
//
// Usage (values come from Secret Manager — never hardcode them):
//   BOT_SECRET=... TELEGRAM_TOKEN=... node functions/scripts/set-telegram-webhook.js
//
// Read the current secret values with:
//   firebase functions:secrets:access BOT_SECRET
//   firebase functions:secrets:access TELEGRAM_TOKEN

const crypto = require('crypto')

const BOT_SECRET = process.env.BOT_SECRET
const TG_TOKEN   = process.env.TELEGRAM_TOKEN
const PROJECT    = process.env.GCLOUD_PROJECT || 'pnl-calculator'
const REGION     = 'europe-west1'

if (!BOT_SECRET || !TG_TOKEN) {
  console.error('Set BOT_SECRET and TELEGRAM_TOKEN in the environment first.')
  process.exit(1)
}

// Must match webhookSecret() in functions/index.js exactly.
const secretToken = crypto.createHmac('sha256', BOT_SECRET).update('telegram-webhook-v1').digest('hex')
const url = `https://${REGION}-${PROJECT}.cloudfunctions.net/telegramWebhook`

async function main() {
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      secret_token: secretToken,
      // Drop anything queued while the webhook was unauthenticated.
      drop_pending_updates: true,
      allowed_updates: ['message', 'callback_query'],
    }),
  })
  const json = await res.json()
  if (!json.ok) { console.error('setWebhook failed:', json); process.exit(1) }
  console.log('Webhook registered with secret_token →', url)
}

main().catch((e) => { console.error(e); process.exit(1) })
