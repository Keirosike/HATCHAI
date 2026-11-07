# Camera and Firebase chick alerts

The incubator serves `camera.html` from SPIFFS. Video goes directly from browser
to the camera; the incubator never proxies JPEGs or runs inference. The camera
captures/inferences once per second when idle, independently of browser activity.
Three consecutive positive inference results qualify an alert. A 60-second
cooldown limits repeats while a chick remains visible. This is model output,
not proof of a hatch or model accuracy. Existing camera confidence controls still
affect inference; lower thresholds can increase false positives.

## Wiring must be resolved before sound is enabled

The incubator uses GPIO25 for the lower roller, GPIO26 for the upper roller,
GPIO27 for the heater and GPIO14 for the fan. Do not share GPIO25 with a buzzer.
ESP32-S3 does not have GPIO25. Header position 25 is not necessarily GPIO25.
Confirm the board pinout and actual wiring before changing anything.

`HatchConfig::PassiveBuzzerPin` in `include/Config.h` defaults to -1
(disabled). Once a free GPIO32 or GPIO33 is confirmed and the passive buzzer is
rewired, set the value accordingly. Other values are deliberately rejected.
LEDC channel 2 produces a 2200 Hz tone in three 200 ms pulses without blocking
the controller. A driver transistor is needed if buzzer current exceeds the
GPIO specification. Alarm audio is separate from heat/roller control.

## Local connection

1. In `esp32-devcam/camera/main/hatch_link_config.hpp`, set router Wi-Fi credentials
   and the incubator's LAN address in `ControllerUrl`. Connect the incubator to
   that same router using its existing Wi-Fi settings. Reserve board IPs in DHCP.
2. This workspace has generated matching local/push keys in the ignored private
   `include/CameraLinkSecrets.h`. Both firmware projects include that file. Keep
   it private and back it up securely. A fresh checkout without this private file
   defaults to empty keys and rejects events; generate new matching keys there
   or configure both projects explicitly. Never commit configured secrets.
3. Build/upload both board firmwares, and the incubator SPIFFS image, when ready.
   Open Camera in the incubator navigation. The camera publishes status every
   five seconds; status becomes offline after 20 seconds without a heartbeat.
   The page polls every five seconds and only loads video after Show camera.
   Hiding the page stops its preview. Camera inference continues.

Out of the box the camera joins `HatchAI-ESP32` using the existing AP password,
with controller URL `http://192.168.4.1`. This supports local operation but does
not supply internet for push. Camera setup AP remains `ESP32-CAM` / `12345678`,
now at `http://192.168.5.1` to avoid overlapping the incubator AP subnet.
For a phone on the camera setup AP, use the setup address directly; normal
navigation/status integration expects browser and boards on the shared network.

New endpoints are GET `/api/camera` and keyed JSON POST `/api/camera/event`.
Events are bounded and the reported IP must match the connecting camera IP.
This is a LAN HTTP shared-key link, not encrypted remote actuator access.
Existing controller endpoints and heating/turning behavior are preserved.

## Firebase setup (not deployed by this change)

1. Use project `hatchai-8d34c`. Enable Email/Password in Firebase Authentication,
   create your owner user, and record its UID. This account is distinct from the
   incubator login. This workspace's ignored `functions/.env.hatchai-8d34c` already
   sets `HATCHAI_OWNER_UID` to the UID supplied by the user.
2. Generate Web Push certificates in Firebase Project settings > Cloud Messaging.
   The supplied public VAPID key is already in `public/push-settings.js`. Do not put a service
   account private key or camera secret in any public file.
3. In `functions/`, run `npm install`. Configure the Firebase CLI/project and set
   the generated secret from the repository root using
   `firebase functions:secrets:set CAMERA_SECRET --data-file functions/camera-secret.txt`.
   That file and `functions/.secret.local` are ignored local credentials. The latter
   supplies the same secret to the Functions emulator only.
   Deploy Functions, Hosting and Firestore rules using
   `firebase deploy --only functions,hosting,firestore:rules` when authorized.
   Cloud Functions deployment requires a project with the appropriate billing
   plan and services enabled. Review the Firebase console deployment prompts.
4. Camera `PushUrl` is configured as `https://hatchai-8d34c.web.app/api/chick` and
   `PushKey` comes from the same private header. Build/upload camera firmware
   when authorized. TLS uses the ESP-IDF
   certificate bundle and network time; it never disables certificate checking.
5. Open the HTTPS notification site, sign in with the owner account and click
   Enable notifications. Repeat for each browser. Up to 20 stored tokens are
   supported. Re-enable after token rotation or clearing browser storage.
   Disable notifications removes that browser's token; signing out alone does
   not unsubscribe it. Permissions and delivery depend on the browser/OS.

The Firebase service worker handles background notification payloads; foreground
messages update the page's status. Firebase Hosting rewrites route enrollment
and chick events to trusted Functions using the Admin SDK. Only the owner UID
can register tokens. Camera events require the secret and are deduplicated and
rate limited. Invalid/expired FCM tokens are removed. Firestore client access is
denied; the Admin SDK manages tokens and event state. This replaces the previous
temporary open Firestore rules. No existing cloud data is migrated or deleted.

The camera retries a failed cloud event up to three times. The pending event
queue holds only the newest event in RAM, so power loss can lose an unsent alert.
Partial FCM failures are reported/logged and successful tokens are not resent.
There is no guarantee of exactly-once delivery or an unlimited offline backlog.
Neither Firebase nor a camera failure stops incubator control. The ESP32 buzzer
requires the local heartbeat link; loss of that link prevents a local sound.

## Verification and deployment boundaries

Firmware builds, SPIFFS packaging, JS syntax and mocked tests do not establish
live push delivery, model accuracy, buzzer output or camera performance. Test
network loss, recovery, browser permission denial, repeated detections and actual
chicks under the intended lighting before relying on alerts. No deployment or
physical actuator command is implicit in source changes.

Measured SPIFFS UI source assets: 387,332 bytes total; JavaScript 152,708 bytes;
CSS 47,477 bytes; largest HTML page 17,999 bytes; largest image 39,032 bytes.
JavaScript exceeds the recommended 80 KB aggregate budget, and the total exceeds
350 KB. These aggregate overruns already existed before this integration; new
camera assets add to them. CSS, individual HTML pages and image sizes remain
within their recommended budgets. Cloud SDKs and notification enrollment assets
are hosted separately under `public/`, not packaged into ESP32 SPIFFS.

Local verification on November 7, 2026: incubator firmware and SPIFFS builds
passed; ESP-IDF camera build passed (camera application 1,285,872 bytes of a
4 MB application partition). Incubator firmware used 67,144 bytes RAM and
1,069,709 bytes flash. The 152 existing mocked browser checks passed. New
`test/camera-push.cjs` cloud and browser mocks passed for authorization,
registration/removal, cooldown/deduplication, delivery failure/retry, camera
connection states, preview controls, responsive widths, sign-in and browser
notification permissions. Backend exports loaded using installed Firebase SDKs;
JavaScript syntax and whitespace checks passed. Both board binaries contain the
matching private keys. Mobile/desktop screenshots were inspected. The camera
build retains SDK/missing-initializer warnings and a nonfatal GDB ROM-symbol
configuration warning. No upload, Firebase deployment, live push, model-accuracy
test, RTC write, buzzer actuation or relay operation was performed.
