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

const net = require('net')

// Hosts that must never be reachable: loopback, link-local (incl. the cloud
// metadata service), RFC1918, CGNAT, and internal-only TLDs.
const BLOCKED_HOSTNAME = /^(localhost|.*\.local|.*\.internal|metadata(\.google)?\.internal)$/i

// A real RPC endpoint is a dotted domain with letters in it. Requiring that
// shape is what rejects the alternate IPv4 spellings the OS resolver accepts
// but net.isIP does not recognise as an IP at all — 2130706433, 0x7f000001 and
// 127.1 all reach 127.0.0.1, and all of them used to sail through the
// dotted-quad regex this guard replaced.
const DNS_NAME = /^(?=.*[a-z])[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i

function isPrivateV4(h) {
  const p = h.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = p
  if (a === 0 || a === 127) return true                  // "this network", loopback
  if (a === 10) return true                              // private
  if (a === 172 && b >= 16 && b <= 31) return true       // private
  if (a === 192 && b === 168) return true                // private
  if (a === 192 && b === 0) return true                  // IETF protocol assignments
  if (a === 169 && b === 254) return true                // link-local → 169.254.169.254
  if (a === 100 && b >= 64 && b <= 127) return true      // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true    // benchmarking
  if (a >= 224) return true                              // multicast + reserved + broadcast
  return false
}

function isPrivateV6(h) {
  const x = h.toLowerCase()
  if (x === '::1' || x === '::') return true
  if (/^f[cd][0-9a-f]{0,2}:/.test(x)) return true        // unique-local fc00::/7
  if (/^fe[89ab][0-9a-f]?:/.test(x)) return true         // link-local fe80::/10
  // IPv4-mapped/compatible: ::ffff:169.254.169.254 and ::ffff:a9fe:a9fe both
  // reach the v4 address, so classify the embedded v4 rather than trusting the
  // v6 prefix.
  const mapped = x.match(/^::(?:ffff:)?(.+)$/)
  if (mapped) {
    const tail = mapped[1]
    if (net.isIPv4(tail)) return isPrivateV4(tail)
    const hex = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
    if (hex) {
      const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16)
      return isPrivateV4([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'))
    }
  }
  return false
}

// Returns the URL string when it is safe to call, otherwise null.
function safeRpcUrl(raw) {
  if (!raw || typeof raw !== 'string') return null
  let u
  try { u = new URL(raw.trim()) } catch (_) { return null }
  // https only — plain http would also expose the request to network observers,
  // and every legitimate public RPC offers TLS. It is also what keeps the GCE
  // metadata service (http-only) out of reach.
  if (u.protocol !== 'https:') return null
  if (u.username || u.password) return null

  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (!host) return null

  const kind = net.isIP(host)
  if (kind === 4) { if (isPrivateV4(host)) return null }
  else if (kind === 6) { if (isPrivateV6(host)) return null }
  // Not an IP literal: it must be a well-formed public domain name. Anything
  // else (bare numbers, hex, single labels) is refused rather than handed to
  // the resolver to interpret.
  else if (!DNS_NAME.test(host) || BLOCKED_HOSTNAME.test(host)) return null

  return u.toString()
}

module.exports = { safeRpcUrl }
