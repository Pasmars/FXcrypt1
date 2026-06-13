# FXcrypt - APK build script (TWA via Bubblewrap)
# 1) Creates the signing keystore (first run only) using Bubblewrap's downloaded JDK
# 2) Builds the signed APK/AAB without interactive prompts
$ErrorActionPreference = 'Stop'
$androidDir = $PSScriptRoot
Set-Location $androidDir

$credFile = Join-Path $androidDir 'keystore-credentials.txt'
$keystore = Join-Path $androidDir 'android.keystore'

# Keystore credentials (generated once, stored locally - keep this file safe!)
if (Test-Path $credFile) {
  $pwd_ = (Get-Content $credFile | Where-Object { $_ -match '^PASSWORD=' }) -replace '^PASSWORD=', ''
} else {
  $pwd_ = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 20 | ForEach-Object { [char]$_ })
  $lines = @(
    "PASSWORD=$pwd_",
    "ALIAS=android",
    "KEYSTORE=android.keystore",
    "# Keep this file safe - the same key is required to update the app."
  )
  $lines -join "`r`n" | Out-File -Encoding ascii $credFile
  Write-Output "Generated new keystore credentials -> keystore-credentials.txt"
}

# Locate the JDK keytool
$keytool = Get-ChildItem "$env:USERPROFILE\.bubblewrap\jdk" -Recurse -Filter keytool.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $keytool) { throw "JDK not found under ~\.bubblewrap\jdk - run setup-toolchain.ps1 first." }

# Create keystore if missing
if (-not (Test-Path $keystore)) {
  & $keytool.FullName -genkeypair -keystore $keystore -alias android -keyalg RSA -keysize 2048 -validity 10000 `
    -storepass $pwd_ -keypass $pwd_ -dname "CN=FXcrypt, OU=Mobile, O=FXcrypt, C=US"
  Write-Output "Keystore created: android.keystore"
}

# Build (non-interactive via env vars)
$env:BUBBLEWRAP_KEYSTORE_PASSWORD = $pwd_
$env:BUBBLEWRAP_KEY_PASSWORD      = $pwd_
npx --yes @bubblewrap/cli build --skipPwaValidation

Write-Output ""
Write-Output "BUILD_SCRIPT_DONE"
Get-ChildItem $androidDir -Filter *.apk -ErrorAction SilentlyContinue | Select-Object Name, @{n='MB';e={[math]::Round($_.Length/1MB,1)}}
