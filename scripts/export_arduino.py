"""Export the current integrated firmware without overwriting an existing sketch."""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import zipfile

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--output',default='dist/HatchAI_Recovery')
args=parser.parse_args()
out=(ROOT/args.output).resolve()
if not out.is_relative_to(ROOT) or out==ROOT:
    raise SystemExit('Export directory must be inside this workspace.')
if out.exists() or out.with_suffix('.zip').exists():
    raise SystemExit('Export already exists. Select a new --output path; existing work is preserved.')
out.mkdir(parents=True)
name=out.name
manifest={}
for source in sorted((ROOT/'include').glob('*.h'))+sorted((ROOT/'src').glob('*.cpp')):
    target=out/(f'{name}.ino' if source.name=='main.cpp' else source.name)
    shutil.copyfile(source,target)
    manifest[str(target.relative_to(out))]={'source':str(source.relative_to(ROOT)),
        'sha256':hashlib.sha256(source.read_bytes()).hexdigest()}
shutil.copytree(ROOT/'data',out/'data')
(out/'docs').mkdir()
shutil.copyfile(ROOT/'docs/SD_RECOVERY.md',out/'docs/SD_RECOVERY.md')
shutil.copyfile(ROOT/'docs/THERMOSTAT_CONTROL.md',out/'docs/THERMOSTAT_CONTROL.md')
(out/'source-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
(out/'README.md').write_text(f'''# HatchAI integrated recovery sketch

Open `{name}.ino` in Arduino IDE. Keep all .cpp/.h files beside it.
Select ESP32 Dev Module with Arduino-ESP32 2.0.17. Install DHT sensor library
1.4.7, Adafruit Unified Sensor 1.1.15 and ArduinoJson 6.21.5. Other libraries
are bundled with the ESP32 core. Read docs/SD_RECOVERY.md before deployment.

The existing complete UI is in data/. Flashing a sketch does not upload SPIFFS
web files. Use your existing compatible ESP32 filesystem uploader, or the
included PlatformIO environment for separate firmware/filesystem builds.
Never upload or test with connected AC loads until separately authorized and
supervised. This archive was generated locally; it was not deployed.

Pins: fan14, bulb27, lower26, upper25; active LOW. DHT22 DATA4. DS3231/LCD
SDA21/SCL22. SD CS5/SCK18/MISO19/MOSI23. Target37.5C, thermostat +/-0.3C hysteresis,
fan always ON; calibrated turners default15s/120min. Motor position feedback
is not present. Automatic turning stays OFF until recovery and batch schedules are verified.

source-manifest.json maps the firmware files to their original paths and hashes.
Thermostat control uses the current sensor and temperature safety limits.
Synthetic SD state examples are deliberately excluded from this deployment export.
''',encoding='utf-8')
(out/'platformio.ini').write_text('''[platformio]
src_dir = .
include_dir = .
data_dir = data

[env:esp32dev]
platform = espressif32@7.0.1
board = esp32dev
framework = arduino
monitor_speed = 115200
board_build.filesystem = spiffs
build_src_filter = +<*.cpp> +<*.ino> -<.pio/> -<data/> -<docs/>
lib_deps =
    adafruit/DHT sensor library@1.4.7
    bblanchon/ArduinoJson@6.21.5
''')
archive=out.with_suffix('.zip')
with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED) as zipped:
    for source in sorted(out.rglob('*')):
        if source.is_file(): zipped.write(source,Path(out.name)/source.relative_to(out))
print(json.dumps({'sketch':str(out/f'{name}.ino'),'archive':str(archive),'firmwareFiles':len(manifest)}))
