# Runs the print agent forever: loads agent.env, restarts the agent if it exits.
# Started at logon by install-autostart.ps1; can also be run by hand.

$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Resolve-Path (Join-Path $here '..\..')
$envFile = Join-Path $here 'agent.env'
$logDir = Join-Path $root 'tmp'
$log = Join-Path $logDir 'print-agent.log'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

if (-not (Test-Path $envFile)) {
    "agent.env not found: copy agent.env.example to agent.env and fill it in" | Out-File $log -Append -Encoding utf8
    exit 2
}

foreach ($line in Get-Content $envFile) {
    $line = $line.Trim()
    if ($line -eq '' -or $line.StartsWith('#')) { continue }
    $name, $value = $line -split '=', 2
    [Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim().Trim('"'), 'Process')
}

$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) {
    "python not found in PATH" | Out-File $log -Append -Encoding utf8
    exit 3
}

while ($true) {
    # Keep the log from growing forever.
    if ((Test-Path $log) -and (Get-Item $log).Length -gt 2MB) { Remove-Item $log -Force }
    "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] starting agent" | Out-File $log -Append -Encoding utf8
    # Pipe through Out-File: plain '>>' would write UTF-16 on Windows PowerShell 5.1.
    & $python -u (Join-Path $here 'print_agent.py') 2>&1 | ForEach-Object { "$_" } | Out-File $log -Append -Encoding utf8
    "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] agent exited ($LASTEXITCODE), restarting in 5s" | Out-File $log -Append -Encoding utf8
    Start-Sleep -Seconds 5
}
