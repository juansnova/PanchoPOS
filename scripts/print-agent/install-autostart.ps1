# Registers a scheduled task that starts the print agent when you log in to Windows.
# No admin rights needed (runs as the current user, hidden window).
#
#   powershell -ExecutionPolicy Bypass -File scripts\print-agent\install-autostart.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\print-agent\install-autostart.ps1 -Remove
param([switch]$Remove)

$taskName = 'PanchoPOS Print Agent'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

if ($Remove) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Removed '$taskName'."
    exit 0
}

if (-not (Test-Path (Join-Path $here 'agent.env'))) {
    Write-Error "Create scripts\print-agent\agent.env first (copy agent.env.example)."
    exit 2
}

$run = Join-Path $here 'run-agent.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$run`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
    -Description 'Sends PanchoPOS kitchen tickets and invoices to the thermal printer' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host "Installed '$taskName'. It starts at every logon. Log: tmp\print-agent.log"
