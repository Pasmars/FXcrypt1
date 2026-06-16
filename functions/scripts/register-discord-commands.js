// One-time: register the /ask and /link slash commands with Discord.
// Run from the functions/ dir:
//   DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... [DISCORD_GUILD_ID=...] node scripts/register-discord-commands.js
// Provide DISCORD_GUILD_ID for instant registration in one server (recommended
// for testing). Omit it to register globally (can take up to ~1 hour to appear).
const APP_ID = process.env.DISCORD_APP_ID
const TOKEN  = process.env.DISCORD_BOT_TOKEN
const GUILD  = process.env.DISCORD_GUILD_ID || null

if (!APP_ID || !TOKEN) {
  console.error('Set DISCORD_APP_ID and DISCORD_BOT_TOKEN env vars.')
  process.exit(1)
}

const commands = [
  {
    name: 'ask',
    description: 'Ask your FXcrypt operations agent (DeepSeek or ChatGPT)',
    options: [{ type: 3, name: 'prompt', description: 'What do you want to know or do?', required: true }],
  },
  {
    name: 'link',
    description: 'Link this Discord account to your FXcrypt account',
    options: [{ type: 3, name: 'code', description: 'Code generated in the FXcrypt app', required: true }],
  },
]

const url = GUILD
  ? `https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD}/commands`
  : `https://discord.com/api/v10/applications/${APP_ID}/commands`

;(async () => {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': `Bot ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  })
  const text = await res.text()
  if (!res.ok) { console.error(`Failed (${res.status}):`, text); process.exit(1) }
  console.log(`Registered ${commands.length} commands ${GUILD ? `in guild ${GUILD}` : 'globally'}.`)
})()
