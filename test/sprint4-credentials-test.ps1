# Synthetic credentials only, isolated from the real user's provisioning directory.
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot
$saved=$env:LOCALAPPDATA
$temporary=Join-Path $root ('test/.build/synthetic-dpapi-'+[Guid]::NewGuid().ToString('N'))
try {
 $env:LOCALAPPDATA=$temporary
 $tool=Join-Path $root 'tools/sprint4-credentials.ps1'
 $result=@(& $tool -Action Create)
 if(($result -join '') -match '"key"\s*:'){throw 'Credential output leaked.'}
 $path=Join-Path $temporary 'HATCHAI-Provisioning/sprint4-devices.dpapi'
 $before=[IO.File]::ReadAllText($path)
 $rejected=$false
 try {& $tool -Action Create | Out-Null}catch{$rejected=$true}
 if(!$rejected -or [IO.File]::ReadAllText($path) -ne $before){throw 'Replacement guard failed.'}
 & $tool -Action Inspect | Out-Null
 [IO.File]::WriteAllText($path,'damaged synthetic fixture')
 $rejected=$false
 try {& $tool -Action Inspect | Out-Null}catch{$rejected=$true}
 if(!$rejected){throw 'Corruption guard failed.'}
 Write-Output 'PASS: synthetic DPAPI roundtrip, sanitized output, replacement refusal and corruption rejection (4 checks). No cloud or serial access.'
} finally {$env:LOCALAPPDATA=$saved}
