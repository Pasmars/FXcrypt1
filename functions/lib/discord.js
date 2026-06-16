// Discord helpers: Ed25519 request verification (Node built-in crypto, no extra
// deps) + REST helpers for deferred-interaction followups. Discord requires an
// ACK within 3s, so the interactions endpoint defers and a Pub/Sub worker edits
// the original response later via the webhook (valid for 15 minutes).
const crypto = require('crypto')
const axios  = require('axios')

const API = 'https://discord.com/api/v10'

// Interaction + response type constants
const T = {
  PING: 1, APP_COMMAND: 2, MESSAGE_COMPONENT: 3,
  PONG: 1, CHANNEL_MESSAGE: 4, DEFERRED_CHANNEL_MESSAGE: 5, DEFERRED_UPDATE_MESSAGE: 6, UPDATE_MESSAGE: 7,
}

// Verify an interaction request signature against the application's public key.
// `rawBody` MUST be the exact bytes Discord sent (req.rawBody), not re-serialized.
function verifyRequest(rawBody, signature, timestamp, publicKeyHex) {
  if (!signature || !timestamp || !publicKeyHex) return false
  try {
    // Wrap the 32-byte raw ed25519 public key in a DER/SPKI envelope so Node can load it.
    const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKeyHex, 'hex')])
    const key = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' })
    const msg = Buffer.concat([Buffer.from(timestamp, 'utf8'), Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody)])
    return crypto.verify(null, msg, key, Buffer.from(signature, 'hex'))
  } catch { return false }
}

// Edit the original (deferred) interaction response.
async function editOriginal(appId, token, payload) {
  await axios.patch(`${API}/webhooks/${appId}/${token}/messages/@original`, payload, { timeout: 12000 })
}

// Discord messages cap at 2000 chars — trim with an ellipsis.
function clamp(text, n = 1900) {
  if (!text) return '…'
  return text.length > n ? text.slice(0, n) + '\n…(truncated)' : text
}

module.exports = { T, verifyRequest, editOriginal, clamp, API }
