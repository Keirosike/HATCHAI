
---
name: esp32-embedded-development
description: >
  Develop, debug, optimize, and review ESP32 embedded firmware
  using Arduino C++ and PlatformIO for the HatchAI smart egg
  incubator. Specializes in GPIO management, SHT40 sensor
  integration, DS3231 RTC communication, SD card logging,
  active-low relay control, non-blocking control loops,
  memory-conscious HTTP servers, I2C/SPI reliability,
  watchdog integration, and safe restart recovery.
---

# ESP32 Embedded Development

## 1. Purpose

This skill provides development and code review instructions
for the HatchAI ESP32-based chicken egg incubator.

Use this skill when generating, modifying, debugging,
refactoring, or reviewing embedded C++ firmware.

The primary objective is to produce firmware that is:

- Reliable during continuous operation
- Safe when controlling heating and motor hardware
- Non-blocking wherever reasonably possible
- Efficient with ESP32 memory and processing resources
- Resilient to sensor and communication failures
- Recoverable after resets and power interruptions
- Compatible with the project's existing architecture
- Maintainable and testable

Hardware safety and functional correctness take priority
over optimization or code simplification.

Do not rewrite working components unnecessarily.

---

## 2. Project Environment

The HatchAI firmware uses:

| Component | Technology |
|---|---|
| Microcontroller | ESP32 Dev Module |
| Firmware | Arduino C++ |
| Build system | PlatformIO |
| Platform | espressif32 |
| Board identifier | esp32dev |
| Web server | Arduino WebServer |
| Sensor communication | I2C |
| SD card communication | SPI |
| Web asset storage | SPIFFS |
| Persistent device settings | Preferences |
| Sensor data logging | SD card CSV |
| Serial communication | 115200 baud |
| Frontend | HTML, CSS, JavaScript |
| Prediction | Embedded Random Forest regressor |

The current project does not require a cloud server.

Do not introduce new frameworks, dependencies, or major
architectural changes unless the task requires them.

Before changing code:

1. Read `platformio.ini`.
2. Read `include/Config.h`.
3. Inspect the relevant source and header files.
4. Identify dependencies and hardware interactions.
5. Check the existing controller behavior.
6. Preserve unrelated functionality.

---

## 3. Repository Structure

Use the following module responsibilities when locating
or modifying code.

| File | Responsibility |
|---|---|
| `src/main.cpp` | Firmware startup and main loop |
| `include/Config.h` | GPIO pins and operating defaults |
| `include/IncubatorTypes.h` | Shared data structures |
| `src/IncubatorController.cpp` | Incubator control and scheduling |
| `src/Sht40Sensor.cpp` | SHT40 communication |
| `src/RealTimeClock.cpp` | DS3231 communication |
| `src/OutputDevice.cpp` | GPIO relay control |
| `src/DataLogger.cpp` | SD card logging |
| `src/ReadingHistory.cpp` | Recent sensor history |
| `src/LcdStatusDisplay.cpp` | I2C LCD output |
| `src/NetworkManager.cpp` | Wi-Fi and network management |
| `src/HatchWebServer.cpp` | HTTP routes and API responses |
| `include/hatchai_random_forest_esp32_final.h` | Embedded prediction model |

Follow the existing division of responsibilities.

Do not place hardware-specific logic in unrelated
components.

Avoid creating duplicate control mechanisms.

---

# 4. GPIO Assignment Management

## Existing GPIO Configuration

The project uses these configured assignments:

| Component | GPIO / Address |
|---|---|
| I2C SDA | GPIO 21 |
| I2C SCL | GPIO 22 |
| Heating bulb 1 | GPIO 26 |
| Heating bulb 2 | GPIO 25 |
| Fan relay | GPIO 14 |
| Egg-turning relay | GPIO 27 |
| SD card CS | GPIO 5 |
| SD card SCK | GPIO 18 |
| SD card MISO | GPIO 19 |
| SD card MOSI | GPIO 23 |
| SHT40 | I2C 0x44 |
| DS3231 | I2C 0x68 |
| LCD | I2C 0x27 |

Treat `include/Config.h` as the authoritative source
for configured pin assignments.

Do not assume the physical wiring has been verified.

## GPIO Development Rules

When generating or reviewing code:

1. Avoid assigning the same GPIO to unrelated devices.
2. Preserve existing GPIO assignments unless explicitly
   requested to change them.
3. Account for ESP32 boot-strapping pin behavior.
4. Check whether selected pins support the required
   input or output functions.
5. Initialize relay outputs to their safe inactive states.
6. Avoid unintentional output pulses during initialization.
7. Verify GPIO polarity before changing relay logic.
8. Never assume HIGH always means ON.
9. Do not directly manipulate a relay from multiple
   independent control paths.

## Active-Low Relay Rules

All four configured relays are active-low.

- LOW = Relay ON
- HIGH = Relay OFF

Any new relay control code must preserve this behavior.

Use the existing `OutputDevice` abstraction instead
of duplicating raw GPIO writes.

For a requested OFF state, the output must resolve
to the inactive electrical level.

Check that startup, failure handling, and shutdown
paths preserve the correct polarity.

---

# 5. Non-Blocking Sensor and Control Loops

## Objective

Maintain responsive incubator control while performing:

- Sensor measurements
- Relay updates
- Egg-turn scheduling
- LCD updates
- HTTP request handling
- Data logging
- Network maintenance

The main loop must remain responsive and must not
depend on unnecessary blocking delays.

## Existing Timing Configuration

| Operation | Interval |
|---|---|
| Sensor sampling | 5 seconds |
| Sensor reading maximum retained age | 20 seconds |
| LCD refresh | 2 seconds |
| Egg-turn interval | 120 minutes |
| Egg-turn pulse | 8 seconds |
| Main loop delay | 2 milliseconds |

These are existing project defaults.

Do not silently change them.

## Timing Requirements

Use elapsed-time scheduling based on `millis()`.

Preferred pattern:

```cpp
const uint32_t now = millis();

if ((uint32_t)(now - previousMillis) >= interval) {
    previousMillis = now;
    performTask();
}
```

Use unsigned subtraction so elapsed-time comparisons
remain valid across normal `millis()` rollover.

Do not use long `delay()` calls for periodic scheduling.

Short device-protocol waits may still be necessary.
When possible, structure them as non-blocking states.

## Sensor Reading Guidelines

The SHT40 currently uses:

- Measurement command `0xFD`
- Approximately 10 ms conversion wait
- Six-byte response
- CRC checks for temperature and humidity
- Up to three attempts per scheduled measurement
- 20 ms retry delays

This implementation is not completely non-blocking.

When improving the driver:

1. Separate measurement initiation and result retrieval.
2. Use elapsed-time checks for conversion readiness.
3. Limit the number of retry attempts.
4. Avoid indefinite waits for I2C responses.
5. Keep sensor errors visible to the controller.
6. Preserve CRC validation.
7. Prevent incomplete readings from entering control logic.
8. Preserve the existing invalid-reading handling.

Do not replace a validated measurement with fabricated
or default environmental readings.

## Controller Responsiveness

Keep the following operations independently scheduled:

- Sensor updates
- Heating control
- Fan control
- Egg-turning operations
- LCD refresh
- Network handling

A failed sensor measurement must not prevent the
controller from servicing unrelated operations.

Do not perform lengthy SD or Wi-Fi operations without
considering their impact on controller responsiveness.

---

# 6. Heating and Fan Control

## Automatic Heating

The current temperature target is 37.8°C.

Both heating bulbs operate together.

Heating behavior:

- Below target - 0.3°C: bulbs ON
- Above target + 0.3°C: bulbs OFF
- Inside the hysteresis band: preserve previous states

Preserve hysteresis to prevent excessive relay switching.

Do not replace this control with PID or AI-generated
control decisions unless explicitly requested.

## Fan Control

The fan turns ON when either condition is met:

- Temperature > target + 0.5°C
- Humidity > target + 5 percentage points

Otherwise, the automatic controller turns it OFF.

Do not assume the fan is continuously enabled.

The current hardware configuration has no active
humidity-increasing actuator.

## Invalid Sensor Readings

In automatic mode, an invalid environmental reading
causes both bulbs and the fan to turn OFF.

Preserve this existing fail-safe behavior.

Do not allow invalid, stale, or uninitialized data
to activate heating.

The existing 20-second retained-reading behavior
must be considered before changing stale-data logic.

## Manual Mode

Manual mode allows direct relay commands.

Do not assume sensor invalidation automatically
disables manually controlled relay outputs.

Manual turner activation can hold its relay ON
continuously.

Any proposed safety changes affecting manual mode
must be documented and reviewed for compatibility.

---

# 7. Egg-Turning Motor Control

The egg-turning mechanism uses a relay.

Default parameters:

- Automatic interval: 120 minutes
- Timed motor pulse: 8 seconds

## Implementation Rules

1. Use non-blocking elapsed-time scheduling.
2. Avoid delaying the main loop during motor operation.
3. Prevent unintended overlapping timed cycles.
4. Preserve correct active-low relay polarity.
5. Ensure timed cycles complete under normal operation.
6. Distinguish sustained manual operation from timed turns.
7. Preserve turning counters and date information.
8. Do not infer actual motor movement from relay commands.
9. Review recovery behavior when the ESP32 restarts
   during a turning cycle.

The existing system does not have motor position feedback.

Turning counts represent issued control commands,
not confirmed physical egg movement.

Do not report a successful physical rotation based
only on relay activation.

## Restart Considerations

The current system stores turning counters in Preferences.

However, the automatic scheduling timer is based on
uptime and resets after restarting.

When reviewing restart recovery, check for:

- Unexpected immediate motor activation
- Incorrect turning intervals
- Duplicate turn events
- Incorrect daily counters
- Stale stored timestamps
- RTC unavailable during recovery

Do not assume that a persisted turning counter is
sufficient to reconstruct the motor's physical position.

---

# 8. Reliable I2C Integration

The following devices share the I2C bus:

- SHT40 temperature/humidity sensor
- DS3231 real-time clock
- Character LCD

Configured pins:

- SDA: GPIO 21
- SCL: GPIO 22

## I2C Development Rules

1. Initialize the shared I2C bus before using devices.
2. Use the configured device addresses.
3. Verify communication response lengths.
4. Check I2C transaction status.
5. Preserve sensor CRC validation.
6. Apply finite communication timeouts where supported.
7. Avoid uncontrolled retries.
8. Avoid conflicting bus initialization.
9. Keep one device failure from stopping the entire system.
10. Report hardware communication failures accurately.

Do not repeatedly reinitialize the shared I2C bus
without a clear recovery reason.

## SHT40 Failure Handling

Distinguish between:

- Missing sensor
- Incomplete response
- Temperature CRC mismatch
- Humidity CRC mismatch
- Invalid temperature range

Do not silently convert communication failures into
valid sensor data.

## DS3231 Failure Handling

The RTC supplies timestamps and calendar dates.

The existing code can initialize the RTC to the
firmware build date/time after detecting lost power.

Do not claim the RTC is synchronized with real time
unless synchronization has actually been verified.

If RTC communication is unavailable:

- Preserve existing fallback behavior.
- Avoid treating uptime as an actual calendar timestamp.
- Keep time-dependent calculations distinguishable.
- Prevent invalid clock data from corrupting persistent
  counters or event records.

## LCD Communication

LCD communication failures must not prevent:

- Heating control
- Fan control
- Egg-turn scheduling
- Sensor acquisition
- Web server operation

Keep LCD writes bounded and refresh them only
when scheduled.

---

# 9. Reliable SPI and SD Card Integration

The SD card uses the SPI interface.

Configured pins:

- CS: GPIO 5
- SCK: GPIO 18
- MISO: GPIO 19
- MOSI: GPIO 23

The existing measurement log is:

`/hatchai.csv`

## SD Card Rules

1. Initialize SPI and SD communication correctly.
2. Verify SD card initialization results.
3. Check file-open operations.
4. Check write results where supported.
5. Close or flush files according to the logging design.
6. Avoid unnecessary repeated file operations.
7. Prevent uncontrolled SD retries.
8. Detect unavailable or removed cards.
9. Preserve CSV column order and meanings.
10. Keep the incubator controller functional if
    logging fails.

## Logging Reliability

The existing logger writes one row per valid
scheduled sensor sample.

Do not log invalid sensor values as if valid.

Avoid blocking the control loop with large
synchronous file operations.

When proposing buffering:

- Bound buffer memory usage.
- Specify overflow behavior.
- Define how buffered records are handled on failure.
- Consider power loss before buffered data is written.
- Avoid silently dropping measurements.

## CSV Compatibility

Preserve the existing schema unless a migration
is explicitly required.

If a schema changes:

1. Document the change.
2. Preserve old log files.
3. Avoid mixing incompatible CSV rows.
4. Provide a defined migration or versioning strategy.

Never erase SD card data as an automatic debugging step.

---

# 10. Memory-Conscious Web Server

HatchAI uses the synchronous Arduino `WebServer`
on HTTP port 80.

The browser polls controller information regularly.

## Memory Management Rules

When generating or reviewing HTTP code:

1. Avoid unnecessary large temporary objects.
2. Limit repeated dynamic `String` concatenation.
3. Consider reserving capacity for predictable strings.
4. Avoid excessive JSON response construction.
5. Bound incoming request sizes.
6. Validate all user-controlled parameters.
7. Avoid retaining unnecessary request data.
8. Minimize repeated memory allocation in hot paths.
9. Keep HTTP handlers short.
10. Avoid unnecessary large buffers in RAM.

Where practical, use bounded buffers or incremental
response construction.

Do not introduce arbitrary JSON truncation that
silently changes API behavior.

## HTTP Responsiveness

The synchronous server executes handlers while
processing incoming requests.

A blocking handler delays other loop operations.

The existing Wi-Fi connection handler can wait
up to approximately 20 seconds.

Treat this as a responsiveness concern.

For improvements, prefer:

- Starting an operation quickly
- Returning a pending-operation response
- Checking progress in later loop iterations
- Reporting success or failure through a status API
- Using explicit timeouts

Do not assume that changing to an asynchronous web
server is required or automatically improves safety.

## API Compatibility

Preserve existing endpoints unless API changes
are explicitly requested.

Important endpoints include:

- GET `/api/data`
- POST `/api/control`
- POST `/api/turn`
- POST `/api/predict`
- GET/POST `/api/account`
- Session management endpoints
- Wi-Fi scan/connect/forget endpoints

Frontend JavaScript depends on existing JSON structures
and request parameters.

Review related frontend files when modifying an API.

## Security Review

The current implementation has authentication and
access-control limitations.

Review:

- Session validation
- Authorization of state-changing endpoints
- Credential storage
- Unrestricted CORS
- Plain HTTP communication
- Default credentials
- Input validation
- Unauthorized relay control

Do not assume that the presence of a login page
means every API endpoint is protected.

Treat remote actuator control as security-sensitive.

---

# 11. Watchdog and Runtime Recovery

## Objective

Prevent prolonged software stalls from leaving the
incubator unresponsive.

Watchdog support must be designed carefully.

Do not assume a custom application watchdog is already
implemented.

## Watchdog Development Rules

When implementing or reviewing watchdog behavior:

1. Identify the installed ESP32 Arduino core and
   ESP-IDF versions.
2. Use compatible task watchdog APIs.
3. Determine which tasks require monitoring.
4. Select a timeout based on measured execution times.
5. Account for existing blocking operations.
6. Feed the watchdog only after meaningful progress.
7. Never feed a watchdog from code that can continue
   running while critical controller work is stalled.
8. Check watchdog initialization return values.
9. Avoid unnecessary device resets.
10. Document intended reset and recovery behavior.

Do not add a watchdog with a timeout shorter than
existing legitimate blocking operations without
first restructuring those operations.

## Deadlock and Stall Review

Inspect for:

- Infinite loops
- Unbounded retry loops
- Long synchronous network operations
- Stalled peripheral communication
- Heap exhaustion
- Repeated allocation failures
- Unexpected recursive calls
- Failure to service time-critical controller updates

A watchdog is a recovery mechanism, not a substitute
for eliminating avoidable blocking code.

## Restart Recovery

On restart, the system must initialize hardware
and reconstruct valid software state.

Review these concerns:

- Relay outputs initialized safely
- Sensor validation before automatic heating
- RTC availability
- SD card initialization failure
- SPIFFS mount failure
- Network fallback
- Persisted turning counters
- Automatic mode defaults
- Egg-turn scheduling reset
- Prediction day reset
- Incomplete operations before power loss

The current firmware restores some persistent values
while other settings revert to compiled defaults.

Do not assume all runtime state is preserved.

## Startup Safety

When modifying startup code:

1. Check relay initialization order.
2. Minimize the interval before safe GPIO states
   are explicitly established.
3. Avoid energizing relays during initialization.
4. Do not activate heating based on unvalidated readings.
5. Treat peripheral failures independently.
6. Allow nonessential components to fail gracefully.
7. Report initialization errors to available diagnostics.

Software cannot guarantee relay states during every
electrical reset phase.

Physical pull-ups, relay module behavior, and
power-supply conditions require hardware verification.

---

# 12. SPIFFS and Persistent Settings

SPIFFS stores browser assets.

Preferences stores selected persistent device values.

## SPIFFS Rules

The current startup uses:

`SPIFFS.begin(true)`

This may format the filesystem if mounting fails.

When reviewing startup behavior:

- Identify the potential for filesystem data loss.
- Do not introduce additional automatic formatting.
- Report filesystem mount failures.
- Preserve existing frontend assets.
- Verify filesystem uploads after changes.

## Preferences Rules

Existing namespaces include:

- `hatchai`
- `hatchai-wifi`
- `hatchai-turn`

Avoid unnecessary persistent writes.

Validate restored values before use.

Consider behavior during unexpected power loss.

Do not erase Preferences during ordinary debugging
unless explicitly authorized.

## Frontend Storage

Batch information is maintained in browser localStorage.

It is not a firmware-side batch database.

Do not assume:

- Cross-browser synchronization
- Cross-device batch synchronization
- Server-persisted batch targets
- Batch status automatically affecting physical relays

Any new synchronization behavior requires an
explicit implementation plan.

---

# 13. Embedded AI Integration

HatchAI uses an exported Random Forest regressor
running locally on the ESP32.

The model currently accepts four inputs:

1. Temperature
2. Relative humidity
3. Turner relay state
4. Incubation day

The currently exported trees branch only on
incubation day.

Therefore, temperature, humidity, and turner state
do not currently affect numerical model output
at a fixed incubation day.

## AI Development Rules

- Preserve input order.
- Validate input values.
- Keep inference resource usage bounded.
- Avoid unnecessary dynamic allocations.
- Do not block time-critical control operations.
- Do not claim model accuracy without validation results.
- Do not describe hatch prediction as sensor-confirmed.
- Do not automatically connect prediction output
  to heater or motor control.

The current model is advisory.

Model training, model evaluation, and physical hatch
detection are not implemented by the firmware.

---

# 14. Code Generation Standards

When writing Arduino/C++ code:

1. Prefer clear, maintainable C++.
2. Follow existing repository conventions.
3. Use fixed-width integer types where appropriate.
4. Use `const` and `constexpr` for fixed values.
5. Avoid unnecessary global state.
6. Keep shared ownership of hardware explicit.
7. Validate values before hardware operations.
8. Check return values from fallible operations.
9. Avoid uncontrolled dynamic allocation.
10. Use bounded retry and timeout strategies.
11. Make relay polarity explicit.
12. Preserve the existing API contract.
13. Keep comments accurate and focused on intent.
14. Avoid unrelated refactoring.
15. Build after firmware changes when tooling is available.

Do not introduce complex abstractions without
a demonstrated maintenance or reliability benefit.

## Error Handling

For any operation that can fail, determine:

- How failure is detected
- Whether retries are appropriate
- The retry limit
- The timeout
- The safe fallback
- How the failure is reported
- Whether normal operation can continue

Never silently ignore critical hardware failures.

---

# 15. Embedded Code Review Checklist

Review every relevant change using the following
categories.

## Hardware Safety

- [ ] GPIO assignments do not conflict.
- [ ] Active-low relay logic remains correct.
- [ ] Relays initialize safely.
- [ ] Invalid sensor readings do not activate
      automatic heating.
- [ ] Manual control behavior is understood.
- [ ] Egg-turning commands cannot unintentionally
      overlap.
- [ ] Electrical hardware assumptions are identified.

## Real-Time Responsiveness

- [ ] No unnecessary long blocking delays.
- [ ] Sensor scheduling remains functional.
- [ ] Control updates remain responsive.
- [ ] HTTP handlers have bounded execution behavior.
- [ ] I2C retries and timeouts are bounded.
- [ ] SD operations have failure handling.
- [ ] `millis()` rollover is handled safely.

## Memory Reliability

- [ ] No unnecessary large local allocations.
- [ ] No uncontrolled buffer growth.
- [ ] No avoidable repeated heap allocations.
- [ ] Request inputs are size-bounded.
- [ ] JSON responses remain valid.
- [ ] Buffers cannot overflow.
- [ ] Persistent writes are not excessive.

## Peripheral Integration

- [ ] Correct I2C addresses.
- [ ] Correct SPI pins and chip select.
- [ ] Sensor CRC checks preserved.
- [ ] RTC failure fallback remains valid.
- [ ] SD failures do not stop control logic.
- [ ] LCD errors are nonfatal.

## Restart and Recovery

- [ ] Startup output states are safe.
- [ ] Persistent values are validated.
- [ ] Recovery does not produce unexpected
      relay activation.
- [ ] Watchdog behavior is compatible with
      the installed platform.
- [ ] Incomplete operations are handled safely.
- [ ] Recovery limitations are documented.

## Security

- [ ] State-changing APIs have appropriate
      authorization checks.
- [ ] User inputs are validated.
- [ ] Credentials are not accidentally exposed.
- [ ] HTTP session assumptions are verified.
- [ ] Network error handling is bounded.
- [ ] Changes do not introduce new unauthenticated
      actuator-control paths.

---

# 16. Debugging Workflow

When an embedded problem is reported, follow this order.

## Step 1: Identify the Symptom

Determine which subsystem is affected:

- Temperature or humidity measurement
- Heater operation
- Fan operation
- Egg-turning motor
- RTC and timestamps
- SD card logging
- LCD display
- Wi-Fi connectivity
- HTTP server
- Prediction output
- Startup or restart behavior

Do not diagnose unrelated components without evidence.

## Step 2: Locate Relevant Code

Identify the source files responsible for the behavior.

Trace the complete path from:

Input -> Validation -> Controller -> Output

For web-related behavior, also trace:

Browser -> HTTP API -> Controller -> Response

## Step 3: Check Configuration

Verify:

- Pin assignments
- Device addresses
- Timing values
- Relay polarity
- Operating mode
- Hardware initialization order

## Step 4: Inspect Failure Handling

Look for:

- Missing validity checks
- Blocking operations
- Invalid pointer or array access
- Unexpected state transitions
- Race conditions where applicable
- Stale sensor measurements
- Incorrect timeout calculations
- Unhandled peripheral errors
- Persistent-state inconsistencies

## Step 5: Propose the Smallest Safe Fix

Prefer a focused modification.

Explain:

1. Root cause
2. Affected files
3. Proposed correction
4. Hardware safety implications
5. Potential regressions
6. Verification method

## Step 6: Verify

Perform available static checks and builds.

Do not claim hardware functionality was tested
unless the relevant hardware was actually tested.

---

# 17. Build and Verification

Run PlatformIO commands from the project root.

## Build Firmware

```powershell
pio run
```

## Build SPIFFS Image

```powershell
pio run --target buildfs
```

## Upload Firmware

```powershell
pio run --target upload
```

## Upload Web Assets

```powershell
pio run --target uploadfs
```

## Serial Monitor

```powershell
pio device monitor -b 115200
```

If `pio` is unavailable on the command path,
use the installed PlatformIO executable.

Firmware changes require firmware uploading.

Changes under `data/` require a filesystem upload.

Do not automatically upload to physical hardware
without authorization.

## Verification Categories

When possible, verify:

- Successful firmware compilation
- Sensor reading validation
- Relay state transitions
- Automatic control hysteresis
- Manual control behavior
- Egg-turn timing
- Failed peripheral recovery
- RTC timestamp handling
- CSV data consistency
- HTTP response validity
- Memory stability
- Restart behavior

A successful build is not equivalent to
successful physical hardware validation.

---

# 18. Testing Expectations

The provided system description does not establish
an existing automated project test suite.

Do not claim tests passed without executing them.

For new or modified firmware logic, recommend or
implement tests where practical.

Prioritize:

1. Hysteresis threshold boundaries
2. Active-low relay state mapping
3. Sensor validity transitions
4. `millis()` rollover
5. Timed egg-turn completion
6. Persistent value validation
7. RTC unavailable behavior
8. SD initialization and write failures
9. Input validation for HTTP endpoints
10. Restart recovery state

Keep hardware-dependent tests distinct from
host-side unit tests.

Do not energize real heating or motor hardware
merely to validate logic without a safe test setup.

---

# 19. Review Severity Classification

Classify confirmed issues using these levels.

## Critical

Issues that can lead to dangerous actuator behavior,
uncontrolled heating, or unauthorized control with
significant safety consequences.

## High

Issues that can cause major system failure,
repeated resets, prolonged control-loop stalls,
or loss of important device functionality.

## Medium

Issues causing recoverable component failures,
incorrect behavior, resource inefficiency,
or significant maintainability problems.

## Low

Minor issues involving readability, comments,
logging clarity, or localized improvements.

Assign severity according to demonstrated impact,
not speculation.

---

# 20. Expected Agent Output

When reviewing embedded code, report findings as:

## Issue

A concise description of the problem.

## Severity

Critical / High / Medium / Low

## Location

Exact file and relevant function or lines.

## Evidence

Explain the code path or condition that demonstrates
the issue.

## Root Cause

Explain why the issue occurs.

## Recommended Fix

Describe the smallest safe correction.

## Compatibility Impact

Identify affected peripherals, APIs, or behavior.

## Verification

Specify tests performed and tests still required.

When generating code, provide:

1. Files changed
2. Summary of changes
3. Why each change is needed
4. Safety considerations
5. Build or test results
6. Remaining limitations

Distinguish between verified findings,
reasonable hypotheses, and untested concerns.

---

# 21. Strict Development Restrictions

The agent MUST NOT:

- Randomly reassign GPIO pins.
- Reverse active-low relay logic.
- Introduce unnecessary blocking delays.
- Remove sensor CRC validation.
- Bypass sensor validity checks.
- Enable automatic heating using invalid readings.
- Assume timed relay activation confirms motor movement.
- Erase SD logs during normal debugging.
- Erase Preferences without authorization.
- Change CSV schemas without considering compatibility.
- Break existing HTTP API contracts unintentionally.
- Introduce unbounded loops or retries.
- Assume a watchdog solves blocking design problems.
- Describe the Random Forest as controlling heaters.
- Assume predictions are physically validated.
- Claim hardware tests were performed without evidence.
- Rewrite unrelated project modules.
- Upload firmware without authorization.

When a requested change conflicts with safety
requirements, explain the conflict and propose
a safer implementation.

---

# 22. Definition of Done

An embedded development task is complete when:

- The requested behavior is implemented or reviewed.
- Existing GPIO assignments are preserved unless
  changes were explicitly requested.
- Relay polarity remains correct.
- Safety-critical control behavior is maintained.
- Timing and failure handling are reviewed.
- Memory implications are considered.
- I2C/SPI integration is checked where relevant.
- HTTP compatibility is reviewed where relevant.
- Restart behavior is considered.
- Available build and tests are performed.
- Unverified hardware assumptions are documented.
- Remaining limitations are clearly reported.

The final priority order is:

1. Hardware safety
2. Correctness
3. Reliability
4. Responsiveness
5. Recovery
6. Memory efficiency
7. Maintainability
8. Performance optimization

Never sacrifice a higher-priority requirement
for a lower-priority improvement.
