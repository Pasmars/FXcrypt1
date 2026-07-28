// appcheck.js — monitor-only App Check adoption tracking.
//
// Turning on enforcement is a one-way door: the moment it is on, every caller
// without a valid attestation token gets rejected. That includes users still
// running a cached bundle from before App Check shipped, and any surface that
// was never wired up. Flipping it blind means an instant, total outage.
//
// So enforcement stays OFF until the numbers say it is safe. Callables record
// whether `context.app` was present; `withToken` climbing to ~100% of the total
// is the signal that every live client is attesting and enforcement can be
// enabled. Surfaced in adminStats as `appCheck`.
//
// Sampled, because this must not add a Firestore write to every request.

const SAMPLE_RATE = 0.05 // 5% — plenty to see the ratio, negligible cost

function day() { return new Date().toISOString().slice(0, 10) }

// Fire-and-forget: never awaited by callers, never throws into a request.
function note(db, admin, context) {
  try {
    if (Math.random() > SAMPLE_RATE) return
    const field = context && context.app ? 'withToken' : 'withoutToken'
    db.doc(`appCheckStats/${day()}`)
      .set({ [field]: admin.firestore.FieldValue.increment(1) }, { merge: true })
      .catch(() => {})
  } catch (_) { /* telemetry only */ }
}

// 30-day rollup for the admin panel: what fraction of sampled calls attested.
async function stats(db) {
  const out = { withToken: 0, withoutToken: 0, pct: null, days: 0 }
  try {
    const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
    const admin = require('firebase-admin')
    const snap = await db.collection('appCheckStats')
      .where(admin.firestore.FieldPath.documentId(), '>=', since).get()
    snap.forEach((doc) => {
      const d = doc.data()
      out.withToken += d.withToken || 0
      out.withoutToken += d.withoutToken || 0
      out.days++
    })
    const total = out.withToken + out.withoutToken
    // pct === 100 across a few days of real traffic ⇒ safe to enforce.
    if (total > 0) out.pct = +((100 * out.withToken) / total).toFixed(1)
  } catch (_) { /* best-effort */ }
  return out
}

module.exports = { note, stats, SAMPLE_RATE }
