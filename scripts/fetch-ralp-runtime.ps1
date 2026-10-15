# Downloads the llama.cpp server that Ralp uses into ai/runtime/.
# ai/runtime/ is not committed to git; run this once after cloning:
#   powershell -ExecutionPolicy Bypass -File scripts/fetch-ralp-runtime.ps1
$ErrorActionPreference = "Stop"

$Tag = "b11669"
$Asset = "llama-$Tag-bin-win-cpu-x64.zip"
$Sha256 = "37b3efcf962847ca869745fd4ccf7f5e7e8dacfeff9fa3523b4ca8cdc66d632b"
$Url = "https://github.com/ggml-org/llama.cpp/releases/download/$Tag/$Asset"

# Only what llama-server.exe needs at runtime.
$Files = @(
  "llama-server.exe", "llama-server-impl.dll", "llama-common.dll", "llama.dll", "mtmd.dll",
  "libomp.dll", "ggml.dll", "ggml-base.dll", "ggml-cpu-*.dll", "LICENSE-LLVM-OpenMP"
)

$Root = Split-Path -Parent $PSScriptRoot
$Runtime = Join-Path $Root "ai\runtime"
$Temp = Join-Path ([IO.Path]::GetTempPath()) "vocatechx-llama-$Tag"

if (Test-Path $Temp) { Remove-Item -Recurse -Force $Temp }
New-Item -ItemType Directory -Force $Temp, $Runtime | Out-Null

Write-Host "Downloading $Asset..."
$Zip = Join-Path $Temp $Asset
Invoke-WebRequest -Uri $Url -OutFile $Zip -UseBasicParsing

$Actual = (Get-FileHash -Algorithm SHA256 $Zip).Hash.ToLower()
if ($Actual -ne $Sha256) { throw "Checksum mismatch for $Asset (got $Actual)" }

Expand-Archive -Path $Zip -DestinationPath (Join-Path $Temp "x") -Force
foreach ($pattern in $Files) {
  Copy-Item -Path (Join-Path $Temp "x\$pattern") -Destination $Runtime -Force
}
Set-Content -Path (Join-Path $Runtime "VERSION.txt") -Value "$Tag win-cpu-x64 sha256:$Sha256" -Encoding utf8
Remove-Item -Recurse -Force $Temp

Write-Host "Ralp runtime installed in $Runtime"
