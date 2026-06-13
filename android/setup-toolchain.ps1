# Wires the manually-downloaded JDK + Android SDK into Bubblewrap's config.
$ErrorActionPreference = 'Stop'
$bw = "$env:USERPROFILE\.bubblewrap"

# ── 1. Extract JDK ──
$jdkRoot = "$bw\jdk\jdk-17.0.11+9"
if (-not (Test-Path "$jdkRoot\bin\java.exe")) {
  Write-Output "Extracting JDK…"
  Expand-Archive -Path "$bw\jdk17.zip" -DestinationPath "$bw\jdk" -Force
}
& "$jdkRoot\bin\java.exe" -version
if ($LASTEXITCODE -ne 0) { throw "java.exe failed" }

# ── 2. Extract Android command-line tools (both layouts for compatibility) ──
$sdk = "$bw\android_sdk"
if (-not (Test-Path "$sdk\cmdline-tools\latest\bin\sdkmanager.bat")) {
  Write-Output "Extracting cmdline-tools…"
  $tmp = "$bw\_cmdtools_tmp"
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
  Expand-Archive -Path "$bw\cmdtools.zip" -DestinationPath $tmp -Force
  New-Item -ItemType Directory -Force "$sdk\cmdline-tools\latest" | Out-Null
  Copy-Item "$tmp\cmdline-tools\*" "$sdk\cmdline-tools\latest" -Recurse -Force
  # legacy layout some tools expect: cmdline-tools/bin directly
  Copy-Item "$tmp\cmdline-tools\bin" "$sdk\cmdline-tools\" -Recurse -Force
  Copy-Item "$tmp\cmdline-tools\lib" "$sdk\cmdline-tools\" -Recurse -Force
  Copy-Item "$tmp\cmdline-tools\source.properties" "$sdk\cmdline-tools\" -Force -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $tmp
}

# ── 3. Accept licenses + install platform/build-tools ──
$env:JAVA_HOME = $jdkRoot
$yes = ("y`n" * 12)
$yes | & "$sdk\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root=$sdk --licenses | Out-Null
$yes | & "$sdk\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root=$sdk "platforms;android-35" "build-tools;34.0.0" | Select-Object -Last 3

# ── 4. Point Bubblewrap at the toolchain ──
$cfg = @{ jdkPath = $jdkRoot; androidSdkPath = $sdk } | ConvertTo-Json -Compress
$cfg | Out-File -Encoding ascii "$bw\config.json"
Get-Content "$bw\config.json"
Write-Output "TOOLCHAIN_OK"
