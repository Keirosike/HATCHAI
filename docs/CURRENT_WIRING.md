# Confirmed main-controller wiring

This update supersedes older SHT40 and fan-relay instructions for the current main ESP32 build.

| Component | Connection |
| --- | --- |
| DHT22 data | GPIO4; pull up data to 3.3 V (typically 4.7–10 kΩ, unless supplied on the module) |
| Passive buzzer | GPIO14; existing nonblocking chick-alert pattern, LEDC channel 2 |
| Fan | Direct power supply; no assigned GPIO or software switching |
| Heater relay | GPIO27, active-low |
| Lower roller relay | GPIO25, active-low |
| Upper roller relay | GPIO26, active-low |
| RTC and LCD I2C | SDA21 / SCL22, unchanged |

Fan status is an assumption from wiring, not measured rotation or power feedback. The fan switch is read-only.
CRC-checked recovery snapshots with the previous fan-pin metadata (14) remain readable; all outputs use the current compiled pins, so restoring a snapshot cannot drive the former fan pin. New snapshots record fan pin -1.
DHT22 samples remain five seconds apart, failures retry after 2.1 seconds, and checksum/range validation feeds the unchanged sensor qualification and thermal protections.
The timing-sensitive DHT22 capture masks interrupts on the calling core for at most approximately 6.5 ms; the start pulse adds 2 ms outside that section. Physical timing under Wi-Fi/TLS/SD load must be checked before operating with eggs or heater loads.

Do not connect GPIO14 to the former fan relay input while using the buzzer. Confirm the passive buzzer's electrical requirements and use an appropriate driver if its current exceeds GPIO limits.
No upload or physical hardware verification is implied by this wiring update. Rebuilt firmware and SPIFFS hashes supersede earlier artifacts.
