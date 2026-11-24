param(
  [Parameter(Mandatory=$true)][string]$Worktree,
  [Parameter(Mandatory=$true)][string]$RuntimeDirectory,
  [Parameter(Mandatory=$true)][string]$WarehouseRepo,
  [Parameter(Mandatory=$true)][string]$NodePath
)
$ErrorActionPreference = 'Stop'
$Worktree = [IO.Path]::GetFullPath($Worktree)
$RuntimeDirectory = [IO.Path]::GetFullPath($RuntimeDirectory)
$name = 'NextTrade-Warehouse-Release-Worker'
if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) { throw 'Worker task already exists; inspect and explicitly update it, never silently replace another worker.' }
if (Test-Path -LiteralPath (Join-Path $RuntimeDirectory 'runtime.json')) { throw 'Existing worker runtime must be reviewed before replacement.' }
$credential = Join-Path $RuntimeDirectory 'credential.json'
if (!(Test-Path -LiteralPath $credential -PathType Leaf)) { throw 'Create and register the dedicated worker credential first.' }
$commit = (& git -C $Worktree rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[a-f0-9]{40}$') { throw 'Verified committed worktree required.' }
$dirty = & git -C $Worktree status --porcelain -- release-management/lib release-management/deploy
if ($dirty) { throw 'Commit and QA the worker before installation.' }
$config = Get-Content -LiteralPath (Join-Path $Worktree 'release-management/deploy/config.json') -Raw | ConvertFrom-Json
$config.sshAuthorized = $true
$config.liveExecutionEnabled = $true
$deployConfig = Join-Path $RuntimeDirectory 'deploy.json'
[IO.File]::WriteAllText($deployConfig, ($config | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))
$runtimePath = Join-Path $RuntimeDirectory 'runtime.json'
$runtime = @{ worktree=$Worktree; commit=$commit; node=$NodePath; credential=$credential; warehouseRepo=$WarehouseRepo; deployConfig=$deployConfig } | ConvertTo-Json
[IO.File]::WriteAllText($runtimePath, $runtime, (New-Object Text.UTF8Encoding($false)))
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $credential /inheritance:r /grant:r "${identity}:(R,W)" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict the worker credential file.' }
$script = Join-Path $Worktree 'release-management/deploy/run-worker.ps1'
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -File "' + $script + '" -RuntimeConfig "' + $runtimePath + '"'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $Worktree
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -Hidden -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description ('NT Warehouse approved releases. Pinned commit ' + $commit) | Select-Object TaskName,State
Start-ScheduledTask -TaskName $name
