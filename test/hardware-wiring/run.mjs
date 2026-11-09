import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const build=path.join(root,'test/notification-pairing/.build');mkdirSync(build,{recursive:true});
const exe=path.join(build,'hardware-wiring.exe');
const zig=process.env.HATCHAI_ZIG||path.join(root,'test/notification-pairing/.tools/ziglang/zig.exe');
for(const [command,args] of [[zig,['c++','-std=c++14','-O1','-DARDUINOJSON_ENABLE_ARDUINO_STRING=0','-Itest/hardware-wiring','-Iinclude','-I.pio/libdeps/esp32dev/ArduinoJson/src','src/Dht22Sensor.cpp','src/OutputDevice.cpp','test/hardware-wiring/native.cpp','-o',exe]],[exe,[]]]){
 const result=spawnSync(command,args,{cwd:root,encoding:'utf8',timeout:600000,env:{...process.env,ZIG_GLOBAL_CACHE_DIR:path.join(build,'zig-cache')}});
 if(result.status!==0)throw Error(result.stderr||result.error||result.stdout);
 process.stdout.write(result.stdout);
}
