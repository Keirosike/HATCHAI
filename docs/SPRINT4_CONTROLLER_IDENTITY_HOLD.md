# Controller identity HOLD

Expected MAC b0:3f:d3:5b:8a:88 is based on earlier operator hardware output, retained backup names in historical documentation, and the reviewed provisioning identity. It is pinned in tools/device-provisioner/boards.json, provision.py and main/transaction.h, as well as the reviewed controller RAM manifest. These are historical evidence, not discovery of the presently attached board.

Operator now reports COM3 ESP32-D0WD-V3 revision 3.1 with MAC b0:3f:d3:5b:61:34. No physical query was performed during this investigation. The earlier diagnostic stopped at board_identity, before snapshots or RAM transfer. No expected MAC was changed.

Source findings: CloudSync uses logical hatchai-inc01-controller plus key ID/key, not a hardware MAC. The prepared hatchai_sync_devices schema has no MAC column; its logical controller/incubator relation does not establish hardware identity. Identical chip model/revision does not distinguish boards. The newly reported MAC was not found in searched project configuration/history files. Earlier encrypted backups must not be applied to this newly reported MAC.

Conclusion: different reported hardware identity; whether the expected board assignment is outdated or COM3 belongs to another/spare board remains unverified. Do not bypass the check or change keys/registry to compensate.

Next operator check, no serial/RAM activity: trace the USB cable physically to the ESP32 wired to the incubator LCD, DHT22 and relay signals. With loads still isolated, identify whether that same board was replaced since the earlier successful diagnostic. Confirm which physical controller serves the working local dashboard. COM numbers can change and a dashboard logical ID alone cannot identify the chip. If both boards exist, label them separately. If the operator confirms the active wired controller is the 61:34 board, obtain explicit approval to update that board assignment and rebuild/review the MAC-bound RAM image; leave camera identities and cloud logical IDs unchanged. Do not migrate NVS or backups between boards automatically.

Added an offline regression ensuring the reported mismatching controller MAC is rejected before serial imports/access. No production records, credentials, RAM agents or application firmware changed during this investigation.


Operator subsequently confirmed the 61:34 board is the main controller and requested deployment. Local host/agent identity updated accordingly. Historical 8a:88 backups and retired tools remain unchanged. New physical execution approval must name the current board/MAC and confirm safe isolation; prior failed COM3 attempt is not a successful diagnostic.
