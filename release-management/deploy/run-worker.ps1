param(
  [Parameter(Mandatory=$true)][string]$RuntimeConfig
)
$ErrorActionPreference = 'Stop'
$runtime = Get-Content -LiteralPath $RuntimeConfig -Raw | ConvertFrom-Json
$worktree = [IO.Path]::GetFullPath($runtime.worktree)
$log = Join-Path ([IO.Path]::GetDirectoryName($RuntimeConfig)) 'worker.log'
try {
  $head = (& git -C $worktree rev-parse HEAD).Trim()
  $dirty = & git -C $worktree status --porcelain -- release-management/lib release-management/deploy
  if ($LASTEXITCODE -ne 0 -or $head -ne $runtime.commit -or $dirty) { throw 'Worker source changed. Re-review and reinstall the pinned worker; execution stopped.' }
  $result = & $runtime.node (Join-Path $worktree 'release-management/deploy/worker.js') --config $runtime.deployConfig --credential $runtime.credential --warehouse-repo $runtime.warehouseRepo 2>&1
  $code = $LASTEXITCODE
  Add-Content -LiteralPath $log -Value ((Get-Date -Format o) + ' ' + ($result -join ' '))
  exit $code
} catch {
  Add-Content -LiteralPath $log -Value ((Get-Date -Format o) + ' ERROR ' + $_.Exception.Message)
  exit 1
}
