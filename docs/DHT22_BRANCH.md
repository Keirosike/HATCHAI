# DHT22 sensor conversion

This branch uses DHT22 data on GPIO4 (3.3 V logic), replacing the active SHT40
sensor. RTC/LCD I2C remains on GPIO21/22. A bare DHT22 needs a suitable data pull-up
to 3.3 V; inspect the module for an existing pull-up and verify its pin labels.

The adapter uses pinned Adafruit DHT 1.4.6 and Unified Sensor 1.1.15, a two-second
startup gate, checksum/timing validation in the driver and finite/range checks.
The existing five-second schedule and twenty-second retained-reading expiry are
unchanged. No immediate retries or new long connection loops were added. DHT
acquisition is timing-sensitive and briefly occupies the CPU; build success does
not establish physical sensor accuracy or control-loop timing.

The current main branch retains heater GPIO27, lower roller GPIO25, upper roller
GPIO26, and its existing fan assignment GPIO14. This conversion does NOT change
those assignments or add passive-buzzer support. If GPIO14 is wired to a buzzer
and the fan is directly powered, that mismatch needs a separate correction before
uploading. Verify actual connected wiring; do not assume the earlier branch's
relay map applies to main.

SHT40 driver files remain available but are no longer instantiated by main.cpp.
No cloud/notification files, dashboard assets or persistent storage were changed.
