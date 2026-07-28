// rpc-guard.js — validates user-supplied RPC endpoints before the server calls them.
//
// Users can set a custom RPC per chain (botSettings.bscRpc, .solRpc, …), and
// botSettings is written straight from the client — it is NOT in the firestore
// rules' protectedKeys list. Those values are then handed to ethers'
// JsonRpcProvider / @solana/web3.js Connection *inside the Cloud Function*, so
// an unchecked value turns every trade path into a server-side request forgery
// primitive: the function will POST to whatever host the user names, from
// inside GCP, with the platform's egress and network position.
//
// Anything that isn't a public https endpoint is rejected, and callers fall
// back to the built-in RPC list.

// Hosts that must never be reachable: loopback, link-local (incl. the cloud
// metadata service), RFC1918, CGNAT, and internal-only TLDs.
const BLOCKED_HOSTNAME = /^(localhost|.*\.local|.*\.internal|metadata(\.google)?\.internal)$/i

function isBlockedIp(host) {
  // IPv6 loopback / unspecified / unique-local / link-local
  const h = host.replace(/^\[|\]$/g, '').toLowerCase()
  if (h === '::1' || h === '::' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h)) return true

  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const [a, b] = [parseInt(m[1], 10), parseInt(m[2], 10)]
  if (a === 127 || a === 0 || a === 10) return true          // loopback, "this", private
  if (a === 169 && b === 254) return true                     // link-local → 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true            // private
  if (a === 192 && b === 168) return true                     // private
  if (a === 100 && b >= 64 && b <= 127) return true           // CGNAT
  return false
}

// Returns the URL string when it is safe to call, otherwise null.
function safeRpcUrl(raw) {
  if (!raw || typeof raw !== 'string') return null
  let u
  try { u = new URL(raw.trim()) } catch (_) { return null }
  // https only — plain http would also expose the request to network observers,
  // and every legitimate public RPC offers TLS.
  if (u.protocol !== 'https:') return null
  if (u.username || u.password) return null
  const host = u.hostname
  if (!host || BLOCKED_HOSTNAME.test(host) || isBlockedIp(host)) return null
  return u.toString()
}

module.exports = { safeRpcUrl }
