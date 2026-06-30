// FXcrypt Discord Gateway Bot — always-on, free-text chat (no slash commands).
// Listens for normal messages (in a dedicated channel, when @mentioned, or in
// DMs), runs the same agent brain as the Cloud Function, and replies. Trade
// proposals come with Approve/Reject buttons (gated — nothing executes until
// you click Approve).
//
// Run locally:  cd functions  ->  npm run bot
// Requires: a .env in this folder (see .env.example) + Firebase admin creds.
const path = require('path')
const fs = require('fs')
require('dotenv').config({ path: path.join(__dirname, '.env') })

const admin = require('firebase-admin')
const { Client, GatewayIntentBits, Partials, Events, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js')

// Shared backend libs (resolve their deps from functions/node_modules)
const trader     = require('../lib/trader')
const gemscanner = require('../lib/gemscanner')
const encryption = require('../lib/encryption')
const agentLib   = require('../lib/agent')

// ── Config from env ────────────────────────────────────────────────────────
const BOT_TOKEN  = process.env.DISCORD_BOT_TOKEN
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID || null
const MASTER_SECRET = process.env.BOT_SECRET || ''
const HELIUS = process.env.HELIUS_API_KEY || null
const MORALIS = process.env.MORALIS_API_KEY || null
if (!BOT_TOKEN) { console.error('Missing DISCORD_BOT_TOKEN in discord-gateway/.env'); process.exit(1) }
if (!MASTER_SECRET) console.warn('WARNING: BOT_SECRET not set — trade approvals will fail to decrypt wallet keys.')

// ── Firebase Admin ─────────────────────────────────────────────────────────
// Find a service account key: explicit env path, then serviceAccount.json, then
// auto-detect ANY *.json in this folder that is a service-account key (so the
// downloaded "<project>-firebase-adminsdk-*.json" works without renaming).
function findServiceAccount() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS)
  const explicit = path.join(__dirname, 'serviceAccount.json')
  if (fs.existsSync(explicit)) return explicit
  try {
    for (const f of fs.readdirSync(__dirname)) {
      if (!f.toLowerCase().endsWith('.json')) continue
      try {
        const j = JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'))
        if (j.type === 'service_account' && j.project_id) return path.join(__dirname, f)
      } catch { /* not JSON / not a key */ }
    }
  } catch { /* dir read failed */ }
  return null
}

if (!admin.apps.length) {
  const saPath = findServiceAccount()
  if (!saPath) {
    console.error('\n❌ No Firebase credentials found.')
    console.error('   Download a service account key (Firebase console → Project settings → Service accounts → Generate new private key)')
    console.error('   and save the .json file into:  functions\\discord-gateway\\')
    console.error('   (any filename works), or set GOOGLE_APPLICATION_CREDENTIALS in .env.\n')
    process.exit(1)
  }
  const sa = require(saPath)
  admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id })
  console.log(`Firebase: ${path.basename(saPath)} (project ${sa.project_id})`)
}
const db = admin.firestore()

// ── Helpers ────────────────────────────────────────────────────────────────
async function discordUidFor(id) {
  const snap = await db.collection('users').where('botSettings.discordUserId', '==', String(id)).limit(1).get()
  return snap.empty ? null : snap.docs[0].id
}

// Split a reply into <=1900-char chunks (Discord caps at 2000).
function chunks(text) {
  const out = []
  let s = String(text || '…')
  while (s.length > 1900) { out.push(s.slice(0, 1900)); s = s.slice(1900) }
  out.push(s)
  return out
}
async function sendReply(msg, text) {
  const parts = chunks(text)
  await msg.reply(parts[0])
  for (let i = 1; i < parts.length; i++) await msg.channel.send(parts[i])
}

function tradeRow(proposalId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tappr:${proposalId}`).setLabel('✅ Approve').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`trej:${proposalId}`).setLabel('❌ Reject').setStyle(ButtonStyle.Danger),
  )
}

// Attempt "link CODE" typed in chat → bind this Discord user to a FXcrypt account.
async function tryLink(discordUserId, code) {
  const snap = await db.collection('users').where('botSettings.discordLinkCode', '==', code.toUpperCase()).limit(1).get()
  if (snap.empty) return '❌ Invalid code. Generate a fresh one in the app (Bot → Discord AI).'
  const doc = snap.docs[0]
  const exp = doc.data().botSettings?.discordLinkExpiry || 0
  if (Date.now() > exp) return '❌ Code expired. Generate a new one.'
  await doc.ref.set({ botSettings: { discordUserId: String(discordUserId), discordVerified: true, discordLinkCode: null, discordLinkExpiry: null } }, { merge: true })
  return '✅ Linked! Just talk to me normally now — ask about balances, scan gems, or propose a trade.'
}

// ── Client ─────────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // privileged — enable in the Developer Portal
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel], // required to receive DMs
})

const yn = (v) => (v ? '✓' : '✗')
client.once(Events.ClientReady, (c) => {
  console.log(`✅ FXcrypt agent online as ${c.user.tag}`)
  console.log(`   Triggers: DMs, @mentions${CHANNEL_ID ? `, channel ${CHANNEL_ID}` : ' (no dedicated channel set)'}`)
  console.log(`   Keys: DeepSeek ${yn(process.env.DEEPSEEK_API_KEY)} · OpenAI ${yn(process.env.OPENAI_API_KEY)} · Helius ${yn(HELIUS)} · Moralis ${yn(MORALIS)} · BOT_SECRET ${yn(MASTER_SECRET)}`)
})

client.on(Events.MessageCreate, async (msg) => {
  try {
    if (msg.author.bot) return
    const isDM = !msg.guild
    const mentioned = client.user && msg.mentions.has(client.user.id)
    const inChannel = CHANNEL_ID && msg.channelId === CHANNEL_ID
    if (!isDM && !mentioned && !inChannel) return

    // Strip the bot mention from the text
    let content = (msg.content || '').replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim()
    if (!content) return

    const linkMatch = content.match(/^link\s+([A-Za-z0-9]{4,})$/i)
    const uid = await discordUidFor(msg.author.id)

    if (!uid) {
      if (linkMatch) { await sendReply(msg, await tryLink(msg.author.id, linkMatch[1])) }
      else { await sendReply(msg, '🔗 You\'re not linked yet. In the app: **Bot → Discord AI → Generate Link Code**, then type `link YOURCODE` here.') }
      return
    }
    if (linkMatch) { await sendReply(msg, '✅ Already linked. Just ask me anything.'); return }

    await msg.channel.sendTyping().catch(() => {})

    const stateRef = db.doc(`users/${uid}/agentState/discord`)
    const [stateSnap, userSnap] = await Promise.all([stateRef.get(), db.doc(`users/${uid}`).get()])
    const history = (stateSnap.exists && stateSnap.data().history) || []
    const provider = userSnap.data()?.botSettings?.aiProvider === 'openai' ? 'openai' : 'deepseek'
    const apiKey = provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.DEEPSEEK_API_KEY
    if (!apiKey) { await sendReply(msg, `⚠️ No API key set for ${provider === 'openai' ? 'ChatGPT' : 'DeepSeek'} in this bot's .env.`); return }

    const ctx = { uid, db, admin, trader, gemscanner, encryption, masterSecret: MASTER_SECRET, heliusKey: HELIUS, moralisKey: MORALIS }
    const { text, proposal, history: newHistory } = await agentLib.runAgent({ prompt: content, history, ctx, provider, apiKey })
    await stateRef.set({ history: newHistory, updatedAt: Date.now() }, { merge: true })

    if (proposal) {
      const ref = await db.collection(`users/${uid}/discordProposals`).add({ ...proposal, status: 'pending', createdAt: Date.now() })
      const native = agentLib.NATIVE[proposal.chain] || proposal.chain.toUpperCase()
      const size = proposal.action === 'buy' ? `${proposal.amount} ${native}` : `${proposal.percent}%`
      const body =
        `${chunks(text)[0]}\n\n` +
        `**🔔 Trade proposal — approval required**\n` +
        `> ${proposal.action.toUpperCase()} **${proposal.tokenSymbol || proposal.tokenAddress}** on ${proposal.chain.toUpperCase()} · ${size}\n` +
        `> \`${proposal.tokenAddress}\``
      await msg.reply({ content: body.slice(0, 1900), components: [tradeRow(ref.id)] })
    } else {
      await sendReply(msg, text)
    }
  } catch (e) {
    console.error('message error:', e)
    msg.reply('⚠️ Agent error: ' + (e.message || 'failed')).catch(() => {})
  }
})

// ── Trade approval buttons ─────────────────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return
  const [tag, proposalId] = interaction.customId.split(':')
  if (tag !== 'tappr' && tag !== 'trej') return
  try {
    await interaction.deferUpdate() // ack within 3s; trade can take longer
    const uid = await discordUidFor(interaction.user.id)
    if (!uid) { await interaction.editReply({ content: '🔗 Not linked.', components: [] }); return }

    const pRef = db.doc(`users/${uid}/discordProposals/${proposalId}`)
    const pSnap = await pRef.get()
    if (!pSnap.exists) { await interaction.editReply({ content: '⚠️ Proposal not found.', components: [] }); return }
    const p = pSnap.data()
    if (p.status !== 'pending') { await interaction.editReply({ content: `This proposal was already **${p.status}**.`, components: [] }); return }

    if (tag === 'trej') {
      await pRef.update({ status: 'rejected' })
      await interaction.editReply({ content: `❌ **Rejected** — ${p.action.toUpperCase()} ${p.tokenSymbol || p.tokenAddress} on ${p.chain.toUpperCase()}. No trade made.`, components: [] })
      return
    }

    await interaction.editReply({ content: `⏳ Executing ${p.action.toUpperCase()} ${p.tokenSymbol || p.tokenAddress} on ${p.chain.toUpperCase()}…`, components: [] })
    try {
      const ctx = { uid, db, admin, trader, encryption, masterSecret: MASTER_SECRET, heliusKey: HELIUS }
      const result = await agentLib.executeProposedTrade(ctx, p)
      await pRef.update({ status: 'executed', txHash: result.txHash || null })
      await interaction.editReply({ content: `✅ **Executed** — ${p.action.toUpperCase()} ${p.tokenSymbol || p.tokenAddress} on ${p.chain.toUpperCase()}\nStatus: ${result.status}` + (result.txHash ? `\nTx: \`${result.txHash}\`` : ''), components: [] })
    } catch (e) {
      await pRef.update({ status: 'failed', error: e.message })
      await interaction.editReply({ content: `⚠️ **Trade failed** — ${e.message}`, components: [] })
    }
  } catch (e) {
    console.error('button error:', e)
  }
})

client.login(BOT_TOKEN)
