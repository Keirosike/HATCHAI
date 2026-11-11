# Controller firmware cleanup — 2026-11-10

The production `esp32dev` build excludes `Notification*.cpp` and the unused
`Sht40Sensor.cpp`. Legacy notification protocol/client sources and tests remain
available for reference; they are not activated in the main controller.

The controller no longer constructs the legacy notification runtime, starts its
FreeRTOS HTTPS task, reads its NVS credentials, or registers its local pairing
routes. The local dashboard no longer loads the old LCD-pairing modal script.
Cloud-hosted native Web Push sources, Worker APIs and Supabase are unchanged.
Existing NVS data is not erased or migrated.

DHT22 GPIO4, PID and thermal protection, watchdog, relays, camera communication,
passive buzzer, LCD monitoring, SD logging and recovery remain in the build.

## LCD batch metadata

The LCD previously displayed `Loading` indefinitely when neither live state nor
a matching CRC-valid SD snapshot contained a batch label. It now uses a matching
saved name when a label is absent. If neither exists, it displays `No label` after
recovery completes or its startup timeout expires. Upper/lower placement, day
suffixes and safety-warning priority are unchanged. No batch identity is invented.

If `No label` appears, open the existing local Batch page and save the correct
assigned batch with its label; this uses the existing authenticated metadata sync.
If saving fails, inspect the displayed storage/recovery error before retrying.
Labels cannot be reconstructed from missing or invalid storage.

## Applying later

Local builds do not change the running ESP32. Firmware upload is needed for the
runtime/LCD change; filesystem upload is needed to remove the old dashboard modal.
Both require separately authorized supervised hardware work. Preserve configuration
and backups, and do not erase flash or NVS. Physical timing, LCD output and heating
still require supervised verification after upload.
