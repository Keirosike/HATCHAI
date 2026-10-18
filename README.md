# HatchAI ESP32

HatchAI is an ESP32-based smart incubator controller with a local web dashboard.
It monitors temperature and humidity with a DHT22 sensor on GPIO 4, controls heating bulbs, fan, and egg
turning relays, logs valid readings to SD card, shows local status on a 20x4
LCD, and runs a hatch timing prediction model.

For the full code walkthrough, see:

- [Code Documentation](docs/CODE_DOCUMENTATION.md)

## DHT22 Wiring

- VCC to ESP32 3.3 V, GND to GND, and DATA to GPIO 4 (`HatchConfig::Dht22Pin`).
- Use a 10 kOhm pull-up from DATA to 3.3 V if the sensor module has no pull-up.
- On a bare four-pin DHT22, pin 3 is unused; follow the module labels for a breakout.
- The DS3231 and LCD still use I2C on GPIO 21/22. The DHT22 does not use I2C.

See [Adafruit's wiring guide](https://learn.adafruit.com/dht/connecting-to-a-dhtxx-sensor).
PlatformIO installs the configured Adafruit DHT library during the build. The firmware
allows two seconds for sensor startup and samples every five seconds. Failed reads
retry at the next sample; the existing 20-second retained-reading policy still applies.

## Quick Build Commands

Build firmware:

```powershell
C:\Users\LENOVO\.platformio\penv\Scripts\platformio.exe run
```

Upload firmware:

```powershell
C:\Users\LENOVO\.platformio\penv\Scripts\platformio.exe run --target upload
```

Build web filesystem image:

```powershell
C:\Users\LENOVO\.platformio\penv\Scripts\platformio.exe run --target buildfs
```

Upload dashboard and web UI files to SPIFFS:

```powershell
C:\Users\LENOVO\.platformio\penv\Scripts\platformio.exe run --target uploadfs
```

Run the commands from this project folder:

```powershell
cd C:\Users\LENOVO\Desktop\hatchai-esp32final
```
