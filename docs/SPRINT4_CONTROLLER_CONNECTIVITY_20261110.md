# Controller connectivity execution — 2026-11-10

Operator authorized production registry/credential/telemetry work, conditional on physical preservation and load isolation. Operator reconfirmed heater/motor power disconnected, USB controller on COM3.

## Actual operations

- Existing host and RAM manifest already pin controller MAC b03fd35b6134 and logical ID hatchai-inc01-controller. No identity substitution was made.
- Invoked read-only diagnose with existing controller RAM image SHA256 9496A3754A28D47331241FEE0824F0A6E94F17DD429B09981A48589647EF84B2.
- Immediate result: `STOP: operation_failed`. No completed flash-read progress, RAM transfer or credential transaction was reported. No automatic retry.
- Subsequent dependency/inventory check (no serial open): esptool4.12.0 installed; serial.tools.list_ports returned zero ports. Thus COM3 was not available to this process; the raw initial exception was intentionally suppressed and cannot establish a more specific driver cause.
- Added explicit serial_port_unavailable preflight and sanitized serial_open_failed handling. All identity and snapshot checks remain intact. No RAM rebuild: only host Python changed.
- Offline tests:67 transaction assertions and22 host tests passed. Initial sandbox compiler cache access failed; approved external-cache rerun passed. Tests mocked hardware.
- Prepared/validated existing workflow's Windows DPAPI three-device credential bundle, refusing replacement. Uploaded TELEMETRY_DEVICE_KEYS and CAMERA_EVENT_KEYS via stdin; upload guard confirmed neither binding existed before upload. Secret-name verification confirms eight bindings, preserving the prior six. No key values were displayed.

## Still blocked

No NVS writes, firmware flashing, registry mutation or telemetry activation occurred. Registry content must be verified through Supabase SQL Editor or an authorized database connection; no such direct connection is available in this session. Prior supplied003–007 metadata exports remain the available production schema evidence.

Requested safe user steps: reconnect USB with loads isolated and report actual current COM port; export device_id/incubator_id/key_id/role/position/enabled from hatchai_sync_devices. Do not infer identity from port number. Future hardware retry must independently verify the pinned MAC, complete two matching baseline snapshots, encrypted backup, RAM startup and two matching preservation snapshots before permitting provisioning. Keep all ingestion/delivery gates disabled meanwhile.

## Live-data status

No physical DHT22 reading reached production during this run. Latest record, first30-minute aggregation window, authenticated dashboard timestamp and actual notification receipt remain unverified. Camera and notification activation must follow, not precede, verified controller telemetry.
