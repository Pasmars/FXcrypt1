# Interactive setup for the Discord AI agent.
# Run from the functions/ directory:  .\scripts\setup-discord-agent.ps1
# Prompts for each value locally, sets the Firebase secrets, registers the
# Discord slash commands, and deploys the agent Cloud Functions.
# Your keys are typed into YOUR terminal and never leave this machine.

$ErrorActionPreference = 'Stop'

function Read-Required([string]$label) {
  do { $v = Read-Host $label } while ([string]::IsNullOrWhiteSpace($v))
  return $v.Trim()
}

# Set a Firebase secret from a value without a trailing newline (temp file -> --data-file).
function Set-Secret([string]$name, [string]$value) {
  $tmp = [System.IO.Path]::GetTempFileName()
  try {
    [System.IO.File]::WriteAllText($tmp, $value)   # no trailing newline
    firebase functions:secrets:set $name --data-file $tmp
    if ($LASTEXITCODE -ne 0) { throw "Failed to set secret $name" }
  } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
}

Write-Host ""
Write-Host "=== FXcrypt Discord AI Agent - setup ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Get keys from: DeepSeek https://platform.deepseek.com  |  OpenAI https://platform.openai.com/api-keys"
Write-Host "Discord: https://discord.com/developers/applications -> your app (General: App ID + Public Key, Bot: Token)"
Write-Host ""

# ---- Collect inputs -------------------------------------------------------
$deepseek   = Read-Required "DeepSeek API key (DEEPSEEK_API_KEY)"
$openai     = Read-Host     "OpenAI / ChatGPT API key (OPENAI_API_KEY) - press Enter to skip if unused"
if ([string]::IsNullOrWhiteSpace($openai)) {
  $openai = "unused"
  Write-Host "  (placeholder set; selecting ChatGPT in the app will error until you set a real key)" -ForegroundColor Yellow
} else {
  $openai = $openai.Trim()
}
$discordPub = Read-Required "Discord Public Key (DISCORD_PUBLIC_KEY)"
$discordApp = Read-Required "Discord Application ID (DISCORD_APP_ID)"
$botToken   = Read-Required "Discord Bot Token (for command registration; not stored as a secret)"
$guildId    = Read-Host     "Discord Server / Guild ID for instant command registration - Enter for global (~1h)"

# ---- Set Firebase secrets -------------------------------------------------
Write-Host ""
Write-Host "Setting Firebase secrets..." -ForegroundColor Cyan
Set-Secret "DEEPSEEK_API_KEY"   $deepseek
Set-Secret "OPENAI_API_KEY"     $openai
Set-Secret "DISCORD_PUBLIC_KEY" $discordPub
Set-Secret "DISCORD_APP_ID"     $discordApp

# ---- Register Discord slash commands (/ask, /link) ------------------------
Write-Host ""
Write-Host "Registering Discord slash commands..." -ForegroundColor Cyan
$env:DISCORD_APP_ID    = $discordApp
$env:DISCORD_BOT_TOKEN = $botToken
if (-not [string]::IsNullOrWhiteSpace($guildId)) { $env:DISCORD_GUILD_ID = $guildId.Trim() }
node scripts/register-discord-commands.js
if ($LASTEXITCODE -ne 0) { throw "Command registration failed" }
Remove-Item Env:DISCORD_BOT_TOKEN -ErrorAction SilentlyContinue

# ---- Deploy the agent functions -------------------------------------------
Write-Host ""
Write-Host "Deploying Cloud Functions..." -ForegroundColor Cyan
firebase deploy --only functions:discordInteractions,functions:processDiscordAgent,functions:generateDiscordCode
if ($LASTEXITCODE -ne 0) { throw "Function deploy failed" }

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Green
Write-Host "Final step (Discord portal): set the Interactions Endpoint URL to:" -ForegroundColor Cyan
Write-Host "  https://europe-west1-pnl-calculator.cloudfunctions.net/discordInteractions"
Write-Host "Then in the app: Bot -> Discord AI -> Generate Link Code, and run /link <code> in Discord."
Write-Host ""
