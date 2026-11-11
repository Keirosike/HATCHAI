import json,pathlib,re,subprocess
root=pathlib.Path.cwd();build=root/'esp32-devcam/camera/build';commands=json.loads((build/'compile_commands.json').read_text(encoding='utf-8'));entry=next(x for x in commands if x['file'].replace('\\','/').endswith('/main/camera.cpp'))
base=re.sub(r' -o .*? -c .*$', '',entry['command']);extra=' -I'+(root/'include').as_posix()+' -I'+(root/'.pio/libdeps/esp32dev/ArduinoJson/src').as_posix()+' -IC:/esp/v5.4.4/esp-idf/components/json/cJSON -IC:/esp/v5.4.4/esp-idf/components/esp-tls/private_include'
for role in ['UPPER','LOWER']:
 for file in ['esp32-devcam/camera/main/camera_cloud.cpp','esp32-devcam/camera/main/camera.cpp','src/NotificationPairingProtocol.cpp','src/NotificationHttpParser.cpp','src/NotificationTransportResult.cpp','src/NotificationUtcClock.cpp']:
  command=base+extra+(' -Wno-error=misleading-indentation' if file.startswith('src/Notification') else '')+' -DHATCHAI_CAMERA_'+role+' -fsyntax-only '+(root/file).as_posix();result=subprocess.run(command,cwd=build,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  if result.returncode:
   print('\n'.join(line for line in result.stderr.splitlines() if 'error:' in line));raise SystemExit(result.returncode)
  print('PASS: ESP-IDF 5.4.4 '+role+' '+file)
