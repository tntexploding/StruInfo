[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('Menu', 'Start', 'Stop', 'Status', 'Open')]
  [string]$Action = 'Menu',
  [string]$ConfigPath = $env:STRUIINFO_INSTANCE_CONFIG,
  [switch]$OpenBrowser
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-ExternalPath {
  param([string]$Path)
  $parent = [System.IO.Path]::GetDirectoryName($Path)
  while ($parent) {
    if (Test-Path -LiteralPath (Join-Path $parent '.git')) {
      throw 'Configuration and control state must stay outside a Git worktree.'
    }
    $item = Get-Item -LiteralPath $parent -Force -ErrorAction SilentlyContinue
    if ($item -and ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
      throw 'Configuration and control-state directories must not use links or junctions.'
    }
    $parent = [System.IO.Path]::GetDirectoryName($parent)
  }
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  if ($item -and ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
    throw 'Configuration and control-state files must not be links.'
  }
}

function Read-InstanceConfig {
  param([string]$Path)
  if (-not $Path -or -not [System.IO.Path]::IsPathRooted($Path)) {
    throw 'Specify -ConfigPath with an absolute external JSON path, or set STRUIINFO_INSTANCE_CONFIG.'
  }
  $path = [System.IO.Path]::GetFullPath($Path)
  Assert-ExternalPath $path
  $file = Get-Item -LiteralPath $path
  if ($file.PSIsContainer -or $file.Length -gt 65536) { throw 'Invalid instance configuration file.' }
  $config = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
  $required = @('schemaVersion', 'dockerContext', 'appContainer', 'databaseContainer', 'url', 'stateFile', 'operationMutexName')
  $optional = @('dockerDesktopPath', 'startupTimeoutSeconds')
  $keys = @($config.PSObject.Properties.Name)
  foreach ($key in $required) {
    if ($key -notin $keys) { throw "Missing configuration field: $key" }
  }
  foreach ($key in $keys) {
    if ($key -notin ($required + $optional)) { throw "Unknown configuration field: $key" }
  }
  if ($config.schemaVersion -ne 1) { throw 'Unsupported instance configuration version.' }
  foreach ($key in @('dockerContext', 'appContainer', 'databaseContainer')) {
    if ($config.$key -isnot [string] -or $config.$key -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$') {
      throw "Invalid configuration field: $key"
    }
  }
  if ($config.appContainer -eq $config.databaseContainer) { throw 'Application and database must be different containers.' }
  $url = $null
  if ($config.url -isnot [string] -or -not [Uri]::TryCreate($config.url, [UriKind]::Absolute, [ref]$url) -or
      $url.Scheme -notin @('http', 'https') -or $url.Host -notin @('127.0.0.1', 'localhost', '[::1]') -or
      $url.UserInfo -or $url.Query -or $url.Fragment -or $url.AbsolutePath -ne '/') {
    throw 'url must be an HTTP(S) loopback origin without credentials, a query or a fragment.'
  }
  if ($config.stateFile -isnot [string] -or -not [System.IO.Path]::IsPathRooted($config.stateFile)) {
    throw 'stateFile must be an absolute external path.'
  }
  $stateFile = [System.IO.Path]::GetFullPath($config.stateFile)
  Assert-ExternalPath $stateFile
  if ($stateFile -eq $path -or (Test-Path -LiteralPath $stateFile -PathType Container)) {
    throw 'stateFile must be distinct from the configuration and name a file.'
  }
  if ($config.operationMutexName -isnot [string] -or $config.operationMutexName -notmatch '^Local\\[a-zA-Z0-9_.-]{1,120}$') {
    throw 'operationMutexName must name a Local Windows mutex shared with maintenance.'
  }
  $desktopPath = $null
  if ('dockerDesktopPath' -in $keys -and $config.dockerDesktopPath) {
    $desktopPath = $config.dockerDesktopPath
    if ($desktopPath -isnot [string] -or -not [System.IO.Path]::IsPathRooted($desktopPath) -or
        [System.IO.Path]::GetFileName($desktopPath) -ine 'Docker Desktop.exe' -or
        -not (Test-Path -LiteralPath $desktopPath -PathType Leaf)) {
      throw 'dockerDesktopPath must point to the installed Docker Desktop.exe.'
    }
  }
  $timeout = 120
  if ('startupTimeoutSeconds' -in $keys) {
    if ($config.startupTimeoutSeconds -isnot [int] -and $config.startupTimeoutSeconds -isnot [long]) {
      throw 'startupTimeoutSeconds must be an integer.'
    }
    $timeout = $config.startupTimeoutSeconds
    if ($timeout -lt 5 -or $timeout -gt 300) { throw 'startupTimeoutSeconds must be between 5 and 300.' }
  }
  return [pscustomobject]@{
    DockerContext = $config.dockerContext
    AppContainer = $config.appContainer
    DatabaseContainer = $config.databaseContainer
    Url = $url.AbsoluteUri.TrimEnd('/')
    StateFile = $stateFile
    OperationMutexName = $config.operationMutexName
    DockerDesktopPath = $desktopPath
    StartupTimeoutSeconds = $timeout
  }
}

function ConvertTo-InstanceProcessArgument {
  param([string]$Value)
  # Windows argv quoting, including embedded quotes and trailing backslashes.
  $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
  $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
  return '"' + $escaped + '"'
}

function Invoke-InstanceProcess {
  param([string]$FilePath, [string[]]$Arguments, [int]$TimeoutSeconds)
  $process = [System.Diagnostics.Process]::new()
  $started = $false
  try {
    $process.StartInfo.FileName = $FilePath
    $process.StartInfo.Arguments = ($Arguments | ForEach-Object { ConvertTo-InstanceProcessArgument $_ }) -join ' '
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.CreateNoWindow = $true
    $process.StartInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $process.StartInfo.RedirectStandardOutput = $true
    $process.StartInfo.RedirectStandardError = $true
    $started = $process.Start()
    if (-not $started) { throw 'The instance control command could not start.' }
    # Drain both pipes concurrently so a full stderr pipe cannot block the CLI.
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit([Math]::Max(1, $TimeoutSeconds) * 1000)) {
      throw 'The instance control command timed out. Container state may still be changing; retry Status.'
    }
    if (-not $stdout.Wait(1000) -or -not $stderr.Wait(1000)) {
      throw 'The instance control command output could not be read within the timeout.'
    }
    return [pscustomobject]@{
      ExitCode = $process.ExitCode
      Output = (@($stdout.Result, $stderr.Result) -join "`n").Trim()
    }
  } finally {
    if ($started -and -not $process.HasExited) {
      # Only this owned CLI process is terminated; never its daemon or containers.
      try { $process.Kill(); $process.WaitForExit(1000) | Out-Null } catch { }
    }
    $process.Dispose()
  }
}

function Invoke-InstanceDocker {
  param($Config, [string[]]$Arguments, [int]$TimeoutSeconds = 0)
  if ($TimeoutSeconds -le 0) { $TimeoutSeconds = $Config.StartupTimeoutSeconds }
  $docker = (Get-Command docker.exe -CommandType Application -ErrorAction Stop).Source
  return Invoke-InstanceProcess $docker (@('--context', $Config.DockerContext) + $Arguments) $TimeoutSeconds
}

function Assert-LocalDockerContext {
  param($Config)
  $result = Invoke-InstanceDocker $Config @('context', 'inspect', '--format', '{{.Endpoints.docker.Host}}', $Config.DockerContext)
  if ($result.ExitCode -ne 0 -or $result.Output -notmatch '^npipe:////(?:\.|localhost)/pipe/[a-zA-Z0-9_.-]+$') {
    throw 'The configured Docker context must exist and use a local Windows named pipe.'
  }
}

function Test-DockerReady {
  param($Config)
  $result = Invoke-InstanceDocker $Config @('info', '--format', '{{.ServerVersion}}')
  return $result.ExitCode -eq 0
}

function Wait-DockerReady {
  param($Config, [switch]$AllowDesktopStart)
  if (Test-DockerReady $Config) { return }
  if (-not $AllowDesktopStart -or -not $Config.DockerDesktopPath) {
    throw 'Docker is unavailable. Start Docker Desktop, then retry.'
  }
  Write-Host 'Starting Docker Desktop and waiting for its engine...'
  Start-Process -FilePath $Config.DockerDesktopPath -WindowStyle Hidden | Out-Null
  $deadline = [DateTime]::UtcNow.AddSeconds($Config.StartupTimeoutSeconds)
  do {
    Start-Sleep -Seconds 2
    if (Test-DockerReady $Config) { return }
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'Docker did not become available within the configured timeout.'
}

function Get-InstanceContainerState {
  param($Config, [string]$Name)
  $result = Invoke-InstanceDocker $Config @('container', 'inspect', '--format', '{{json .State}}', $Name)
  if ($result.ExitCode -ne 0) { throw "Container '$Name' cannot be inspected. Check the configured context and deployment." }
  try { return $result.Output | ConvertFrom-Json } catch { throw "Container '$Name' returned invalid state." }
}

function Start-InstanceContainer {
  param($Config, [string]$Name)
  $state = Get-InstanceContainerState $Config $Name
  if ($state.Paused) { throw "Container '$Name' is paused. Resolve it in Docker before starting." }
  if (-not $state.Running) {
    $result = Invoke-InstanceDocker $Config @('container', 'start', $Name)
    if ($result.ExitCode -ne 0) { throw "Container '$Name' failed to start. Inspect it in Docker." }
  }
}

function Test-ApplicationReady {
  param($Config)
  try {
    $response = Invoke-WebRequest -Uri ($Config.Url + '/health/ready') -UseBasicParsing -TimeoutSec 3 -MaximumRedirection 0
    if ($response.StatusCode -ne 200) { return $false }
    $health = $response.Content | ConvertFrom-Json
    return $health.schema_version -eq '1' -and $health.service -eq 'struinfo' -and
      $health.role -eq 'all' -and $health.status -eq 'ready' -and $health.checks.database -eq 'ready'
  } catch { return $false }
}

function Wait-InstanceReady {
  param($Config, [string]$Name, [switch]$Database)
  $deadline = [DateTime]::UtcNow.AddSeconds($Config.StartupTimeoutSeconds)
  do {
    $state = Get-InstanceContainerState $Config $Name
    if (-not $state.Running -or $state.Paused -or $state.Restarting) {
      throw "Container '$Name' is not running normally. Inspect it in Docker."
    }
    $health = $state.PSObject.Properties['Health']
    $healthy = -not $health -or $state.Health.Status -eq 'healthy'
    if ($Database) {
      if ($healthy) {
        $result = Invoke-InstanceDocker $Config @('exec', $Name, 'pg_isready', '-q')
        if ($result.ExitCode -eq 0) { return }
      }
    } elseif ($healthy -and (Test-ApplicationReady $Config)) { return }
    Start-Sleep -Seconds 2
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Container '$Name' did not become ready within the configured timeout."
}

function Write-InstanceIntent {
  param($Config, [ValidateSet('running', 'stopped')][string]$DesiredState)
  Assert-ExternalPath $Config.StateFile
  $directory = [System.IO.Path]::GetDirectoryName($Config.StateFile)
  [System.IO.Directory]::CreateDirectory($directory) | Out-Null
  $temporary = $Config.StateFile + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
  $value = [ordered]@{
    schemaVersion = 1
    desiredState = $DesiredState
    requestedAtUtc = [DateTime]::UtcNow.ToString('o')
  } | ConvertTo-Json
  try {
    [System.IO.File]::WriteAllText($temporary, $value + "`n", [System.Text.UTF8Encoding]::new($false))
    if (Test-Path -LiteralPath $Config.StateFile) {
      [System.IO.File]::Replace($temporary, $Config.StateFile, [NullString]::Value)
    } else { [System.IO.File]::Move($temporary, $Config.StateFile) }
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }
  }
}

function Start-StruInfoInstance {
  param($Config)
  Wait-DockerReady $Config -AllowDesktopStart
  # Inspect both names before changing either container.
  Get-InstanceContainerState $Config $Config.DatabaseContainer | Out-Null
  Get-InstanceContainerState $Config $Config.AppContainer | Out-Null
  Start-InstanceContainer $Config $Config.DatabaseContainer
  Wait-InstanceReady $Config $Config.DatabaseContainer -Database
  Start-InstanceContainer $Config $Config.AppContainer
  Wait-InstanceReady $Config $Config.AppContainer
  Write-InstanceIntent $Config 'running'
  Write-Host 'StruInfo is ready.'
}

function Stop-InstanceContainer {
  param($Config, [string]$Name)
  $state = Get-InstanceContainerState $Config $Name
  if ($state.Paused) { throw "Container '$Name' is paused. Resolve it in Docker before stopping." }
  if ($state.Running) {
    $result = Invoke-InstanceDocker $Config @('container', 'stop', '--time', '30', $Name) -TimeoutSeconds 35
    if ($result.ExitCode -ne 0) { throw "Container '$Name' failed to stop. No later container was stopped." }
  }
  if ((Get-InstanceContainerState $Config $Name).Running) { throw "Container '$Name' is still running." }
}

function Stop-StruInfoInstance {
  param($Config)
  # This is user intent, not a claim that both containers have already stopped.
  Write-InstanceIntent $Config 'stopped'
  Wait-DockerReady $Config
  Get-InstanceContainerState $Config $Config.AppContainer | Out-Null
  Get-InstanceContainerState $Config $Config.DatabaseContainer | Out-Null
  Stop-InstanceContainer $Config $Config.AppContainer
  Stop-InstanceContainer $Config $Config.DatabaseContainer
  Write-Host 'StruInfo application and database are stopped. Stored data is preserved.'
}

function Show-StruInfoStatus {
  param($Config)
  if (Test-Path -LiteralPath $Config.StateFile) {
    $intent = Get-Content -LiteralPath $Config.StateFile -Raw -Encoding UTF8 | ConvertFrom-Json
    Write-Host ('Requested state: ' + $intent.desiredState)
  } else { Write-Host 'Requested state: not recorded' }
  Wait-DockerReady $Config
  foreach ($name in @($Config.DatabaseContainer, $Config.AppContainer)) {
    $state = Get-InstanceContainerState $Config $name
    $health = if ($state.PSObject.Properties['Health']) { $state.Health.Status } else { 'not configured' }
    Write-Host ("{0}: {1}; health: {2}" -f $name, $state.Status, $health)
  }
  $ready = $state.Running -and -not $state.Paused -and (Test-ApplicationReady $Config)
  Write-Host ("Application ready: {0}" -f $ready)
  Write-Host $Config.Url
}

function Invoke-InstanceAction {
  param($Config, [string]$SelectedAction, [switch]$OpenAfterStart)
  $mutex = [System.Threading.Mutex]::new($false, $Config.OperationMutexName)
  $locked = $false
  try {
    try { $locked = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { throw 'An instance or maintenance operation is in progress. Retry when it finishes.' }
    Assert-LocalDockerContext $Config
    switch ($SelectedAction) {
      'Start' {
        Start-StruInfoInstance $Config
        if ($OpenAfterStart) { Start-Process -FilePath $Config.Url | Out-Null }
      }
      'Stop' { Stop-StruInfoInstance $Config }
      'Status' { Show-StruInfoStatus $Config }
      'Open' {
        Wait-DockerReady $Config
        $state = Get-InstanceContainerState $Config $Config.AppContainer
        if (-not $state.Running -or -not (Test-ApplicationReady $Config)) {
          throw 'StruInfo is not ready. Use Start before opening the application.'
        }
        Start-Process -FilePath $Config.Url | Out-Null
      }
    }
  } finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
  }
}

function Invoke-InstanceMenu {
  param($Config)
  while ($true) {
    Write-Host "`nStruInfo: [1] Start and open  [2] Stop  [3] Status  [4] Open  [Q] Exit"
    $choice = Read-Host 'Choose'
    $selected = switch ($choice) { '1' { 'Start' } '2' { 'Stop' } '3' { 'Status' } '4' { 'Open' } }
    if ($choice -eq 'q') { return }
    if ($selected) {
      try { Invoke-InstanceAction $Config $selected -OpenAfterStart } catch { Write-Host $_.Exception.Message -ForegroundColor Red }
    } else { Write-Host 'Choose 1, 2, 3, 4 or Q.' }
  }
}

if ($MyInvocation.InvocationName -ne '.') {
  try {
    $config = Read-InstanceConfig $ConfigPath
    Get-Command docker.exe -CommandType Application -ErrorAction Stop | Out-Null
    if ($Action -eq 'Menu') { Invoke-InstanceMenu $config }
    else { Invoke-InstanceAction $config $Action -OpenAfterStart:$OpenBrowser }
    exit 0
  } catch {
    Write-Host ('StruInfo control failed: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
  }
}
