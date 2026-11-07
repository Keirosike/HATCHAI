# Standalone RTC startup and LCD batch labels

The DS3231 can respond at I2C 0x68 while its time remains untrusted. The original
driver rejected 12-hour format and latched several validation faults until a
browser clock sync. Its jump check also replaced the baseline with untrusted
frames. The LCD used the internal batch ID if live recovery metadata was not yet
restored, explaining long numeric/random-looking roller labels after reboot.

## Changes

- Decode valid 12-hour AM/PM as well as 24-hour registers; retain BCD/calendar checks.
- Require three coherent readings with clock advancement. Transient reads/jumps
  can requalify without a browser, while frozen/backward/inconsistent time remains
  untrusted. Bad frames do not overwrite the last trusted time baseline.
- Ensure the DS3231 backup oscillator enable bit permits battery operation,
  preserving other control/status bits. Do not clear the oscillator-stop/lost-time
  flag merely to make the RTC appear ready.
- Saved Wi-Fi starts asynchronous SNTP on station connection. If RTC time is lost
  or invalid, a successful SDK network-time synchronization supplies current time
  automatically, without a website session. RTC local wall time remains Asia/Manila
  (UTC+8), matching existing local-date batch logic. Set attempts are throttled.
- Prefer current matching batch metadata, then the newest CRC-valid matching SD
  snapshot label, even before RTC-based state recovery completes. Missing metadata
  shows `Loading`; opaque numeric batch IDs are never used as LCD labels. Existing
  LCD rows, day suffixes, estimates and alarm overrides stay unchanged.

The driver's register behavior follows the
[DS3231 datasheet](https://www.analog.com/media/en/technical-documentation/data-sheets/ds3231.pdf).
Automatic network time uses the ESP32
[SNTP synchronization status](https://docs.espressif.com/projects/esp-idf/en/v4.4.2/esp32/api-reference/system/system_time.html).

## Hardware and offline limits

A healthy battery-backed RTC should retain time and become ready a few seconds
after startup without Wi-Fi or a browser. If its oscillator-stop flag appears
after every power OFF, inspect the backup battery, holder/contact, module and
battery compatibility. Software cannot determine accurate outage duration from a
stopped RTC or an old SD timestamp. No build-time/snapshot timestamp is substituted
as current time. With genuinely lost RTC time, internet-connected saved Wi-Fi or
the existing browser sync is needed. AP-only Wi-Fi does not provide internet time.

Valid SD files and original batch dates are preserved. An actual conflict between
trusted current time and saved batch dates/clock floor continues to hold automatic
turning OFF; neither missed turns nor a new Day 1 is invented. Missing label
metadata cannot be reconstructed from an internal batch ID; the normal batch sync
must supply it if no valid snapshot includes a label.

PID heating and relay GPIO assignments are not changed. These fixes affect time
validation/network recovery and the LCD label source. Firmware upload alone applies
them. No upload, serial reset, RTC write or physical relay operation was performed
by the development checks. Actual battery retention, internet/NTP availability,
I2C noise and physical LCD output remain unverified.
