$ErrorActionPreference='Stop'
$env:IDF_PATH='C:\esp\v5.4.4\esp-idf'
$env:IDF_TOOLS_PATH='C:\Espressif\tools'
$env:IDF_PYTHON_ENV_PATH='C:\Espressif\tools\python\v5.4.4\venv'
$env:IDF_COMPONENT_MANAGER='0'
$env:IDF_CCACHE_ENABLE='0'
$env:ESP_ROM_ELF_DIR='C:\Espressif\tools\esp-rom-elfs\20241011'
$env:PATH="C:\Espressif\tools\xtensa-esp-elf\esp-14.2.0_20260121\xtensa-esp-elf\bin;C:\Espressif\tools\cmake\3.30.2\bin;C:\Espressif\tools\ninja\1.12.1;$env:IDF_PYTHON_ENV_PATH\Scripts;$env:PATH"
$py="$env:IDF_PYTHON_ENV_PATH\Scripts\python.exe"
Push-Location $PSScriptRoot
try {
 & $py "$env:IDF_PATH\tools\idf.py" -B build -DIDF_TARGET=esp32 '-DSDKCONFIG=build/sdkconfig' '-DSDKCONFIG_DEFAULTS=../notification-provisioner/sdkconfig.defaults' build
 if($LASTEXITCODE){throw 'Diagnostic build failed'}
 & $py ..\notification-provisioner\image_info.py --image build\hatchai_operation_diagnostic.bin --write-manifest
 if($LASTEXITCODE){throw 'Diagnostic image validation failed'}
 Write-Output 'RAM DIAGNOSTIC ONLY. Never use idf.py flash.'
} finally {Pop-Location}
