# DHT22, relay protection and LCD labels — local changes

## Latest approved transient-read policy

A missed DHT22 frame no longer stops an already-ON heater immediately when a
previously qualified valid sample is still younger than 20 seconds. Failed
attempts do not renew that timestamp. At exactly 20 seconds since the last valid
sample the relay switches OFF, regardless of dwell timers. With no valid history
or incomplete startup qualification it remains OFF. During a failed-read hold,
no new ON transition is allowed. Manual OFF, storage/watchdog faults, known hot
values and temperature latches still override immediately. A recovered valid
sample before expiry resumes normal regulation; after expiry three qualified
samples are required again. Automatic restart timing still applies.

This bounded blind interval is an intentional user-requested policy change, not
a repair of a defective sensor. The existing heater-status field reports a brief
DHT22 hold; physical timing and overshoot remain unverified. No upload performed.

The DHT22 driver accepts an already-LOW response at release and decodes the data
from bounded HIGH-pulse durations. Ambiguous timing, checksum errors and invalid
ranges still fail closed. Failures now distinguish timing from checksum/range.
This improves software handling; it cannot establish the physical cause of the
reported intermittent failures. The 1.1 ms start pulse now uses a bounded
microsecond delay instead of a scheduler-tick delay. Check GPIO4 pull-up, supply, common ground and
relay interference during supervised physical testing.

Automatic heater energizations are separated by at least 30 seconds, including
recovery after faults. Existing minimum OFF time is also enforced in Automatic.
Manual ON/OFF follows the button immediately without PID intervals; sensor and
temperature protections still override ON. Avoid repeatedly toggling manually.
The start-spacing timer survives runtime PID resets; it restarts on MCU reboot.
Warm-up remains continuous after qualification until the target is reached. Safety
OFF and explicit Manual OFF remain immediate, even during a minimum ON interval.
No software can guarantee relay life: use the correct load rating, driver,
coil suppression and independent thermal protection for the actual equipment.

Batch metadata updates now match the durable controller assignment, rather than
requiring the recovery metadata to already contain its ID. This repairs the case
where a label save was acknowledged without updating a profile-backed batch.
No motor schedule, batch start date or assignment is invented. Once the updated
firmware is installed, edit/save the existing batch on the local Batch page to
resend its real label and name. Confirm a roller assignment and device-save
acknowledgement; a browser-only Active record is not automatically an LCD batch.
SD persistence still requires healthy recovery/logging. Do not delete/recreate
the batch just to repair its label.

Wiring remains heater GPIO14 active-low, passive buzzer GPIO27, DHT22 GPIO4,
direct-powered fan and lower/upper rollers GPIO25/GPIO26. No upload, actuator
test, cloud deployment or live notification is authorized by these changes.
