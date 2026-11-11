$ErrorActionPreference='Stop'
$root=Resolve-Path (Join-Path $PSScriptRoot '../../..')
$out=Join-Path $root 'test/.build/device-provisioner'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$zig=Join-Path $root 'test/notification-pairing/.tools/ziglang/zig.exe'
& $zig c++ -std=c++17 (Join-Path $PSScriptRoot 'native.cpp') "-I$(Join-Path $PSScriptRoot '../main')" -o (Join-Path $out 'native.exe')
if($LASTEXITCODE -ne 0){throw 'Native compile failed'}
& (Join-Path $out 'native.exe')
if($LASTEXITCODE -ne 0){throw 'Native tests failed'}
& 'C:/Espressif/tools/python/v5.4.4/venv/Scripts/python.exe' -B (Join-Path $PSScriptRoot 'test_host.py')
if($LASTEXITCODE -ne 0){throw 'Host tests failed'}
