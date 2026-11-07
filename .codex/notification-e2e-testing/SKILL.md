
---
name: notification-e2e-testing
description: Test HATCHAI notification enrollment, Cloudflare D1 registration, ESP32 chick events, and Firebase push delivery across Android browsers.
---

# HATCHAI Notification End-to-End Testing

## Purpose

Verify that HATCHAI notifications work across multiple Android phones using one shared HATCHAI account.

Test the complete flow from login to chick-detection alert delivery.

## Expected User Flow

1. User logs in to the ESP32 dashboard.
2. Notification modal appears.
3. User selects Enable Notifications.
4. Firebase-hosted enrollment page opens.
5. User completes secure enrollment.
6. Android Chrome requests notification permission.
7. User taps Allow.
8. Firebase generates an FCM token.
9. Cloudflare Worker registers the token in D1.
10. ESP32-S3 sends a chick-detection event.
11. Worker broadcasts through FCM.
12. All active subscribed Android browsers receive alerts.

## Test Environments

- Android Chrome, multiple devices
- Firebase Hosting HTTPS
- Firebase Cloud Messaging
- Cloudflare Worker
- Cloudflare D1
- ESP32 local dashboard
- ESP32-S3 chick-detection firmware

## Functional Test Cases

### Login and Modal

- Successful login displays modal.
- Failed login does not display modal.
- Modal dismissal works.
- Enable button opens HTTPS enrollment.
- Modal remains responsive on mobile.
- Dashboard operation is unaffected.

### Notification Permission

- First-time permission request.
- Permission granted.
- Permission denied.
- Permission previously granted.
- Permission revoked in browser settings.
- Unsupported browser handling.

### FCM Registration

- First Android token registration.
- Second Android token registration.
- Third Android token registration.
- Duplicate registration does not create duplicate rows.
- Token refresh updates the registration.
- Backend failure does not display false success.
- Disabled browser does not automatically re-register.

### Security

- Unauthorized registration rejected.
- Invalid enrollment code rejected.
- Expired code rejected.
- Invalid Turnstile token rejected.
- CORS behavior verified.
- Invalid ESP32 credentials rejected.
- Replayed events rejected.
- No secrets exposed in frontend files or logs.

### Notification Delivery

- Foreground notification.
- Background notification.
- Browser closed notification, where supported.
- Screen locked.
- Multiple Android devices.
- Device temporarily offline.
- Duplicate chick event.
- FCM token invalidated.
- Notification click opens the expected page.

## D1 Checks

Verify:

- Registered device count.
- Unique tokens.
- Enabled and disabled registrations.
- Updated timestamps.
- No unintended deletion of other devices.
- No public token enumeration.

Do not display full FCM tokens in reports.

## Suggested Test Matrix

| Scenario | Expected Result |
|---|---|
| Android 1 subscribes | D1 has 1 active registration |
| Android 2 subscribes | D1 has 2 active registrations |
| Android 3 subscribes | D1 has 3 active registrations |
| Android 2 disables | D1 has 2 active registrations |
| Chick detected | Both active Android devices receive alert |
| Duplicate event | No second broadcast |
| Unauthorized request | Registration rejected |
| Offline Android | Delivery behavior recorded after reconnection |

Counts assume a clean test database.

## Testing Rules

- Start with local or mock tests.
- Use a dedicated test event instead of requiring a real chick to hatch.
- Do not trigger incubator relays or motors.
- Do not flash firmware without approval.
- Do not deploy cloud changes without approval.
- Record actual results rather than assumed success.

## Completion Report

Include:

1. Files tested.
2. Test environment.
3. Test cases executed.
4. Passed tests.
5. Failed tests.
6. Tests not performed.
7. Security findings.
8. Remaining limitations.
9. Deployment status.

Do not claim end-to-end success unless the notification was actually observed on the Android devices.
