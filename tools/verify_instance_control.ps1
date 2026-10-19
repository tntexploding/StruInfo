# Run with Windows PowerShell 5.1 or PowerShell 7. No Docker or network is used.
$ErrorActionPreference = 'Stop'
$controller = Join-Path $PSScriptRoot '../deploy/windows/instance-control.ps1'
. $controller
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('struinfo-control-test-' + [Guid]::NewGuid().ToString('N'))
[System.IO.Directory]::CreateDirectory($testRoot) | Out-Null
$script:passed = 0

function Assert-True {
  param([bool]$Value, [string]$Message)
  if (-not $Value) { throw $Message }
}

function Assert-Throws {
  param([scriptblock]$Block, [string]$Pattern)
  try { & $Block } catch {
    if ($_.Exception.Message -like $Pattern) { return }
    throw
  }
  throw "Expected failure matching: $Pattern"
}

function New-TestConfig {
  return [pscustomobject]@{
    DockerContext = 'synthetic-local'
    AppContainer = 'synthetic-app'
    DatabaseContainer = 'synthetic-database'
    Url = 'http://127.0.0.1:3000'
    StateFile = Join-Path $testRoot 'control-state.json'
    OperationMutexName = 'Local\StruInfo-test-' + [Guid]::NewGuid().ToString('N')
    DockerDesktopPath = $null
    StartupTimeoutSeconds = 0
  }
}

function Reset-FakeDocker {
  $script:calls = [System.Collections.Generic.List[string]]::new()
  $script:running = @{ 'synthetic-app' = $false; 'synthetic-database' = $false }
  $script:engine = $true
  $script:ready = $true
  $script:failStop = $false
  $script:missingApp = $false
  $script:remoteContext = $false
  $script:remotePipe = $false
  $script:launchStyle = $null
  if (Test-Path -LiteralPath (Join-Path $testRoot 'control-state.json')) {
    Remove-Item -LiteralPath (Join-Path $testRoot 'control-state.json')
  }
}

function Invoke-InstanceDocker {
  param($Config, [string[]]$Arguments, [int]$TimeoutSeconds = 0)
  Assert-True ($Config.DockerContext -eq 'synthetic-local') 'Docker context was lost.'
  $command = $Arguments -join ' '
  $script:calls.Add($command)
  $code = 0
  $output = ''
  switch ($Arguments[0]) {
    'context' { $output = if ($script:remoteContext) { 'ssh://example.invalid' } elseif ($script:remotePipe) { 'npipe:////synthetic-remote-host/pipe/docker_engine' } else { 'npipe:////./pipe/docker_engine' } }
    'info' { if (-not $script:engine) { $code = 1 } else { $output = 'synthetic' } }
    'exec' { }
    'container' {
      $name = $Arguments[-1]
      Assert-True ($name -in @('synthetic-app', 'synthetic-database')) 'Unselected container was addressed.'
      switch ($Arguments[1]) {
        'inspect' {
          if ($script:missingApp -and $name -eq 'synthetic-app') { $code = 1 }
          else {
            $output = @{Running=$script:running[$name]; Paused=$false; Restarting=$false; Status='synthetic'} | ConvertTo-Json -Compress
          }
        }
        'start' { $script:running[$name] = $true }
        'stop' {
          if ($script:failStop -and $name -eq 'synthetic-app') { $code = 1 }
          else { $script:running[$name] = $false }
        }
        default { throw "Unexpected command: $command" }
      }
    }
    default { throw "Unexpected command: $command" }
  }
  return [pscustomobject]@{ ExitCode = $code; Output = $output }
}

function Invoke-WebRequest {
  param($Uri, [switch]$UseBasicParsing, $TimeoutSec, $MaximumRedirection)
  Assert-True ($Uri -eq 'http://127.0.0.1:3000/health/ready') 'Unexpected readiness URL.'
  Assert-True ($MaximumRedirection -eq 0) 'Readiness allowed redirects.'
  $status = if ($script:ready) { 'ready' } else { 'not_ready' }
  $body = @{schema_version='1'; service='struinfo'; role='all'; status=$status; checks=@{database=$status}} | ConvertTo-Json -Compress
  return [pscustomobject]@{StatusCode=200; Content=$body}
}
function Start-Sleep { param($Seconds) }
function Start-Process {
  param($FilePath, $WindowStyle)
  $script:launchStyle = $WindowStyle
  $script:engine = $true
}

function Test-Case {
  param([string]$Name, [scriptblock]$Block)
  Reset-FakeDocker
  & $Block
  $script:passed++
  Write-Host "PASS $Name"
}

try {
  Test-Case 'Start waits for database before app and is idempotent' {
    $config = New-TestConfig
    Start-StruInfoInstance $config
    Start-StruInfoInstance $config
    $starts = @($script:calls | Where-Object { $_ -like 'container start *' })
    Assert-True (($starts -join ',') -eq 'container start synthetic-database,container start synthetic-app') 'Wrong start order or duplicate starts.'
    $dbReady = $script:calls.IndexOf('exec synthetic-database pg_isready -h 127.0.0.1 -q')
    Assert-True ($dbReady -ge 0 -and $dbReady -lt $script:calls.IndexOf('container start synthetic-app')) 'App started before TCP database readiness.'
    $state = Get-Content -LiteralPath $config.StateFile -Raw | ConvertFrom-Json
    Assert-True ($state.schemaVersion -eq 1 -and $state.desiredState -eq 'running') 'Ready intent was not saved.'
  }
  Test-Case 'Stop records intent, stops app before database and is idempotent' {
    $config = New-TestConfig
    $script:running['synthetic-app'] = $true
    $script:running['synthetic-database'] = $true
    Stop-StruInfoInstance $config
    Stop-StruInfoInstance $config
    $stops = @($script:calls | Where-Object { $_ -like 'container stop *' })
    Assert-True (($stops -join ',') -eq 'container stop --time 30 synthetic-app,container stop --time 30 synthetic-database') 'Wrong stop order or duplicate stops.'
    $state = Get-Content -LiteralPath $config.StateFile -Raw | ConvertFrom-Json
    Assert-True ($state.desiredState -eq 'stopped') 'Stop intent was not saved.'
  }
  Test-Case 'Failed app stop preserves database and fails visibly' {
    $config = New-TestConfig
    $script:running['synthetic-app'] = $true
    $script:running['synthetic-database'] = $true
    $script:failStop = $true
    Assert-Throws { Stop-StruInfoInstance $config } '*failed to stop*'
    Assert-True $script:running['synthetic-database'] 'Database stopped after application failure.'
    Assert-True ((Get-Content -LiteralPath $config.StateFile -Raw | ConvertFrom-Json).desiredState -eq 'stopped') 'Failed stop lost user intent.'
  }
  Test-Case 'Missing configured app prevents any container start' {
    $config = New-TestConfig
    $script:missingApp = $true
    Assert-Throws { Start-StruInfoInstance $config } '*cannot be inspected*'
    Assert-True (@($script:calls | Where-Object { $_ -like 'container start *' }).Count -eq 0) 'A partial deployment was started.'
  }
  Test-Case 'App readiness timeout never clears stopped intent' {
    $config = New-TestConfig
    Write-InstanceIntent $config 'stopped'
    $script:ready = $false
    Assert-Throws { Start-StruInfoInstance $config } '*did not become ready*'
    Assert-True ((Get-Content -LiteralPath $config.StateFile -Raw | ConvertFrom-Json).desiredState -eq 'stopped') 'Failed start claimed readiness.'
  }
  Test-Case 'Docker Desktop is started hidden only when configured and needed' {
    $config = New-TestConfig
    $script:engine = $false
    Assert-Throws { Wait-DockerReady $config -AllowDesktopStart } '*Docker is unavailable*'
    $config.DockerDesktopPath = 'C:\synthetic\Docker Desktop.exe'
    Wait-DockerReady $config -AllowDesktopStart
    Assert-True ($script:launchStyle -eq 'Hidden') 'Docker Desktop was launched visibly.'
  }
  Test-Case 'Stop never launches Docker Desktop' {
    $config = New-TestConfig
    $config.DockerDesktopPath = 'C:\synthetic\Docker Desktop.exe'
    $script:engine = $false
    Assert-Throws { Stop-StruInfoInstance $config } '*Docker is unavailable*'
    Assert-True ($null -eq $script:launchStyle) 'Stop launched Docker Desktop.'
  }
  Test-Case 'Remote Docker context is rejected before mutation' {
    $config = New-TestConfig
    $script:remoteContext = $true
    Assert-Throws { Invoke-InstanceAction $config 'Stop' } '*local Windows named pipe*'
    Assert-True (-not (Test-Path -LiteralPath $config.StateFile)) 'Rejected context wrote stop intent.'
  }
  Test-Case 'Remote named pipe is rejected before mutation' {
    $config = New-TestConfig
    $script:remotePipe = $true
    Assert-Throws { Invoke-InstanceAction $config 'Stop' } '*local Windows named pipe*'
    Assert-True (-not (Test-Path -LiteralPath $config.StateFile)) 'Remote named pipe wrote stop intent.'
    Assert-True (@($script:calls | Where-Object { $_ -like 'container *' }).Count -eq 0) 'Remote named pipe addressed containers.'
  }
  Test-Case 'External configuration validation accepts bounded local settings' {
    $path = Join-Path $testRoot 'config.json'
    $raw = @{
      schemaVersion=1; dockerContext='synthetic-local'; appContainer='synthetic-app'; databaseContainer='synthetic-database';
      url='http://127.0.0.1:3000/'; stateFile=(Join-Path $testRoot 'control-state.json'); operationMutexName='Local\Synthetic'; startupTimeoutSeconds=10
    }
    $raw | ConvertTo-Json | Set-Content -LiteralPath $path -Encoding UTF8
    $config = Read-InstanceConfig $path
    Assert-True ($config.StartupTimeoutSeconds -eq 10) 'Configuration timeout lost.'
    $raw.url = 'https://example.invalid/'
    $raw | ConvertTo-Json | Set-Content -LiteralPath $path -Encoding UTF8
    Assert-Throws { Read-InstanceConfig $path } '*loopback origin*'
    $raw.url = 'http://127.0.0.1:3000/'
    $raw.databaseContainer = $raw.appContainer
    $raw | ConvertTo-Json | Set-Content -LiteralPath $path -Encoding UTF8
    Assert-Throws { Read-InstanceConfig $path } '*different containers*'
  }
  Test-Case 'Owned process preserves native arguments and captures both output streams' {
    $path = Join-Path $testRoot 'synthetic-command.ps1'
    @'
param([string]$Value)
[Console]::Out.WriteLine($Value)
[Console]::Error.WriteLine('synthetic-stderr')
exit 7
'@ | Set-Content -LiteralPath $path -Encoding UTF8
    $value = 'synthetic space "quote" trailing\'
    $powershell = (Get-Process -Id $PID).Path
    $result = Invoke-InstanceProcess $powershell @('-NoProfile', '-File', $path, '-Value', $value) 10
    Assert-True ($result.ExitCode -eq 7) 'Child exit code was lost.'
    Assert-True ($result.Output.Contains($value)) 'Native argument quoting changed the value.'
    Assert-True ($result.Output.Contains('synthetic-stderr')) 'Standard error was not captured.'
  }
  Test-Case 'Blocked owned process times out and only its process is terminated' {
    $path = Join-Path $testRoot 'synthetic-blocked-command.ps1'
    $pidFile = Join-Path $testRoot 'synthetic-child.pid'
    @'
param([string]$PidFile)
[System.IO.File]::WriteAllText($PidFile, [string]$PID)
Start-Sleep -Seconds 60
'@ | Set-Content -LiteralPath $path -Encoding UTF8
    $powershell = (Get-Process -Id $PID).Path
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    Assert-Throws { Invoke-InstanceProcess $powershell @('-NoProfile', '-File', $path, '-PidFile', $pidFile) 3 } '*command timed out*'
    $watch.Stop()
    Assert-True ($watch.Elapsed.TotalSeconds -lt 10) 'Blocked CLI was not bounded.'
    $childId = [int](Get-Content -LiteralPath $pidFile -Raw)
    Assert-True ($null -eq (Get-Process -Id $childId -ErrorAction SilentlyContinue)) 'Owned child remained running.'
    Assert-True ($null -ne (Get-Process -Id $PID -ErrorAction SilentlyContinue)) 'The controller process was terminated.'
  }
  Test-Case 'Git worktree configuration is rejected' {
    $path = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../deploy/windows/instance-control.example.json'))
    Assert-Throws { Read-InstanceConfig $path } '*outside a Git worktree*'
  }
  Write-Host "$script:passed focused synthetic checks passed. No Docker or network calls were made."
} finally {
  $resolved = [System.IO.Path]::GetFullPath($testRoot)
  $temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  if ($resolved.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -and
      [System.IO.Path]::GetFileName($resolved).StartsWith('struinfo-control-test-')) {
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
