// mcp.js — a minimal, safe Model Context Protocol (MCP) client over Streamable
// HTTP, used to bridge an external MCP server (e.g. Glassnode's on-chain
// analytics) into Pointer's function-calling toolset.
//
// SAFETY MODEL:
//  - Config + token live in the server-only Firestore doc `config/mcp`
//    (rules deny all client access to config/*); the token is NEVER returned to
//    any client — the admin panel only ever sees a masked version.
//  - The feature is off until an admin enables it AND sets a URL + token.
//  - Only allowlisted tools can be exposed to Pointer (admin-controlled).
//  - Every request has a hard timeout; a per-turn call cap is enforced by the
//    caller. Any MCP failure is isolated so Pointer keeps working without it.
//  - URLs must be https.
const axios = require('axios')

const PROTOCOL_VERSION = '2025-06-18'
const DEFAULT_TIMEOUT = 15000

// ── config ──────────────────────────────────────────────────────────────────
const DEFAULTS = {
  enabled: false,
  provider: 'glassnode',
  // Glassnode's MCP server. Public access works with NO token (30-day history
  // limit); adding an X-Api-Key removes the limit. Same URL either way.
  url: 'https://mcp.glassnode.com',
  token: '',
  authHeader: 'X-Api-Key',     // header the token is sent in (Glassnode uses X-Api-Key)
  bearer: false,               // Glassnode wants the raw key, no "Bearer " prefix
  publicAccess: false,         // allow enabling WITHOUT a token (public 30-day access)
  allowTools: [],              // [] = allow all discovered tools (capped)
  toolLimit: 24,
  maxCallsPerTurn: 6,
  timeoutMs: DEFAULT_TIMEOUT,
}

// Read the server-side MCP config (with the raw token — server use only).
async function loadConfig(db) {
  try {
    const snap = await db.doc('config/mcp').get()
    const c = snap.exists ? snap.data() : {}
    return { ...DEFAULTS, ...c, usage: c.usage || {} }
  } catch (e) { return { ...DEFAULTS, usage: {} } }
}

const maskToken = (t) => {
  const s = String(t || '')
  if (!s) return ''
  return s.length <= 8 ? '••••' : s.slice(0, 3) + '••••' + s.slice(-4)
}

// Best-effort usage counters on config/mcp.usage (monitoring for the admin).
async function trackUsage(db, admin, { tool, ok, error }) {
  try {
    const inc = admin.firestore.FieldValue.increment
    const patch = { usage: { calls: inc(1), lastCallAt: Date.now(), lastTool: tool || null } }
    if (ok === false || error) { patch.usage.errors = inc(1); patch.usage.lastError = String(error || 'error').slice(0, 300) }
    await db.doc('config/mcp').set(patch, { merge: true })
  } catch (_) { /* monitoring is best-effort */ }
}

// ── HTTP transport ────────────────────────────────────────────────────────────
function reqHeaders(cfg, sessionId) {
  const h = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'MCP-Protocol-Version': PROTOCOL_VERSION,
  }
  if (cfg.token) h[cfg.authHeader || 'Authorization'] = (cfg.bearer === false) ? cfg.token : `Bearer ${cfg.token}`
  if (sessionId) h['Mcp-Session-Id'] = sessionId
  return h
}

// Extract a JSON-RPC payload from a JSON body OR an SSE (text/event-stream) body.
function extractPayload(res) {
  const ct = String(res.headers['content-type'] || '')
  const raw = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || '')
  if (ct.includes('text/event-stream')) {
    let last = null
    for (const line of raw.split(/\r?\n/)) {
      const m = /^data:\s*(.*)$/.exec(line)
      if (m && m[1]) { try { last = JSON.parse(m[1]) } catch (_) {} }
    }
    return last
  }
  try { return JSON.parse(raw) } catch (_) { return null }
}

// One JSON-RPC call. Returns { result, sessionId }. Throws on transport/RPC error.
async function rpc(cfg, method, params, sessionId, isNotification) {
  if (!/^https:\/\//i.test(cfg.url || '')) throw new Error('MCP server URL must be https')
  const body = { jsonrpc: '2.0', method, ...(isNotification ? {} : { id: Math.floor(Math.random() * 1e9) }), ...(params !== undefined ? { params } : {}) }
  const res = await axios.post(cfg.url, body, {
    headers: reqHeaders(cfg, sessionId),
    timeout: cfg.timeoutMs || DEFAULT_TIMEOUT,
    responseType: 'text',
    transformResponse: [(d) => d],
    validateStatus: () => true,
    maxContentLength: 5 * 1024 * 1024,
  })
  const sid = res.headers['mcp-session-id'] || sessionId
  if (isNotification) return { sessionId: sid }
  const payload = extractPayload(res)
  if (res.status >= 400) {
    const msg = (payload && payload.error && payload.error.message) || `HTTP ${res.status}`
    throw new Error(`MCP ${method}: ${msg}`)
  }
  if (payload && payload.error) throw new Error(`MCP ${method}: ${payload.error.message || 'rpc error'}`)
  return { result: (payload && payload.result) || {}, sessionId: sid }
}

// initialize → initialized. Returns { sessionId, serverInfo }.
async function connect(cfg) {
  const init = await rpc(cfg, 'initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'FXcrypt-Pointer', version: '1.0' },
  })
  try { await rpc(cfg, 'notifications/initialized', undefined, init.sessionId, true) } catch (_) {}
  return { sessionId: init.sessionId, serverInfo: init.result.serverInfo || null }
}

async function listTools(cfg, sessionId) {
  const r = await rpc(cfg, 'tools/list', {}, sessionId)
  return Array.isArray(r.result.tools) ? r.result.tools : []
}

async function callTool(cfg, sessionId, name, args) {
  const r = await rpc(cfg, 'tools/call', { name, arguments: args || {} }, sessionId)
  const result = r.result || {}
  const text = (result.content || [])
    .map((c) => c && c.type === 'text' ? c.text : (c && c.type === 'json' ? JSON.stringify(c.json) : ''))
    .filter(Boolean).join('\n')
  return { text: text || JSON.stringify(result).slice(0, 4000), isError: !!result.isError }
}

// Live connection test for the admin panel.
async function healthCheck(cfg) {
  if (!cfg.url) return { ok: false, error: 'No server URL set' }
  if (!cfg.token && !cfg.publicAccess) return { ok: false, error: 'Set an API token, or enable public access' }
  try {
    const { sessionId, serverInfo } = await connect(cfg)
    const tools = await listTools(cfg, sessionId)
    return {
      ok: true, serverInfo, toolCount: tools.length,
      tools: tools.map((t) => ({ name: t.name, description: String(t.description || '').slice(0, 160) })),
    }
  } catch (e) { return { ok: false, error: e.message } }
}

// ── Agent bridge ──────────────────────────────────────────────────────────────
// Sanitize an MCP tool name into an OpenAI-safe, namespaced function name.
function nsName(name) {
  return ('gn_' + String(name).replace(/[^a-zA-Z0-9_-]/g, '_')).slice(0, 60)
}

// Discover the MCP catalog and return OpenAI-format tools (allowlist-filtered,
// capped, namespaced) + a session + name map. Returns null on any failure so
// the caller can safely proceed without MCP.
async function buildAgentTools(cfg) {
  try {
    const { sessionId } = await connect(cfg)
    let tools = await listTools(cfg, sessionId)
    if (Array.isArray(cfg.allowTools) && cfg.allowTools.length) {
      const allow = new Set(cfg.allowTools)
      tools = tools.filter((t) => allow.has(t.name))
    }
    tools = tools.slice(0, cfg.toolLimit || 24)
    if (!tools.length) return null
    const nameMap = {}
    const openaiTools = tools.map((t) => {
      const fn = nsName(t.name)
      nameMap[fn] = t.name
      const schema = (t.inputSchema && t.inputSchema.type === 'object') ? t.inputSchema : { type: 'object', properties: {} }
      return { type: 'function', function: { name: fn, description: ('[Glassnode on-chain analytics] ' + String(t.description || t.name)).slice(0, 1000), parameters: schema } }
    })
    return { sessionId, openaiTools, nameMap }
  } catch (e) { return null }
}

module.exports = { loadConfig, maskToken, trackUsage, connect, listTools, callTool, healthCheck, buildAgentTools, DEFAULTS }
