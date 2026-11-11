$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$working = Join-Path $root '.fixture'
$source = Join-Path $working 'source'
$ssh = Join-Path $working 'ssh'
$compose = Join-Path $PSScriptRoot 'compose.yml'

function Invoke-Checked {
    param([string]$Program, [string[]]$CommandArgs)
    & $Program @CommandArgs
    if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE" }
}

if (-not (Test-Path (Join-Path $source '.git'))) {
    if (Test-Path $source) { throw "$source already exists. Move it aside before creating the fixture." }
    New-Item -ItemType Directory -Path $source -Force | Out-Null
    Copy-Item -Path (Join-Path $PSScriptRoot 'source/*') -Destination $source
    Invoke-Checked git @('-C', $source, 'init', '-q')
    Invoke-Checked git @('-C', $source, 'add', '.')
    Invoke-Checked git @('-C', $source, '-c', 'user.name=Splice Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Seed retry incident')
}

New-Item -ItemType Directory -Path $ssh -Force | Out-Null
$key = Join-Path $ssh 'id_ed25519'
if (-not (Test-Path $key)) {
    # Start-Process preserves the empty passphrase on Windows PowerShell 5.
    $process = Start-Process ssh-keygen -ArgumentList "-q -t ed25519 -N `"`" -f `"$key`"" -Wait -PassThru -WindowStyle Hidden
    if ($process.ExitCode -ne 0) { throw 'Could not generate the disposable SSH key.' }
}
Invoke-Checked docker @('compose', '-f', $compose, 'up', '--build', '-d')

$hostKey = $null
for ($attempt = 0; $attempt -lt 15; $attempt++) {
    $hostKey = & docker compose -f $compose exec -T retry cat /etc/ssh/ssh_host_ed25519_key.pub 2>$null
    if ($LASTEXITCODE -eq 0 -and $hostKey -match '^ssh-ed25519 ') { break }
    Start-Sleep -Seconds 1
}
if ($hostKey -notmatch '^ssh-ed25519 ') { throw 'The fixture host key is unavailable.' }
$known = Join-Path $ssh 'known_hosts'
Set-Content -LiteralPath $known -Value "[127.0.0.1]:2222 $hostKey" -Encoding ascii

$config = Join-Path $root 'splice.local.json'
if (-not (Test-Path $config)) {
    $settings = Get-Content -LiteralPath (Join-Path $root 'splice.example.json') -Raw | ConvertFrom-Json
    $settings.checkouts[0].path = $source
    $settings | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $config -Encoding utf8
}

$key = $key.Replace('\', '/')
$known = $known.Replace('\', '/')
Write-Output @"
Add this block to your OpenSSH config (~/.ssh/config):

Host splice-fixture
    HostName 127.0.0.1
    Port 2222
    User splice
    IdentityFile "$key"
    IdentitiesOnly yes
    UserKnownHostsFile "$known"
"@
