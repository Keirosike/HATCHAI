# Controller flash optimization ? 2026-11-11

This pass retains the existing application partition and SDK versions. The initial
100 KB target is not reached. The selected candidate has 54,128 bytes of actual
application-image headroom, up from 9,280 bytes. Savings: 44,848 bytes.

## Changes

- `platformio.ini` enables GCC link-time optimization (`-flto`).
- `scripts/firmware_lto.py` also enables LTO and its plugin in the GCC link driver.
  The script must run as a **post** script: the SDK initializes/replaces link flags
  after pre scripts run. `build_flags` alone applies `-flto` only to compilation.
- `include/JsonBuilder.h` keeps escape/quote/boolean/number formatting helpers out
  of line. Their bodies, formatting rules, and API signatures are unchanged; this
  saves another 464 image bytes compared with LTO alone.

No actuator, timing-policy, API-key/HMAC, enrollment, TLS validation, migration,
local dashboard asset, or feature-gate logic is changed. The generated partition
image is byte-identical to the preserved baseline. No upload or deployment ran.

## Measured builds

| Candidate | Linked flash | firmware.bin | Binary headroom | Static RAM |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 1,294,861 | 1,301,440 | 9,280 | 68,468 |
| LTO | 1,250,473 | 1,257,056 | 53,664 | 68,148 |
| LTO + global small/once inlining disabled (rejected) | 1,264,905 | 1,271,488 | 39,232 | 68,172 |
| LTO + shared JSON helpers (selected) | 1,250,013 | 1,256,592 | 54,128 | 68,148 |

Application partition: 1,310,720 bytes per OTA slot. Linked flash is not the full
image size: use the actual binary for headroom. The selected image is 48,272 bytes
short of a conservative 100 KiB (102,400-byte) headroom target.

Final image SHA-256:
`6e90877617471c603bca02c51649f6d6e6c31f4c3c18874dab65229cf2dc894e`

Baseline, LTO, rejected inlining candidate, and final artifacts are preserved under
ignored `dist/flash-optimization/`. Normal final artifacts are also in
`.pio/build/esp32dev/`.

Tool versions: PlatformIO Core 6.2.0, Espressif32 6.13.0, Arduino ESP32 2.0.17
(package 3.20017.241212+sha.dcc1105b), GCC 8.4.0+2021r2-patch5,
esptool 4.11.0, ArduinoJson 6.21.5. No SDK/compiler upgrade was performed.

## Verification and limits

- Selected `platformio run -e esp32dev`: PASS.
- All 14 existing `test/*compile_test.cpp` files with C++14, `-Os -flto`,
  `-Iinclude -fsyntax-only`: PASS; these evaluate the existing constexpr checks.
- `node test/control_dual_motor_test.cjs`: PASS.
- `node --test test/local-session-regression.test.mjs`: 2 passed, 0 failed.
- `python -B test/recovery_fault_simulation.py`: 5,707 checks passed; host fault model.
- `esptool.py --chip esp32 image_info`: image checksum and validation hash valid.
- JSON helper implementation comparison: identical after removing annotations/comment.
- Generated partitions: byte-identical to the baseline.
- `git diff --check`: PASS.

The earlier restored Worker baseline had 159 tests and all seven isolated runtime
scripts pass. Worker code is untouched in this pass; those tests were not rerun.
Two early LTO link attempts failed before the hook order was corrected. Those
failed builds are not counted as passes. Global inlining controls built but made
the image larger and were removed.

Compilation and host checks do not establish target timing or hardware behavior.
LTO changes generated code. Before any separately authorized upload, retain the
baseline and plan supervised checks of startup, control/sensor failure handling,
watchdog, concurrent motor deadlines, SD recovery, local sessions, and TLS
connection/enrollment/telemetry. No hardware was opened or exercised here.

## Further reduction

The largest baseline contributors include precompiled Wi-Fi (libnet80211 roughly
113 KiB), lwIP (105 KiB), libc (92 KiB), and the mbedTLS libraries (195 KiB combined).
LTO cannot reoptimize those precompiled SDK libraries. The full formatted-I/O
routines alone include about 48 KiB across the five largest printf/scanf routines.

Further investigation should use an isolated SDK-library build with the same
Arduino/ESP-IDF/compiler revisions and a compatibility/test plan. A smaller C
formatting library needs verification of floating-point and 64-bit formatting;
blindly selecting nano formatting can change existing behavior. TLS trust roots,
certificate checks, cryptographic support, offline operation and hardware features
were not reduced to meet the size target. This pass does not prove that 100 KB is
infeasible; it establishes the measured compiler-only improvement and remaining gap.
