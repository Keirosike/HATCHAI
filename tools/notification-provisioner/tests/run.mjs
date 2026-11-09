import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const base=path.join(root,'tools/notification-provisioner');const build=path.join(base,'.native');mkdirSync(build,{recursive:true});
const zig=process.env.HATCHAI_ZIG||path.join(root,'test/notification-pairing/.tools/ziglang/zig.exe');
function run(command,args){const r=spawnSync(command,args,{cwd:root,encoding:'utf8',timeout:600000,env:{...process.env,ZIG_GLOBAL_CACHE_DIR:path.join(root,'test/notification-pairing/.build/zig-cache')}});if(r.status!==0)throw Error(r.stderr||r.stdout||r.error);return r.stdout;}
const outputs=[];
const authExe=path.join(build,'authorization.exe');
run(zig,['c++','-std=c++14','-O1','-Itools/notification-provisioner/main','tools/notification-provisioner/tests/authorization.cpp','-o',authExe]);
process.stdout.write(run(authExe,[]));
for(const real of [true,false]){
 const exe=path.join(build,real?'production-codec.exe':'ram-codec.exe');
 run(zig,['c++','-std=c++14','-O1','-Wall','-Wextra','-Iinclude','-Itools/notification-provisioner/main','-I.pio/libdeps/esp32dev/ArduinoJson/src',
  'src/NotificationCredentialStore.cpp',real?'src/NotificationPairingProtocol.cpp':'tools/notification-provisioner/main/codec_support.cpp',
  'tools/notification-provisioner/main/provision_core.cpp','tools/notification-provisioner/tests/native.cpp','-lbcrypt','-o',exe]);
 process.stdout.write(`${real?'Production':'RAM adapter'}: `+run(exe,[]));outputs.push(run(exe,['--record']).trim());
}
assert.equal(outputs[0],outputs[1]);
const python=process.env.HATCHAI_PROVISION_PYTHON||'C:/Espressif/tools/python/v5.4.4/venv/Scripts/python.exe';
const encoded=run(python,['-c',`import sys;sys.path.insert(0,r'${base.replaceAll('\\','/')}');from provision import record;print(record(bytes(range(32)),'controller-v1',1).hex())`]).trim();
assert.equal(encoded,outputs[0]);console.log('Exact Python / production C++ / RAM adapter credential blob compatibility passed.');
