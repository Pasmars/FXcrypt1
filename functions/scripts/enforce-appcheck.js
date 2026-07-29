#!/usr/bin/env node
// Enforce App Check — with the safety gates that make it survivable.
//
// Enforcement is a one-way door with an immediate blast radius: the moment it is
// on, every caller without a valid attestation token is rejected. That includes
// users still running a bundle cached from before App Check shipped, and it
// includes the admin panel if its site key was never filled in — which would
// lock you out of the very console you would use to undo it.
//
// So this script refuses to enforce until the evidence says it is safe:
//   1. both clients actually carry a site key
//   2. sampled adoption (adminStats.appCheck) reads 100% over real traffic
//
// Usage:
//   node functions/scripts/enforce-appcheck.js --check     # report only (default)
//   node functions/scripts/enforce-appcheck.js --enforce   # flip, if gates pass
//   node functions/scripts/enforce-appcheck.js --revert    # back to UNENFORCED
//   ... --force        skip the adoption gate (you had better have a reason)
//   ... --only=firestore,identitytoolkit
//
// Auth: reuses the Firebase CLI's existing login (no extra credentials).

const fs = require('fs')
const path = require('path')
const os = require('os')

const PROJECT = 'pnl-calculator'
// Public OAuth client shipped inside firebase-tools.
const CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com'
const CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi'

// identitytoolkit is listed last on purpose: enforcing it gates SIGN-IN itself,
// so it is the one most likely to lock real users out. Cloud Functions callables
// are NOT here — those are enforced by APPCHECK_ENFORCE at deploy time.
const SERVICES = ['firestore.googleapis.com', 'identitytoolkit.googleapis.com']

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const only = (args.find((a) => a.startsWith('--only=')) || '').replace('--only=', '')
const MODE = has('--enforce') ? 'enforce' : has('--revert') ? 'revert' : 'check'

function repoFile(p) { return path.resolve(__dirname, '../..', p) }

// ── Gate 1: do the clients actually carry a site key? ──
function siteKeyState() {
  const targets = [
    ['shared/lib/firebase.ts', /APP_CHECK_SITE_KEY\s*=\s*'([^']*)'/],
    ['admin/index.html', /APP_CHECK_SITE_KEY\s*=\s*'([^']*)'/],
  ]
  const out = []
  for (const [rel, re] of targets) {
    let key = null
    try { const m = re.exec(fs.readFileSync(repoFile(rel), 'utf8')); key = m ? m[1] : null } catch (_) {}
    out.push({ file: rel, set: !!(key && key.trim()) })
  }
  return out
}

async function accessToken() {
  const cfgPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json')
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
  const body = new URLSearchParams({
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    refresh_token: cfg.tokens.refresh_token, grant_type: 'refresh_token',
  })
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  })
  const j = await r.json()
  if (!j.access_token) throw new Error('Could not refresh the Firebase CLI token — run `firebase login` first.')
  return j.access_token
}

async function currentModes(token) {
  const r = await fetch(`https://firebaseappcheck.googleapis.com/v1/projects/${PROJECT}/services`, {
    headers: { Authorization: 'Bearer ' + token },
  })
  const j = await r.json()
  if (j.error) throw new Error(j.error.message)
  const map = {}
  for (const s of j.services || []) map[s.name.split('/').pop()] = s.enforcementMode || 'UNENFORCED'
  return map
}

// Callable enforcement is not a service-level setting — it is the
// enforceAppCheck runtime option, driven by APPCHECK_ENFORCE on the deployed
// function. Sample one representative callable to report the live truth.
async function callableEnforcement(token) {
  try {
    const r = await fetch(
      `https://cloudfunctions.googleapis.com/v1/projects/${PROJECT}/locations/europe-west1/functions/getBalances`,
      { headers: { Authorization: 'Bearer ' + token } }
    )
    const j = await r.json()
    if (j.error) return `unknown (${j.error.code})`
    const v = (j.environmentVariables || {}).APPCHECK_ENFORCE
    return v === 'true'
      ? 'ENFORCED (APPCHECK_ENFORCE=true on deployed fns)'
      : 'UNENFORCED (set APPCHECK_ENFORCE=true in functions/.env and redeploy)'
  } catch (e) { return 'unknown (' + e.message.slice(0, 40) + ')' }
}

async function setMode(token, service, mode) {
  const url = `https://firebaseappcheck.googleapis.com/v1/projects/${PROJECT}/services/${service}?updateMask=enforcementMode`
  const r = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `projects/${PROJECT}/services/${service}`, enforcementMode: mode }),
  })
  const j = await r.json()
  if (j.error) throw new Error(`${service}: ${j.error.message}`)
  return j.enforcementMode
}

// ── Gate 2: is every live client actually attesting? ──
// Reads the sampled counters lib/appcheck.js writes. pct must be 100: anything
// less is a measured fraction of real users who would be locked out.
async function adoption() {
  const admin = require('firebase-admin')
  if (!admin.apps.length) {
    // Prefer ADC; fall back to the gateway's service account key so this works
    // on a machine that has never run `gcloud auth application-default login`.
    let cred = null
    try {
      const dir = path.resolve(__dirname, '../discord-gateway')
      const f = fs.readdirSync(dir).find((n) => /-firebase-adminsdk-.*\.json$/.test(n))
      if (f) cred = admin.credential.cert(require(path.join(dir, f)))
    } catch (_) {}
    admin.initializeApp(cred ? { credential: cred, projectId: PROJECT } : { projectId: PROJECT })
  }
  const db = admin.firestore()
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const snap = await db.collection('appCheckStats')
    .where(admin.firestore.FieldPath.documentId(), '>=', since).get()
  let withToken = 0, withoutToken = 0, days = 0
  snap.forEach((d) => { const x = d.data(); withToken += x.withToken || 0; withoutToken += x.withoutToken || 0; days++ })
  const total = withToken + withoutToken
  return { withToken, withoutToken, total, days, pct: total ? +((100 * withToken) / total).toFixed(1) : null }
}

async function main() {
  console.log(`App Check — project ${PROJECT}\n`)

  const keys = siteKeyState()
  console.log('Site keys in clients:')
  for (const k of keys) console.log(`  ${k.set ? 'set    ' : 'MISSING'}  ${k.file}`)
  const keysReady = keys.every((k) => k.set)

  const token = await accessToken()
  const modes = await currentModes(token)
  console.log('\nCurrent enforcement:')
  for (const s of SERVICES) console.log(`  ${s.padEnd(34)} ${modes[s] || 'UNENFORCED'}`)
  // Read the DEPLOYED function's env, not this shell's. Reporting the local
  // value was actively misleading: it says UNENFORCED on a machine that simply
  // doesn't export the flag, while production is enforcing (or the reverse).
  console.log(`  ${'cloud functions (callables)'.padEnd(34)} ${await callableEnforcement(token)}`)

  let ad = null
  try {
    ad = await adoption()
    console.log('\nAdoption (sampled, 30d):')
    console.log(`  attested ${ad.withToken} / ${ad.total} sampled calls over ${ad.days} day(s)` + (ad.pct === null ? '' : ` -> ${ad.pct}%`))
  } catch (e) {
    console.log('\nAdoption: could not read appCheckStats (' + e.message.slice(0, 80) + ')')
  }

  if (MODE === 'check') {
    console.log('\nReport only. Re-run with --enforce to apply, --revert to roll back.')
    return
  }

  if (MODE === 'revert') {
    const targets = only ? only.split(',').map((s) => (s.includes('.') ? s : s + '.googleapis.com')) : SERVICES
    for (const s of targets) console.log(`  ${s} -> ${await setMode(token, s, 'UNENFORCED')}`)
    console.log('\nReverted. Also unset APPCHECK_ENFORCE and redeploy functions if it was set.')
    return
  }

  // MODE === 'enforce' — gates
  // A percentage means nothing without volume behind it. Enforcement was once
  // turned on here against 3 sampled calls reading "100%" — all of them from a
  // verification script, none from a real user's browser. Real users then hit
  // auth/internal-error. Hence a floor on sample count AND on days: reCAPTCHA is
  // blocked outright by plenty of privacy extensions and corporate proxies, and
  // only genuine traffic across more than one day reveals that.
  const MIN_SAMPLES = 200
  const MIN_DAYS = 2

  const problems = []
  if (!keysReady) problems.push('a client is missing its site key: it would be rejected the moment enforcement starts')
  if (!ad || ad.total === 0) problems.push('no adoption data yet: nothing proves any client is attesting')
  else {
    if (ad.pct !== 100) problems.push(`adoption is ${ad.pct}% — the remaining ${(100 - ad.pct).toFixed(1)}% of real traffic would start failing`)
    if (ad.total < MIN_SAMPLES) problems.push(`only ${ad.total} sampled calls (need ${MIN_SAMPLES}); a clean percentage over a handful of calls is not evidence`)
    if (ad.days < MIN_DAYS) problems.push(`only ${ad.days} day(s) of data (need ${MIN_DAYS}); one day can be a single browser`)
  }

  if (problems.length && !has('--force')) {
    console.log('\nREFUSING to enforce:')
    for (const p of problems) console.log('  - ' + p)
    console.log('\nFix those, or pass --force if you accept the outage risk.')
    process.exitCode = 1
    return
  }
  if (problems.length) console.log('\n--force given; proceeding despite:\n  - ' + problems.join('\n  - '))

  const targets = only ? only.split(',').map((s) => (s.includes('.') ? s : s + '.googleapis.com')) : SERVICES
  console.log('\nEnforcing:')
  for (const s of targets) console.log(`  ${s} -> ${await setMode(token, s, 'ENFORCED')}`)
  console.log('\nFor the callables, set APPCHECK_ENFORCE=true and redeploy functions.')
  console.log('Roll back at any time with: node functions/scripts/enforce-appcheck.js --revert')
}

main().catch((e) => { console.error('failed:', e.message); process.exit(1) })
