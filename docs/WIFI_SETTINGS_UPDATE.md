# Batch slots, Wi-Fi settings, and LCD proposal

## Result

The Batch page has two slots. New or newly activated batches cannot exceed
two active records; historical and existing user records are preserved. The
store starts empty and removes only unchanged records matching the old sample
metadata. Edited samples and user-created batches remain. Empty lists stay
empty after reload and after deleting all records.

Settings automatically scans nearby Wi-Fi networks. Refresh networks scans
again. Rows show SSID, signal, security lock icons, and Connected/Saved labels.
Duplicates retain their strongest result, with a 20-network response limit.
The page has no manual SSID/password section. Tap open or saved networks to
connect directly. Saved passwords stay on the ESP32 and are read from NVS only
after matching the requested SSID (`useSaved=true`). New secured networks open
a password dialog with Connect, Cancel, and show/hide. Unnamed networks are
omitted. Tapping the connected network opens information.

Connect queues an attempt and immediately returns `accepted`/`connecting`
state. The main loop handles disconnection, association, timeout, and success
without a polling wait loop in startup or the HTTP handler. It first waits for
the old station disconnect event to avoid accepting stale same-SSID status.
Settings reads Connecting, Connected, Incorrect password or connection failed,
and Network unavailable outcomes from device status. Failed user attempts keep
previously saved credentials. Successful connections write and verify NVS
credentials. Boot restores the saved network; saved-network recovery uses a
30-second retry interval after failures.

The information icon expands connection details and Forget network. Forget
asks for confirmation, checks the acknowledgement, cancels pending connection
and retry work, and gives setup reconnection instructions. Firmware sends its
acknowledgement before the deferred disconnect and keeps the setup AP available.

Wi-Fi requests use the shared API client and run sequentially. Status refreshes
wait at least five seconds after the preceding operation, pause while hidden,
and stop after an acknowledged forget until a manual refresh. Scan progress
checks also wait five seconds. The connect API now acknowledges pending work;
clients must read `/api/wifi/status` for the outcome. Existing control,
prediction, and session API contracts remain in place. No runtime libraries
were added.

The dashboard retains unchanged values, batch selector options, prediction
text, and chart content across polls. It shows calculating placeholders when
the batch/date context changes, preserves canvas dimensions until resize, and
serializes data/prediction requests. Offline responses keep the last reading
with an explicit offline label; sample values are no longer substituted.

Wi-Fi passwords stay in Preferences/NVS and are never returned in responses.
The browser stores only SSID/controller address and removes old cached Wi-Fi
passwords. Driver credential storage uses RAM. NVS/flash encryption is not
enabled by this project; HTTP is also unencrypted. Preferences alone is not
encrypted storage, and existing endpoint access-control limitations remain.

## Changed files

| Path | Change |
| --- | --- |
| `data/settings.html` | Current network row, information button, expandable details, refresh and forget actions |
| `data/batch.html`, `data/css/batch.css` | Two-slot count and responsive two-card layout |
| `data/js/batchStore.js`, `data/js/batch.js` | Empty initialization, old sample cleanup, two active slots and validation |
| `data/dashboard.html` | Neutral initial values and explicit live/offline chart status |
| `data/css/settings.css` | Responsive connection details, bounded icon button, focus and selected states |
| `data/js/wifi.js` | Device-reported state, safe SSID rendering, sequential requests, network actions and failures |
| `data/js/dashboard.js` | Stable incremental rendering, serialized requests, offline retention |
| `data/js/espApi.js` | Wi-Fi request methods and optional request timeouts |
| `include/Config.h` | Deferred Wi-Fi disconnect grace period |
| `include/NetworkManager.h` | Status API and deferred forget state |
| `src/NetworkManager.cpp` | Live status JSON, checked credential storage, forget acknowledgement and setup AP recovery |
| `src/HatchWebServer.cpp` | GET/OPTIONS `/api/wifi/status` |
| `src/main.cpp` | Service deferred network work in the main loop |
| `docs/CODE_DOCUMENTATION.md` | API and settings behavior |
| `docs/SYSTEM_DETAILS.md` | Updated Wi-Fi behavior and reconnection process |
| `docs/WIFI_SETTINGS_UPDATE.md` | This verification record and LCD proposal |
| `test/ui-regression.cjs` | Retained host browser regression checks with mocked device APIs |
| `test/README` | Test requirements and run instructions |

## Verification

- All 13 JavaScript files passed `node --check`; `git diff --check` passed.
- PlatformIO `run -e esp32dev` passed: RAM 49,640 / 327,680 bytes;
  firmware flash 974,781 / 1,310,720 bytes.
- PlatformIO `run -e esp32dev --target buildfs` passed with the final assets.
  The configured default SPIFFS partition is 1,441,792 bytes.
- `test/ui-regression.cjs` passed 65 assertions: 63 Chrome checks with mocked
  device APIs plus two networking source guards. Cases include automatic and
  refreshed scans, lock icons, saved/open network taps and secured-network dialogs, pending connection
  outcomes, encoded credentials, storage failures, forget outcomes, unchanged
  dashboard DOM/canvas content, changed readings, batch selection, and offline
  recovery, two slots, default-record cleanup, preservation of edited/owned
  records, and two-active-batch validation. The Wi-Fi dialog and two-slot
  screenshots were also visually inspected.
- Browser layout checks passed at 375, 812, and 1280 CSS pixels wide. No
  JavaScript page errors occurred; maximum concurrent Wi-Fi requests was one.

Measured source assets use KiB (1,024 bytes):

| Resource | Measured | Repository target |
| --- | --- | --- |
| Largest HTML page | 17.5 KiB | 30 KiB per page |
| All CSS | 42.2 KiB | 50 KiB |
| All JavaScript | 114.6 KiB | 80 KiB; exceeded |
| Largest image | 38.1 KiB | 40 KiB per image |
| All deployed assets, including fonts | 332.2 KiB | 350 KiB |

JavaScript was already above budget before these updates. Unrelated assets
were retained. Compilation, filesystem packaging,
and mocked browser checks do not establish live radio or persistence behavior.
No firmware/filesystem uploads, live Wi-Fi changes, relay commands, or physical
hardware tests occurred. Both `upload` and `uploadfs` will be required to deploy.
Radio association, reboot recovery, physical NVS persistence, and live
control-loop timing still require supervised device testing. SDK, sensor,
and SD operations have their own execution costs; removal of the connection
wait loop does not establish a hard real-time guarantee.

## Suggested two-batch LCD layout

LCD code is unchanged. This is an illustrative proposal for the 20x4 display:

```text
T:37.8C RH:58%
B1 Est:30 Oct D11
B2 Est:03 Nov D07
AUTO TURN:OFF 14:35
```

`B1`/`B2` identify the two batches, `Est` identifies an estimated hatch date,
and `D11` means incubation day 11. Temperature/humidity describe the shared
incubator sensor. The final line shows operating mode, turner relay state,
and current RTC time. Each sample line fits within 20 characters.

The model estimates whole days and cannot supply an exact hatch hour.
Use an explicit sensor-error message when readings are invalid and show
`Not set` for an unconfigured batch. Implementing this proposal requires a
defined way to send and persist both browser-local batches on the ESP32;
the current LCD still uses its existing uptime-based prediction.
