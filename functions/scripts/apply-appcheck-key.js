#!/usr/bin/env node
// Apply the reCAPTCHA v3 site key to both clients, rebuild, and deploy.
//
// Run this once the web app is registered in Firebase console -> App Check.
// That registration is what uploads the reCAPTCHA *secret* to Firebase so it can
// verify tokens; this script handles the other half, the public *site key* that
// ships in the page. Both halves are required — a site key in the client with no
// secret registered means every token fails verification.
//
//   node functions/scripts/apply-appcheck-key.js 6Lxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//   ... --no-deploy     write + build only
//
// Afterwards, let real traffic accumulate, then:
//   node functions/scripts/enforce-appcheck.js            # report adoption
//   node functions/scripts/enforce-appcheck.js --enforce  # flip once it reads 100%

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '../..')
const key = process.argv.find((a) => !a.startsWith('-') && /^6L/.test(a))
const deploy = !process.argv.includes('--no-deploy')

// reCAPTCHA v3 site keys are ~40 chars and start with 6L. Checking this here
// stops a mistyped or half-copied key from being built into a release.
if (!key || key.length < 30) {
  console.error('Usage: node functions/scripts/apply-appcheck-key.js <reCAPTCHA_v3_SITE_KEY>')
  console.error('A v3 site key starts with "6L" and is around 40 characters.')
  process.exit(1)
}

const TARGETS = [
  { file: 'shared/lib/firebase.ts', re: /(const APP_CHECK_SITE_KEY = ')([^']*)(')/ },
  { file: 'admin/index.html', re: /(const APP_CHECK_SITE_KEY = ')([^']*)(')/ },
]

let wrote = 0
for (const t of TARGETS) {
  const p = path.join(ROOT, t.file)
  const src = fs.readFileSync(p, 'utf8')
  if (!t.re.test(src)) { console.error(`! could not find APP_CHECK_SITE_KEY in ${t.file}`); process.exit(1) }
  const out = src.replace(t.re, `$1${key}$3`)
  if (out !== src) { fs.writeFileSync(p, out); console.log(`  set key in ${t.file}`); wrote++ }
  else console.log(`  ${t.file} already had this key`)
}
console.log(`\nSite key applied to ${wrote} file(s).`)

const run = (cmd, cwd) => {
  console.log(`\n$ ${cmd}`)
  execSync(cmd, { cwd: cwd || ROOT, stdio: 'inherit' })
}

// The webapp MUST build with STATIC_EXPORT=1 or firebase deploy ships a stale
// out/ directory and the key never reaches production.
run('npm run build', path.join(ROOT, 'mobile'))
run(process.platform === 'win32' ? 'set STATIC_EXPORT=1 && npm run build' : 'STATIC_EXPORT=1 npm run build', path.join(ROOT, 'webapp'))

if (deploy) {
  run('npx firebase deploy --only hosting --non-interactive')
  console.log('\nDeployed. App Check now initializes for real users.')
  console.log('Next: let traffic accumulate, then check adoption:')
  console.log('  node functions/scripts/enforce-appcheck.js')
} else {
  console.log('\nBuilt but not deployed (--no-deploy). Deploy with:')
  console.log('  npx firebase deploy --only hosting')
}
