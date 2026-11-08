# Controller pairing protocol/state-machine checks (Step 4.3.17)

This step adds isolated C++ helpers only. Nothing constructs the pairing client in
`main.cpp`. There are no HTTPS calls, Wi-Fi/task additions, LCD changes, dashboard
routes, NVS access or actual credentials. Existing incubation modules are not edited.

## Files and verification

- `include/NotificationPairingProtocol.h`, `src/NotificationPairingProtocol.cpp`:
  bounded JSON grammar/canonicalization, SHA-256, HMAC-SHA256, unpadded base64url,
  strict controller/key identity and exact method/path signing.
- `include/NotificationPairingClient.h`, `src/NotificationPairingClient.cpp`:
  explicitly injected credentials, transport and nonce source; no transport backend.
- `vectors.json`: deterministic public fixtures, including all four device paths.
- `run.mjs`: compiles and runs actual C++ code, then compares its canonical bytes,
  hashes and signatures with the existing Worker's actual security helpers. It
  verifies native signatures using `verifyController()` and rejects tampered data.
- `native.cpp`: mock-driven state, parsing, expiry, cancellation and leakage tests.

Run from repository root:

```powershell
node test/notification-pairing/run.mjs
& 'C:/Users/LENOVO/.platformio/penv/Scripts/platformio.exe' run -e esp32dev
```

The host harness is Windows-only and uses Windows CNG SHA-256/HMAC. The ESP32
build uses installed mbedTLS APIs. No home-grown hash implementation is included.
Host execution does not establish target timing or on-device mbedTLS execution.

The host compiler is Zig 0.13.0, isolated under ignored `.tools`, with generated
output/cache in ignored `.build`. Set `HATCHAI_ZIG` to an existing compatible Zig
executable, or install the pinned test dependency (requires network permission):

```powershell
python -m pip install --no-cache-dir --target test/notification-pairing/.tools ziglang==0.13.0
```

The runner also requires the project's existing ArduinoJson 6.21.5 headers in
`.pio/libdeps/esp32dev/ArduinoJson/src`; a normal PlatformIO build supplies them.

## Accepted JSON domain

The helper recursively sorts object keys by **UTF-16 code units**, matching JS
`Object.keys(...).sort()`, preserves array order, escapes strings like
`JSON.stringify`, and removes only a top-level `signature` before signing.
Strict validation consumes the entire input and rejects trailing garbage,
malformed UTF-8/escapes, excess depth/nodes and overlong documents.

To avoid ambiguous cross-runtime floating formatting, this is deliberately a
**pairing-specific JSON subset**, not a general ECMAScript number serializer:
numbers must resolve to integral IEEE754 values in ±(2^53−1). Fractional/unsafe
numbers fail closed. Integral exponents and negative zero are normalized. Strings
must contain Unicode scalar values; decoded NUL and lone UTF-16 surrogates are
rejected instead of being truncated by ArduinoJson. This covers the Worker's
actual device-pairing schemas (integer timestamps/TTLs and ASCII identifiers).
Do not reuse it for floating confidence/telemetry values without a separate review.

Bounds: 2,048-byte JSON input/output, depth 8, 128 values; transport responses
1,024 bytes. JSON memory arenas and temporary vectors/strings remain bounded by
those limits. SHA/HMAC key length must be exactly 32 bytes. The only accepted
device ID is `hatchai-inc01-controller`; key IDs are 1–64 ASCII word/hyphen
characters. Method must be `POST`, path one of the four `/device/pairing/*` paths.

## State and transport contract

Construct with an explicit `NotificationUtcClock`, call `configure()` with
credentials, then `start(nowMs, utcSeconds)`.
Without valid credentials the client remains Unavailable. UTC must be supplied
by a future trusted/time-validated integration; no clock/RNG implementation is
included. Tests use a fixed public key byte sequence 00..1f and deterministic
nonces; never use those test values on hardware.

`Transport::submit()` must promptly copy/enqueue the signed outbound request.
It must not call `complete()` inline, block, or perform networking inside the
caller. The future task/queue adapter must serialize calls into this client: the
class is not thread-safe. Replies include their exact generation and ticket.
`abort()` invalidates a local request; it cannot promise the server did not act.

- One operation is active at a time; duplicate starts do not enqueue work.
- Every challenge is validated for session ID, purpose and 60-second TTL before
  issuing the next signed operation. Start replies require the same pairing ID,
  exactly 16 Base32 characters and exactly 300 seconds TTL.
- Requests have a 15-second response deadline. `tick()` never sleeps or waits;
  it schedules at most one operation, polling status no faster than five seconds.
- The code-display deadline starts before the start submission. Status cannot
  extend it. Timers use unsigned subtraction across `millis()` rollover; the
  caller must tick regularly and not leave the client dormant for a full wrap.
- Cancellation immediately wipes the private code array, aborts the local request,
  and changes generation. Late/duplicate replies cannot restore a code. A pending
  start's known session ID permits a fresh cloud cancellation attempt.
- Successful remote cancellation or expiry releases the operation. A cancellation
  that loses to registration reports Registered, not Cancelled. An unexpected
  `challenge`/`issued` cancellation response is not treated as successful revocation.
- A transport/protocol error after start keeps the remote target uncertain and
  blocks another start. Explicit status/cancel may resolve it; otherwise the
  client allows 11 minutes for the remaining challenge, code and grant windows.
  An HTTP error never claims cloud cancellation or registration succeeded.
- Redeemed/Registered/Cancelled/Expired states never reveal the code in public
  status. Generation counters fail closed rather than wrapping.

`PublicStatus` and its JSON contain only enums and booleans. There is no production
code getter or LCD integration. The sole test-only friend checks private clearing;
it is absent from the production build. The raw key and private code array are
wiped on teardown/clear. This does not claim forensic removal of every temporary
JSON/string allocation in RAM; no private payload is logged or persisted.

## Step 4.3.19: credential codec and mock retry results

`NotificationCredentialStore` encodes at most 160 bytes with no persisted C++
struct padding. Layout: ASCII magic `HNPC` (4), format version (1), reserved zero
(1), total byte length (1), device-ID length (1), key-ID length (1), key length
(1), little-endian nonzero rotation generation (4), exact controller ID bytes,
1–64 ASCII key-ID bytes, exactly 32 raw key bytes, and little-endian IEEE CRC32
(4, polynomial 0xedb88320). CRC covers all preceding bytes. It detects accidental
corruption only; it provides neither encryption nor authentication/anti-rollback.
Record buffers and decoded raw keys are wiped on destruction. No keys are generated.

The in-memory `MockNotificationCredentialStore` contains two slots and an explicit
selector. Loading never scans/falls back to the inactive slot. Missing/invalid
selectors, revoked slots and invalid records clear the output and fail closed.
Rotation requires a valid selected predecessor, a strictly increasing generation,
and a different key ID. The mock writes the inactive slot, decodes and compares
readback, then retires the previous slot and commits selection. Changing selection
back to a retired slot cannot reactivate it. Interrupted/truncated writes, corruption during
readback and selector-commit failure are injected by `nextFault`. The old key
remains explicitly active if rotation fails; this is not fallback after revocation.
If first initialization is interrupted, subsequent initialization fails rather
than guessing which record to trust. Administrative recovery is intentionally
not implemented. Public slots/selector are mock fault-injection surfaces only.
Revocation flags and selectors are RAM simulation, not tamper-resistant storage.
No Preferences include, NVS call, commissioning command or production key exists.

`NotificationTransportResult` defines typed success, network/DNS/TLS errors,
connection/operation timeouts, 429, 5xx, authentication/validation failures,
malformed replies and cancellation. `httpTransportResult()` classifies HTTP
codes; the future adapter must validate headers and normalize Retry-After to
milliseconds (including HTTP-date form against validated UTC). Borrowed body
pointers are consumed synchronously, never retained. Diagnostics are not exposed.

`NotificationRetryScheduler` uses unsigned monotonic elapsed-time comparisons,
supports rollover, and permits at most three consecutive automatic retries with
1/2/4-second base delays plus injected jitter in [0, base/4]. For 429, normalized
Retry-After is a lower bound. A 64-bit remaining delay, reduced by successive
unsigned monotonic elapsed deltas, preserves delays longer than a millis() wrap
without truncation. Call ready()/client tick() regularly, at least once per full
32-bit clock wrap, including during cancellation/expiry cooldowns. Manual start
and status cannot bypass an active cooldown. No wall-clock adjustment affects it.

The structured `complete()` overload schedules only transient failures. TLS
verification, authentication, validation, malformed and cancelled outcomes do
not retry automatically. Every retry obtains a fresh purpose-bound challenge;
an uncertain start retries status for the same pairing ID, never another start.
Cancellation changes generation and clears codes immediately; during a cooldown
remote cancellation waits for that cooldown. Cancellation before issuance and
expiry suppress queued work without shortening a pending cooldown. Successful
non-challenge structured responses reset the consecutive retry budget. Old
generation/ticket completions cannot alter it. `tick()` handles expiry while
waiting and never sleeps. Internal 15-second request timeouts and failed submit
calls remain fail-closed without automatic retry; an adapter may report typed
timeouts earlier within the request deadline. Legacy HTTP completion remains
available for existing mocks but does not automatically schedule retries.

Raw keys and records must never be logged or exposed through a status API. The
existing public status still contains only sanitized enums and flags. The new
modules are not instantiated by main.cpp, and there is no actual network or
persistent-storage implementation. Heap/stack/timing safety remains unverified
on hardware; compilation may discard unreferenced module code at link time.

## Step 4.3.20: mock coordination, UTC gate and HTTP parsing

`NotificationUtcClock` accepts explicitly injected UTC system seconds and
monotonic milliseconds. It does not read/modify RTC, SNTP or global system time.
Accepted UTC range is [2024-01-01, 2100-01-01); synchronization is fresh for less
than 24 hours. UTC is compared to its synchronized baseline plus accumulated
monotonic elapsed time, with five seconds allowed deviation. Invalid observations
or larger forward/backward jumps latch a fault. Recovery requires explicit reset
and a new caller-validated synchronization; normal sync calls cannot clear the
fault. A regular observation is required at least once per full millis() wrap.
Small drift does not renew synchronization freshness. Synchronization provenance
is supplied by the future runtime: a number alone cannot distinguish UTC from a
local wall-clock value or authenticate an SNTP source. Never pass RTC local time.

The production `NotificationPairingClient` constructor requires that clock gate.
Both challenge signing and subsequent operation signing check it. The original
two-argument constructor exists only under `HATCHAI_PAIRING_TEST` for unchanged
protocol/state fixtures. This does not make raw `sign()` a clock-aware API: it
remains a deterministic pure protocol helper. No runtime activates these modules.

`NotificationBackgroundTransport` is a serialized cooperative mock, not an actual
FreeRTOS task or thread-safe queue. It has one active and one pending request,
plus one completion slot. Envelopes are statically asserted trivially copyable;
only fixed arrays, scalar IDs and enums cross that boundary, never std::string,
object pointers or raw credentials. Wire method is always POST and path is bound
to operation. Request body limit is 2048 bytes, completion body 1024 bytes.
Only body/path/IDs needed for transport are copied; signing debug fields are not.

Call sample(now, systemUtc) before submitting from the client, and pump regularly.
The simulated absolute operation deadline is 12 seconds from enqueue, including
queue wait. pump() rechecks time before dispatch; receive()/failure() check IDs,
deadline and UTC before completing. Callbacks must promptly return, never re-enter
the coordinator, and implement mocked behavior only. A full completion slot
applies backpressure. Tickets must strictly increase across accepted requests and
generations may not decrease. abort(ticket) immediately clears matching pending,
active and completed data without requiring queue space. Active cancellation calls
the mock cancel callback. invalidateBefore(generation) additionally fences older
work for explicit expiry. Dropped/late completions cannot recreate aborted work.
No successful cloud cancellation is inferred from a local abort.

`parseNotificationHttp()` parses a single complete mocked HTTP response snapshot.
It allocates no dynamic strings. Status line + headers + final CRLF are limited
to 2048 bytes, body to 1024. Supported framing is HTTP/1.0 or HTTP/1.1 with exactly
one explicit Content-Length, an exact body byte count and no trailing response.
Interim 1xx responses, redirects as success, HTTP/2, obs-fold, invalid header names,
control/non-ASCII header bytes, duplicate Content-Length (even identical), any
Transfer-Encoding, close-delimited framing and compression except explicit
identity are rejected or classified non-success. Chunked framing is deliberately
unsupported, including otherwise valid chunks; it must be reviewed before live
Cloudflare integration if the server sends it. It never tries to guess framing.

Retry-After may occur once. Delta seconds must be unsigned decimal with checked
uint64 millisecond conversion. HTTP dates require validated UTC and strict IMF
fixdate with GMT, matching weekday, valid calendar/leap-year values, and years
1970–2099. Past dates produce zero delay; no shorter substitute is made for long
values. The coordinator passes normalized delay to the existing structured
result/retry path. Error bodies (429/auth/5xx etc.) are discarded; only HTTP 200
bodies enter internal completion envelopes for the client parser. Public status
still contains only sanitized enums/flags, never HTTP bytes, codes or credentials.

The test harness covers queue overflow, duplicates, active/full-queue cancellation,
generation fences, stale completions, queue/response timeout boundaries, UTC
freshness/jumps/rollover and signing gates, framing limits, HTTP errors, Retry-After,
and a client/coordinator cooldown-cancellation flow. It does not prove multicore
execution, streaming HTTP parsing, TLS verification or runtime memory safety.

## Step 4.3.21: bounded streaming and task ownership

This step supersedes the snapshot-only/chunked-rejection limits above.
`NotificationHttpStreamParser::feed()` accepts arbitrary fragmentation, returning
NeedMore/Complete/Failed. `end()` rejects premature EOF, and any nonempty feed after
completion fails and wipes accumulated response data. result() exposes no partial
response. The old parseNotificationHttp() function now wraps feed + EOF, preserving
the pairing client's existing interface. Reset/destruction wipe private buffers.

Framing is still explicit Content-Length or, for HTTP/1.1 only, exactly one
Transfer-Encoding: chunked. Content-Length plus transfer coding, duplicate framing,
coding lists and compression are rejected. Chunk sizes use checked hex arithmetic
against the remaining decoded-body budget. Chunk extensions support token names,
optional token/quoted-string values and quoted escapes; whitespace outside these
strict forms is rejected. No extension affects framing or authorization.

Fixed limits: initial headers 2048 bytes; decoded body 1024 bytes; chunk-size line
64 bytes including CRLF; 128 positive-size chunks; cumulative chunk metadata 1024
bytes (size lines, data CRLFs and trailers); total trailer section 256 bytes,
including its terminating CRLF. Only syntactically valid inert X-* extension
trailers are accepted. Framing/auth/content/Retry-After trailers cannot override
headers. The aggregate wire budget is 4096 bytes, independent of fragmentation.
All storage is fixed-size and no allocation depends on a peer length. Error bodies
are counted for framing but never stored. Retry-After headers retain existing
checked delta/date behavior. No close-delimited bodies, informational-response
chains or HTTP/2 are supported.

The coordinator now owns one persistent stream parser. receiveFragment() applies
the original generation/ticket/UTC/12-second absolute deadline checks on every
fragment. Partial progress never extends that deadline. A complete framed response
remains active until the mocked EOF event; extra bytes in a later fragment can
therefore invalidate it before any successful completion is published. The legacy
receive() call supplies one complete fragment with EOF. EOF is a mock transaction
boundary, not a claim that a future keep-alive TLS connection will close promptly.

`NotificationTaskOwnershipAdapter` contains the coordinator privately and exposes
separate producer and owner methods. claimOwner() binds one nonzero task identity
for its lifetime. All pump/feed/failure/cancel-I/O calls execute only through that
owner; an in-progress owner call rejects reentrant owner calls. Host tests inject
identity and mailbox guard implementations. ESP32 provides concrete wrappers for
xTaskGetCurrentTaskHandle() and a dedicated portMUX critical section. No actual
task, xQueue, TLS object, socket or synchronization with controller/SD code is
created. The two admitted fixed request records represent active reservation plus
pending work; a completion remains admitted until consumed. Admission is therefore
at most two request IDs across all mailbox/coordinator/completion states.

Producer submit(), abort() and take() touch only the dedicated guarded mailbox.
Only fixed-size trivially copyable envelopes are stored. Tickets strictly increase;
generations cannot decrease, and accepting a higher generation marks earlier work
cancelled. abort() marks cancellation even with full mailboxes, fences completion
delivery immediately, and the next ownerStep() stops mocked I/O and wipes buffers.
The physical stop is asynchronous; an already-running owner callback may finish,
but its cancelled result is discarded. No network callback runs while the mailbox
guard is held. No controller, SD or watchdog lock is used. Submit time is based on
the last ownerStep monotonic sample, conservatively including mailbox wait; sample
the owner immediately before admission in a future runtime.

ownerStop() must run in the claimed owner after producers quiesce and before
destruction. It permanently closes admission, aborts admitted work and clears
completions. Do not destroy a live adapter from a non-owner task, fake task identity,
share its clock unsafely across cores, throw from callbacks, or hold unrelated locks
when calling it. Real multicore/interrupt behavior remains unverified.

Resource review: parser resident size is statically capped at 3584 bytes and the
complete ownership adapter (including coordinator, parser, two admission records
and completion mailbox) at 16384 bytes on both builds. There is no module heap
allocation on feed/owner paths. Native tests report exact host sizeof values;
target ABI sizes can differ. Snapshot compatibility parsing places one parser on
the caller stack; streaming keeps it resident. Owner steps use a roughly 2.1-KiB
request temporary and roughly 1.1-KiB completion temporaries; compiler-generated
reset/copy frames add stack use. Reserve at least 8 KiB for a mock owner task and
measure its high-water mark; the earlier provisional 16-KiB networking stack must
be reassessed with real TLS. Critical sections copy/clear bounded payloads, but
their target duration, cache contention and control-loop jitter are not measured.
Do not place the full adapter on the existing loop-task stack. No task priority,
affinity, control-loop timing, GPIO, logging or watchdog behavior is changed here.

## Next approval boundary

Add a reviewed credential-store adapter and bounded real transport only in a later
step. Then review task ownership, ESP32 heap/stack budgets, absolute DNS/TLS/read
deadlines, session checks and private LCD integration. Build success and host mocks
do not establish physical safety or live cloud connectivity. No deployment,
provisioning, flashing, real cloud request, Firebase or camera change is authorized
by running these tests.
