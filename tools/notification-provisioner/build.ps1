param(
  [string]$IdfPath = 'C:\esp\v5.4.4\esp-idf',
  [string]$ToolsPath = 'C:\Espressif',
  [string]$BuildDirectory = 'build'
)
$ErrorActionPreference = 'Stop'
$python = Join-Path $ToolsPath 'tools\python\v5.4.4\venv\Scripts\python.exe'
$compiler = Join-Path $ToolsPath 'tools\xtensa-esp-elf\esp-14.2.0_20260121\xtensa-esp-elf\bin'
$cmake = Join-Path $ToolsPath 'tools\cmake\3.30.2\bin'
$ninja = Join-Path $ToolsPath 'tools\ninja\1.12.1'
foreach ($required in @($python, $compiler, $cmake, $ninja, (Join-Path $IdfPath 'tools\idf.py'))) {
  if (!(Test-Path -LiteralPath $required)) { throw 'Required installed ESP-IDF 5.4.4 tools are unavailable.' }
}
$env:IDF_PATH = $IdfPath
$env:IDF_TOOLS_PATH = Join-Path $ToolsPath 'tools'
$env:IDF_PYTHON_ENV_PATH = Split-Path (Split-Path $python)
$env:IDF_COMPONENT_MANAGER = '0'
$env:IDF_CCACHE_ENABLE = '0'
$env:ESP_ROM_ELF_DIR = Join-Path $ToolsPath 'tools\esp-rom-elfs\20241011'
$env:PATH = "$compiler;$cmake;$ninja;$(Split-Path $python);$env:PATH"
Push-Location $PSScriptRoot
try {
  $configHash = (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'sdkconfig.defaults') -Algorithm SHA256).Hash.Substring(0,12)
  if($BuildDirectory -notmatch '^build(?:-[A-Za-z0-9-]+)?$'){throw 'Use a local versioned build directory.'}
  $buildPath=Join-Path $PSScriptRoot $BuildDirectory
  $configPath = Join-Path $buildPath "sdkconfig-$configHash"
  $hideFlashHints = $false
  & $python (Join-Path $IdfPath 'tools\idf.py') -B $buildPath -DIDF_TARGET=esp32 "-DSDKCONFIG=$configPath" build 2>&1 | ForEach-Object {
    if ([string]$_ -match 'Project build complete\. To flash') { $hideFlashHints = $true }
    if (!$hideFlashHints) { Write-Output $_ }
  }
  if ($LASTEXITCODE -ne 0) { throw 'RAM provisioner build failed.' }
  & $python (Join-Path $PSScriptRoot 'image_info.py') --image (Join-Path $buildPath 'hatchai_usb_provisioner.bin') --write-manifest
  if ($LASTEXITCODE -ne 0) { throw 'RAM-only image validation failed.' }
  Write-Output 'RAM IMAGE ONLY: ignore generic IDF flash suggestions above. NEVER run idf.py flash for this utility. Use provision.py.'
}
finally { Pop-Location }
