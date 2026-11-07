
---
name: hatchai-notification-modal
description: Implement a post-login notification modal in the HATCHAI ESP32 dashboard, with secure HTTPS enrollment for Android web push notifications.
---

# HATCHAI Notification Modal

## Purpose

Implement a lightweight notification modal that appears after a user successfully logs in to the HATCHAI ESP32 dashboard.

The modal helps users enable chick-detection notifications on their Android phones.

## Project Context

- HATCHAI uses one shared ESP32 username and password.
- Multiple Android phones can subscribe to notifications.
- The local ESP32 dashboard runs at `http://192.168.4.1`.
- Firebase Hosting runs at `https://hatchai-8d34c.web.app`.
- Firebase Cloud Messaging handles push notifications.
- Cloudflare Worker and D1 manage device registration.
- Firebase Spark must remain supported.

## Required Behavior

1. Detect a successful ESP32 dashboard login.
2. Display the notification modal after the dashboard loads.
3. Show an Enable Notifications button.
4. Explain that notification permission is required.
5. Allow users to close or dismiss the modal.
6. Remember dismissal within the appropriate browser session.
7. Do not interrupt temperature monitoring or incubator controls.
8. Make the modal responsive on Android phones.
9. Provide accessible focus management, labels, and keyboard support.

## HTTPS Requirement

Web push permission must be requested from the secure Firebase-hosted website.

Do not attempt to request notification permission directly from the ESP32 HTTP dashboard.

Do not embed the Firebase notification page inside an iframe for permission requests.

The modal should open the Firebase HTTPS enrollment page through an explicit user action.

## Security

- Never place the ESP32 password in URL parameters.
- Never store account passwords in modal JavaScript.
- Do not treat a successful local login as automatically authenticated to Cloudflare.
- Use a verified enrollment mechanism before accepting private notification subscriptions.
- Do not expose FCM server credentials.
- Respect notification denial and dismissal.

## Files to Inspect

- `AGENTS.md`
- `data/js/login.js`
- `data/js/authSession.js`
- `data/js/dashboard.js`
- `data/js/espApi.js`
- `src/HatchWebServer.cpp`
- Existing dashboard HTML and CSS

## UI Requirements

- Use HTML, CSS, and vanilla JavaScript.
- Avoid React, Vue, Angular, and heavy libraries.
- Follow `ui-ux-pro-max` and `esp32-ui-limiter`.
- Keep SPIFFS assets lightweight.
- Avoid unnecessary shadows and animations.
- Preserve existing dashboard styling.
- Do not display the modal before successful login.

## Verification

- Modal appears after successful login.
- Modal does not appear on failed login.
- Close button works.
- Enable button opens the HTTPS enrollment page.
- Android layout works.
- Dashboard monitoring remains functional.
- Existing authentication flow is preserved.
- No firmware or SPIFFS upload without approval.

## Completion

Report files changed, behavior implemented, checks performed, and remaining limitations.
