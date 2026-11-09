# OPTRACE-V1: encrypted credential-operation tracing

This is an instrumented candidate, not a confirmed hardware timeout fix. No
physical execution or provisioning was performed during implementation.

## Evidence and ranked hypotheses

The reported timely confirmation weakens the old fixed 120-second lifetime
hypothesis. The read-only diagnostic passed synthetic codec validation, guarded
NVS initialization and unrelatedDigest(), then returned expected NOT_FOUND on
NVS_READONLY open. It did not test writable namespace creation, the encrypted
production request, or production's exact stack/heap usage. Identical reported
NVS hashes mean no persistent journal or namespace change was detected.

Leading hypothesis: the first NVS_READWRITE namespace open (which may create the
namespace and perform the first physical write) stalls or resets. Second: a
production-only framing/decryption exit or resource fault before that point.
Third: NVS initialization/digest in the larger encrypted application, despite
passing in the smaller diagnostic. Session expiration remains detectable but is
not treated as the explanation for timely attempts. The journal is less likely
because no persistent journal exists, but a failed first journal write cannot be
excluded. SDK calls and physical flash fault paths are not proven by mocks.

No saved full diagnostic PASS log/receipt was found in the inspected workspace,
backup metadata directory or matching user-temp log names. Stage results and NVS
hashes are user-provided evidence. Full 4-MB preservation for the latest diagnostic
run is UNVERIFIED from the supplied truncated final line. No backup was decrypted.

## What changed

Transaction decisions and ordering are unchanged. Main, adapter and core emit
bounded encrypted events at existing call boundaries. Events carry only a stage,
numeric return code, elapsed milliseconds, free heap and stack high-water margin.
There are at most 96 events per request. They never carry keys, record bytes,
payloads, namespace values, fingerprints or proof material.

Events use AES-GCM with the existing session key, a disjoint S2H! IV domain and
64-bit ticket (request sequence << 32 | event counter). AAD binds the challenge
and ticket. Normal response D2H! and request H2D! IV domains are unchanged.
The host authenticates each event, enforces order and allowlists stage IDs before
printing sanitized output. Tampered/replayed/unknown events stop the session.
Authenticated expiry/rejection events produce an explicit failure. The host also
refuses a partial serial write instead of waiting on an incomplete packet.
No automatic retry, gate bypass, timeout extension or watchdog change is added.

| Last event | Interpretation |
|---|---|
| request_received | Line received; parse/base64/peer checks next |
| request_decrypted | AES-GCM accepted; operation/record validation next |
| record_and_snapshot_valid | Record and unchanged raw NVS confirmed |
| nvs_init_begin / nvs_init_end | Guarded SDK initialization |
| digest_begin / digest_end | Actual unrelated-record digest |
| write_gate_enabled | Existing authorization gate opened |
| namespace_open_begin / namespace_open_end | Existing adapter namespace open |
| journal_begin / journal_end | First journal write |
| nvs_set_result / commit_begin / commit_end | SDK set/commit result |
| reopen_begin / reopen_end | Fresh NVS initialization/readback |
| slot_verified / selector_verified / activation_verified | Existing transaction stages |
| session_stopped | rc 1 expiry, 2 decrypt, 3 framing, 4 base64, 5 peer, 6 request validation, 7 ordering, 10 gate refusal |

Stage elapsed time starts before waiting for the request, so it includes time at
the confirmation prompt. Host's 30-second operation deadline is not extended by
events. SDK calls can still block or reset; the last authenticated event narrows
the location without pretending to forcibly cancel a physical write.

## Separate artifact

Build command: `powershell -File tools/notification-provisioner/build.ps1 -BuildDirectory build-optrace-v1`
Binary: `build-optrace-v1/hatchai_usb_provisioner.bin`
Manifest: `build-optrace-v1/hatchai_usb_provisioner.manifest.json`
Size: 174,256 bytes (1,392 bytes larger than A905 image).
SHA-256: `12E1F216A34FEE2A1D4AE586BA0C047B747023F88C708C0B0FBAFC1164F16F7D`.
Old `build/hatchai_usb_provisioner.bin` remains unchanged with A905 hash.
Main firmware remains FE836BEBF3799713FD8F2194DA83327BF97B883C5F0922161FA6163B5CA28C84.

New telemetry slightly increases stack/heap use and serial work. Runtime margins
remain unverified; metrics are intended to reveal that risk. All image segments
pass RAM-range, checksum and validation-hash checks. GPIO/control/network code
is not included in the utility. Chick-detected remains disabled.

## Local tests

56 host tests pass, including event authentication, nonce-domain separation,
ordering, replay/tamper/unknown-stage refusal, mixed event/response input, partial
serial transmission and the existing DPAPI/preservation tests with synthetic keys.
36 authorization/raw-NVS checks pass. Production codec/transaction and RAM-adapter
suites each pass 267 checks. Existing notification native tests: 113 pass; signing
vectors: 25 pass, including five signatures accepted by the Worker verifier.

## Separately authorized supervised procedure

Do not execute automatically. Isolate loads and retain the original encrypted
backup `b03fd35b8a88-20261109-085011.before.flash.dpapi`. Verify current NVS state
before choosing normal install, resume or verify-existing. The reported unchanged
snapshot has no transaction to resume; an ambiguous future attempt must be
inspected again rather than blindly retried.

Use the existing reviewed command and confirmation flow, changing only these
image arguments to select this candidate explicitly:

```powershell
--ram-image .\tools\notification-provisioner\build-optrace-v1\hatchai_usb_provisioner.bin `
--ram-sha256 12E1F216A34FEE2A1D4AE586BA0C047B747023F88C708C0B0FBAFC1164F16F7D
```

Keep the standard verified encrypted pre-write backup and final preservation
checks. These reads are required for a write attempt; no extra full-read loop was
introduced. Save sanitized ram-stage lines. On failure stop and use read-only
state reconciliation before selecting recovery. Only a final credential proof,
post-reset record verification and preservation PASS establish installation.
After that, supervised reboot and credentialsReady validation precede cloud/phone
tests. This task does not authorize chick delivery, cloud deployment or flashing.
