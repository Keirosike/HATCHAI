
---
name: esp32-chick-event-delivery
description: Send authenticated chick-detection events from HATCHAI ESP32-S3 to Cloudflare Worker without interrupting incubation controls.
---

# HATCHAI ESP32 Chick Event Delivery

## Purpose

Connect ESP32-S3 chick detection to Cloudflare Worker so subscribed Android phones receive FCM notifications.

## Architecture

ESP32-S3 chick detection
    -> HTTPS request
    -> Cloudflare Worker
    -> D1 subscriber lookup
    -> Firebase Cloud Messaging
    -> Android notifications

## Required Behavior

1. Inspect the actual ESP32-S3 chick-detection implementation.
2. Identify the event that confirms a chick detection.
3. Generate a unique event ID.
4. Add a detection timestamp when reliable time is available.
5. Queue the event for cloud delivery.
6. Send an authenticated HTTPS request to /chick-detected.
7. Process the Worker response.
8. Retry temporary failures safely.
9. Prevent duplicate notification broadcasts.
10. Continue local detection and incubator operation during network failures.

## Detection Rules

- Do not treat every model inference as a new chick.
- Apply temporal confirmation.
- Preserve model confidence information.
- Do not equate model confidence with measured accuracy.
- Avoid duplicate events for the same continuous detection.
- Distinguish chick detected from confirmed chick hatched.
- Do not invent chick counts.

## Authentication

Use a device-specific credential.

- Keep credentials out of public source repositories.
- Do not put Firebase Admin credentials on ESP32.
- Do not put service-account private keys in firmware.
- Use TLS certificate validation.
- Do not disable certificate verification.
- Use a server-validated authentication scheme.
- Protect against event replay.
- Support credential rotation.

## Request Example

POST /chick-detected

```json
{
  "eventId": "unique-event-identifier",
  "deviceId": "hatchai-s3-01",
  "eventType": "chick_detected",
  "confidence": 0.91,
  "timestamp": "2026-11-07T12:00:00Z"
}
```

The example confidence and timestamp are illustrative only.

Do not assume this request format is already implemented.

## Network Requirements

- Use ESP32 station connectivity when available.
- Preserve AP+STA behavior.
- Keep detection and incubation control nonblocking.
- Use bounded connection and request timeouts.
- Use a small bounded event queue.
- Apply exponential backoff with jitter.
- Avoid unbounded retries.
- Handle reboot and offline recovery.
- Never allow network requests to delay safety-critical heater or motor control.

## Worker Response Handling

Handle:

- 200/202: Accepted
- 400: Invalid event
- 401/403: Authentication failure
- 409: Duplicate event
- 429: Rate limited
- 500/503: Temporary backend failure

Match behavior to the actual implemented Worker contract.

Do not retry permanent validation failures indefinitely.

## Files to Inspect

- AGENTS.md
- platformio.ini
- ESP32-S3-CAM project source
- Chick-detection model integration
- Network configuration
- Existing event or telemetry modules
- Cloudflare Worker /chick-detected handler

## Hardware Safety

- Preserve relay control logic.
- Preserve temperature and humidity monitoring.
- Do not change GPIO assignments.
- Do not block the main control loop.
- Do not activate heaters, motors, or fans during testing.
- Do not flash firmware without approval.

## Verification

- Confirm detection event generation.
- Confirm unique event IDs.
- Confirm authenticated HTTPS delivery.
- Confirm invalid credentials are rejected.
- Confirm offline queue behavior.
- Confirm duplicate event protection.
- Confirm Worker accepts a valid event.
- Confirm multiple Android phones receive alerts.
- Measure timing impact on local operation where practical.

## Completion

Report firmware files changed, build results, network tests, physical hardware tests, and deployment status.
