# Explicit, separately approved actions only. No NVS or serial access.
[CmdletBinding()]
param([ValidateSet('Inspect','Create','Upload')][string]$Action='Inspect')
$ErrorActionPreference='Stop'
$bundlePath=Join-Path $env:LOCALAPPDATA 'HATCHAI-Provisioning/sprint4-devices.dpapi'
$identities=@(
 @{device='hatchai-inc01-controller';keyId='controller-sync-v1';binding='TELEMETRY_DEVICE_KEYS'},
 @{device='hatchai-inc01-cam01';keyId='upper-camera-v1';binding='CAMERA_EVENT_KEYS'},
 @{device='hatchai-inc01-cam02';keyId='lower-camera-v1';binding='CAMERA_EVENT_KEYS'}
)
if($Action -eq 'Create') {
 if(Test-Path -LiteralPath $bundlePath){throw 'Bundle exists; refusing replacement.'}
 $records=@();$rng=[Security.Cryptography.RandomNumberGenerator]::Create()
 try { foreach($i in $identities){$bytes=New-Object byte[] 32;$rng.GetBytes($bytes)
  $key=[Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
  $records+=@{device=$i.device;keyId=$i.keyId;binding=$i.binding;key=$key}
  [Array]::Clear($bytes,0,$bytes.Length)
 }} finally {$rng.Dispose()}
 $json=ConvertTo-Json -Depth 8 -Compress -InputObject @{version=1;records=$records}
 $protected=ConvertFrom-SecureString (ConvertTo-SecureString $json -AsPlainText -Force)
 New-Item -ItemType Directory -Force -Path (Split-Path $bundlePath) | Out-Null
 # CreateNew prevents accidental concurrent overwrite.
 $stream=[IO.File]::Open($bundlePath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write)
 try {$encoded=[Text.Encoding]::UTF8.GetBytes($protected);$stream.Write($encoded,0,$encoded.Length)}finally{$stream.Dispose()}
 $records=$null;$json=$null;$key=$null
}
if(!(Test-Path -LiteralPath $bundlePath)){throw 'No bundle. Create requires separate production-key approval.'}
$secure=ConvertTo-SecureString ([IO.File]::ReadAllText($bundlePath))
$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {$bundle=([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) | ConvertFrom-Json)}
finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
if($bundle.version -ne 1 -or @($bundle.records).Count -ne 3){throw 'Invalid bundle metadata.'}
$seen=@()
foreach($i in $identities){
 $r=@($bundle.records | Where-Object {$_.device -eq $i.device -and $_.keyId -eq $i.keyId -and $_.binding -eq $i.binding})
 if($r.Count -ne 1 -or $r[0].key -cnotmatch '^[A-Za-z0-9_-]{43}$'){throw 'Invalid credential record.'}
 $raw=[Convert]::FromBase64String($r[0].key.Replace('-','+').Replace('_','/')+'=')
 if($raw.Length -ne 32 -or $seen -contains $r[0].key){throw 'Key length or independence failure.'}
 $seen+=$r[0].key;[Array]::Clear($raw,0,$raw.Length)
}
if($Action -eq 'Upload') {
 if($env:CLOUDFLARE_ACCOUNT_ID -ne 'ecf0870e81b2fb48e1f05cdc9b34eab8'){
  throw 'Set the verified HATCHAI CLOUDFLARE_ACCOUNT_ID before an approved upload.'
 }
 $root=Split-Path $PSScriptRoot
 $config=Join-Path $root 'cloudflare-worker/wrangler.jsonc'
 $configuration=Get-Content -LiteralPath $config -Raw | ConvertFrom-Json
 if($configuration.name -ne 'hatchai'){throw 'Wrong Worker target.'}
 $wrangler=Join-Path $env:LOCALAPPDATA 'npm-cache/_npx/32026684e21afda6/node_modules/wrangler/bin/wrangler.js'
 if(!(Test-Path -LiteralPath $wrangler)){throw 'Reviewed Wrangler executable missing.'}
 $listing=& node $wrangler secret list --config $config 2>$null
 if($LASTEXITCODE -ne 0){throw 'Cannot verify existing secret names; no upload started.'}
 try {$names=@(($listing -join "`n" | ConvertFrom-Json) | ForEach-Object {$_.name})}catch{throw 'Secret inventory parsing failed.'}
 foreach($binding in @('TELEMETRY_DEVICE_KEYS','CAMERA_EVENT_KEYS')) {
  if($names -contains $binding){throw 'Device binding already exists; refusing replacement.'}
 }
 foreach($binding in @('TELEMETRY_DEVICE_KEYS','CAMERA_EVENT_KEYS')) {
  $map=@{}
  foreach($r in $bundle.records | Where-Object {$_.binding -eq $binding}){$map[$r.device]=@{};$map[$r.device][$r.keyId]=$r.key}
  $payload=ConvertTo-Json -Depth 8 -Compress -InputObject $map
  # Credentials travel through stdin, never command arguments or plaintext files.
  $payload | & node $wrangler secret put $binding --config $config 2>&1 | Out-Null
  $payload=$null;$map=$null
  if($LASTEXITCODE -ne 0){throw ('Upload failed for '+$binding+'; earlier binding may exist. Stop and reconcile; do not rerun or rotate blindly.')}
  Write-Output ($binding+' uploaded; no value displayed')
 }
}
$identities | ForEach-Object { Write-Output ($_.device+' / '+$_.keyId+' / '+$_.binding+' : validated') }
$bundle=$null;$seen=$null
Write-Output 'DPAPI protects this file for the current Windows user; it does not protect against compromise of that account. No device was provisioned.'
