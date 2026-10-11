# HatchAI ESP32

HatchAI is an ESP32-based smart incubator controller with a local web dashboard.
It monitors temperature and humidity with an SHT40 I2C probe, controls heating bulbs, fan, and egg
turning relays, logs valid readings to SD card, shows local status on a 20x4
LCD, and runs a hatch timing prediction model.

For the full code walkthrough, see:

- [Code Documentation](docs/CODE_DOCUMENTATION.md)

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
