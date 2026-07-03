// metering.js — per-user usage metering for Pointer (AI) requests and gem scans.
//
// Model (fields on users/{uid}):
//   pointerUsage / gemScanUsage : { period:'YYYY-MM', used:N }  monthly counter
//   pointerCredits              : N  non-expiring credits (spent AFTER the monthly
//                                     plan allowance is exhausted)
//   featureFlags                : { pointer, deepResearch, scanner, signals, autoExecute }
//                                 absent = enabled (default on)
//   userLimits                  : { pointerQuota, gemScanQuota, maxBuyUsd, dailyTradeCap }
//                                 admin per-user overrides; null/absent = plan default
//
// Plan quotas default to Free 10 / Pro(=Basic) 50 / Elite 200 for Pointer, and are
// admin-configurable via config/billing.pointerQuota (surfaced on cfg.raw).
const admin = require('firebase-admin')
const FieldValue = () => admin.firestore.FieldValue

const FALLBACK_QUOTA = {
  pointer: { free: 10, pro: 50, elite: 200 },
  gemScan: { free: 5, pro: 50, elite: 200 },
}
const USAGE_FIELD  = { pointer: 'pointerUsage', gemScan: 'gemScanUsage' }
const CREDIT_FIELD = { pointer: 'pointerCredits', gemScan: null } // only Pointer has credits
const LIMIT_KEY    = { pointer: 'pointerQuota', gemScan: 'gemScanQuota' }

// Current billing period as 'YYYY-MM' (UTC).
function currentPeriod(d = new Date()) {
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0')
}
// Epoch ms of the next monthly reset (first of next month, UTC).
function nextPeriodStart(d = new Date()) {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
}

// Resolve the effective quota: admin per-user override wins, else plan default
// from config, else the hardcoded fallback.
function planQuota(cfg, plan, kind = 'pointer') {
  const p = ['free', 'pro', 'elite'].includes(plan) ? plan : 'free'
  const raw = (cfg && cfg.raw) || {}
  const cfgMap = kind === 'gemScan' ? raw.gemScanQuota : raw.pointerQuota
  const fb = FALLBACK_QUOTA[kind] || FALLBACK_QUOTA.pointer
  const v = cfgMap && cfgMap[p] != null ? parseInt(cfgMap[p]) : fb[p]
  return Number.isFinite(v) ? v : fb[p]
}

// Read-only usage snapshot from a user doc (for getPointerUsage / admin views).
function readUsage(d, plan, cfg, kind = 'pointer') {
  const period = currentPeriod()
  const limits = (d && d.userLimits) || {}
  const ovr = parseInt(limits[LIMIT_KEY[kind]])
  const quota = Number.isFinite(ovr) ? ovr : planQuota(cfg, plan, kind)
  const usage = (d && d[USAGE_FIELD[kind]]) || { period, used: 0 }
  const used = usage.period === period ? (usage.used || 0) : 0
  const credits = kind === 'pointer' ? ((d && d.pointerCredits) || 0) : 0
  const planRemaining = Math.max(0, quota - used)
  return { quota, used, credits, planRemaining, remaining: planRemaining + credits, resetsAt: nextPeriodStart() }
}

function flagEnabled(d, flagKey) {
  if (!flagKey) return true
  const flags = (d && d.featureFlags) || {}
  return flags[flagKey] !== false
}

// Atomically consume `count` units of a metered resource. Throws a tagged Error
// on feature-disabled or quota-exhausted. Spends the monthly plan allowance
// first, then non-expiring credits. Returns the post-consume snapshot plus the
// { spentPlan, spentCredits } breakdown so a caller can refund exactly on failure.
async function consume(db, uid, opts) {
  const { kind = 'pointer', plan = 'free', cfg = {}, count = 1, flagKey } = opts || {}
  const usageField = USAGE_FIELD[kind]
  const creditField = CREDIT_FIELD[kind]
  const period = currentPeriod()
  const ref = db.doc(`users/${uid}`)
  return db.runTransaction(async (t) => {
    const snap = await t.get(ref)
    const d = snap.exists ? snap.data() : {}
    if (!flagEnabled(d, flagKey)) {
      const e = new Error('feature-disabled'); e.kind = 'feature-disabled'; e.flag = flagKey; throw e
    }
    const limits = d.userLimits || {}
    const ovr = parseInt(limits[LIMIT_KEY[kind]])
    const quota = Number.isFinite(ovr) ? ovr : planQuota(cfg, plan, kind)
    const usage = d[usageField] || { period, used: 0 }
    const used = usage.period === period ? (usage.used || 0) : 0
    const credits = creditField ? (d[creditField] || 0) : 0
    const planRemaining = Math.max(0, quota - used)
    if (planRemaining + credits < count) {
      const e = new Error('quota-exhausted'); e.kind = 'quota-exhausted'
      e.info = { quota, used, credits, resetsAt: nextPeriodStart() }
      throw e
    }
    const spentPlan = Math.min(count, planRemaining)
    const spentCredits = count - spentPlan
    const patch = { [usageField]: { period, used: used + spentPlan } }
    if (spentCredits > 0 && creditField) patch[creditField] = credits - spentCredits
    t.set(ref, patch, { merge: true })
    return {
      quota, used: used + spentPlan, credits: credits - spentCredits,
      remaining: Math.max(0, quota - (used + spentPlan)) + (credits - spentCredits),
      resetsAt: nextPeriodStart(), spentPlan, spentCredits,
    }
  })
}

// Reverse a prior consume (best-effort) when the underlying work failed.
async function refund(db, uid, opts) {
  const { kind = 'pointer', spentPlan = 0, spentCredits = 0 } = opts || {}
  if (spentPlan <= 0 && spentCredits <= 0) return
  const usageField = USAGE_FIELD[kind]
  const creditField = CREDIT_FIELD[kind]
  const period = currentPeriod()
  const ref = db.doc(`users/${uid}`)
  try {
    await db.runTransaction(async (t) => {
      const snap = await t.get(ref); const d = snap.exists ? snap.data() : {}
      const patch = {}
      if (spentPlan > 0) {
        const usage = d[usageField] || { period, used: 0 }
        if (usage.period === period) patch[usageField] = { period, used: Math.max(0, (usage.used || 0) - spentPlan) }
      }
      if (spentCredits > 0 && creditField) patch[creditField] = (d[creditField] || 0) + spentCredits
      if (Object.keys(patch).length) t.set(ref, patch, { merge: true })
    })
  } catch (_) { /* best-effort */ }
}

// Best-effort analytics + last-active bump (outside the metering transaction).
async function track(db, uid, fields) {
  try {
    const day = new Date().toISOString().slice(0, 10)
    const inc = {}
    for (const [k, v] of Object.entries(fields || {})) inc[k] = FieldValue().increment(v)
    if (Object.keys(inc).length) await db.doc(`users/${uid}/usageDaily/${day}`).set(inc, { merge: true })
    await db.doc(`users/${uid}`).set({ lastActiveAt: Date.now() }, { merge: true })
  } catch (_) { /* best-effort */ }
}

module.exports = { currentPeriod, nextPeriodStart, planQuota, readUsage, flagEnabled, consume, refund, track, FALLBACK_QUOTA }
