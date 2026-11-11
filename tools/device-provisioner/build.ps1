param([ValidateSet('controller','upper','lower')][string]$Board='controller')
$ErrorActionPreference='Stop'
$env:IDF_PATH='C:/esp/v5.4.4/esp-idf'
$env:IDF_TOOLS_PATH='C:/Espressif/tools'
$python='C:/Espressif/tools/python/v5.4.4/venv/Scripts/python.exe'
$env:IDF_PYTHON_ENV_PATH=Split-Path (Split-Path $python)
$env:IDF_COMPONENT_MANAGER='0';$env:IDF_CCACHE_ENABLE='0'
$env:ESP_ROM_ELF_DIR='C:/Espressif/tools/esp-rom-elfs/20241011'
$env:PATH='C:/Espressif/tools/xtensa-esp-elf/esp-14.2.0_20260121/xtensa-esp-elf/bin;C:/Espressif/tools/cmake/3.30.2/bin;C:/Espressif/tools/ninja/1.12.1;'+(Split-Path $python)+';'+$env:PATH
$role=@{controller=0;upper=1;lower=2}[$Board]
$target=if($Board -eq 'controller'){'esp32'}else{'esp32s3'}
Push-Location $PSScriptRoot
try {
 $directory=Join-Path $PSScriptRoot ('build-'+$Board)
 $hide=$false
 & $python "$env:IDF_PATH/tools/idf.py" -B $directory "-DIDF_TARGET=$target" "-DHATCH_ROLE=$role" "-DSDKCONFIG=$directory/sdkconfig" build 2>&1 | ForEach-Object {
  if([string]$_ -match "Project build complete. To flash"){$hide=$true}
  if(!$hide){Write-Output $_}
 }
 if($LASTEXITCODE -ne 0){throw 'Device RAM agent build failed.'}
 & $python (Join-Path $PSScriptRoot 'provision.py') manifest --board $Board --image "$directory/hatchai_device_setup.bin"
 if($LASTEXITCODE -ne 0){throw 'RAM image validation failed.'}
 Write-Output 'RAM ONLY: never run idf.py flash or write_flash with this utility.'
}finally{Pop-Location}
