# HatchAI SHT40 version

This working folder now builds SHT40 firmware. The previous DHT22 version is
preserved by the user's GitHub push. No separate copy or ZIP is required.

## Wiring

| SHT40 breakout | ESP32 |
| --- | --- |
| VCC/VIN | 3.3 V |
| GND | GND |
| SDA | GPIO 21 |
| SCL | GPIO 22 |

Follow the breakout's labels for physical pin order. The native SHT40 supply
must not exceed 3.6 V. SDA/SCL pull-ups must be at 3.3 V for the ESP32 and SHT40.
Check LCD/RTC modules for 5 V pull-ups; use suitable level shifting where needed.
The sensor shares Wire with DS3231 (0x68) and LCD (configured 0x27).
Default SHT40 address is 0x44; alternative-address parts can be configured through
`HatchConfig::Sht40Address`. GPIO 4 is no longer the sensor data pin.

## Driver and retained behavior

`Sht40Sensor` uses built-in Wire; the Adafruit DHT dependency has been removed
from PlatformIO and the Arduino export script. The driver sends high-precision
command 0xFD, waits the specified bounded 10 ms, reads six bytes and verifies
each data word's CRC-8 (initial 0xFF, polynomial 0x31). Conversion and RH clamping
follow [Sensirion's datasheet](https://sensirion.com/resource/datasheet/sht4x).
The internal sensor heater is never enabled. Failed command, short read and CRC
failure return invalid readings with an explicit SHT40 error. A sensor missing
at boot can recover on later scheduled reads without a restart.

The controller still samples every five seconds, retries failed reads after
2.1 seconds, allows two seconds for startup, expires retained readings after
20 seconds and requires three stable frames at startup/recovery. Successful
measurement timestamps are taken after conversion. I2C operations retain the
shared 25 ms timeout set in main.cpp. Each measurement adds one required 10 ms
conversion wait; there are no synchronous retry loops.

The application's -40..80 C acceptance range and existing prediction contract,
thermostat/restart dwell, overtemperature limits, dual roller controls, batch
turn counts, day-18 cutoff, LCD layout, SD recovery and persisted settings are
retained. Existing SD snapshots remain compatible. Sensor names in runtime
messages and Component status now say SHT40. Historic DHT22 documentation is
superseded by this guide and the updated README/system/code guides.

The existing saved temperature offset still applies: review its calibration for
the replacement sensor using a trusted reference. Sensor replacement does not
prove better temperature stability or correct physical wiring.

## Build and deployment

Build with `platformio run -e esp32dev` and build the updated labels with
`platformio run -e esp32dev --target buildfs`. Apply both firmware and SPIFFS
uploads, then refresh the browser. No upload, serial connection, NVS erase or
physical output command is performed by the conversion.

Verify on hardware after deployment: SHT40 detection, valid T/RH, sensor unplug
and recovery, RTC/LCD on the shared bus, stale-reading shutdown and supervised
relay behavior. CRC/conversion/compiler and mocked browser tests cannot confirm
physical accuracy, pull-up voltages or bus noise.

Local verification completed: esp32dev firmware and SPIFFS builds, five C++14
compiler-evaluated protocol/control checks, all frontend JavaScript syntax checks,
50 recovery/component and 150 general mocked browser checks. Firmware uses
66,912 bytes RAM and 1,055,405 bytes flash. UI assets remain above the existing
advisory budgets: 375,871 bytes total and 146,883 bytes JavaScript, versus
350 KiB and 80 KiB targets. CSS (46,616 bytes), largest HTML (17,212 bytes) and
largest image (39,032 bytes) remain within their targets. No new UI dependencies,
polling or layout changes were introduced by the SHT40 conversion.
