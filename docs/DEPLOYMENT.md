# HatchAI deployment

This package contains the current thermostat firmware, required headers,
SPIFFS assets, PlatformIO configuration and a SHA-256 source manifest.
It excludes development tools, tests, backups, old exports, PID examples,
preview screenshots and synthetic SD recovery records.

Extract the HatchAI folder and run commands from that folder. The validated
environment is esp32dev, Espressif32 7.0.1 / Arduino-ESP32 2.0.17. Required
libraries are declared in platformio.ini.

Build firmware and web filesystem separately:

```powershell
platformio run -e esp32dev
platformio run -e esp32dev --target buildfs
```

These commands do not upload. When deployment to the connected board is
authorized and its hardware is ready, both uploads are required:

```powershell
platformio run -e esp32dev --target upload
platformio run -e esp32dev --target uploadfs
```

Refresh the browser after updating SPIFFS. Do not copy synthetic batch-state
files onto the SD card. Existing batch dates, NVS settings and SD logs are
not cleared by this packaging/cleanup operation.

The bulb uses thermostat hysteresis: at the 37.5 C default, ON below 37.2 C,
OFF above 37.8 C, otherwise retain state. The five-second minimum OFF time,
sensor qualification and thermal cutoffs remain. The fan runs in automatic mode, during heating and during sensor/thermal faults. Safe manual fan OFF is supported. Relay pins
are fan 14, bulb 27, lower roller 26 and upper roller 25, all active LOW.
DHT22 DATA is GPIO4; RTC/LCD use SDA21/SCL22; SD uses CS5/SCK18/MISO19/MOSI23.

Create/edit a batch with Lower, Upper or Both rollers and its turning end. The
cutoff defaults to the start of chicken day 18 (start + 17 days); an earlier
end is supported. Both rollers run sequentially. Saving an active batch enables
its schedule automatically. Control offers direct requests and shows saved labels.

SD checkpoints, card retries, valid state recovery after power return and lost-RTC
browser time synchronization are automatic. Use a correct local clock/timezone on
the logged-in browser if the DS3231 lost time. A valid RTC supplies time offline.
Corrupt recovery files are preserved; critical alarms and interrupted roller
positions still require inspection. Settings > Component status reports actual
communication and commanded relay states, without claiming load feedback.
Manual heat ON is not replayed on restart. The LCD pairs each batch label/estimate.

Local build and mock-test results do not verify relay wiring, sensor accuracy,
motor travel, physical temperature stability or SD reliability. This package
has not been uploaded or physically validated.

The latest package is HatchAI-component-status-deployment.zip. Raw JavaScript is about
137.4 KiB and total assets 360.2 KiB, above the recommended 80/350 KiB budgets.
The SPIFFS image builds successfully; no new frontend library is required.
