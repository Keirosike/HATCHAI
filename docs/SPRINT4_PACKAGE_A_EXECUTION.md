# Package A execution checklist — no operation performed

1. Obtain explicit Package A approval. Earlier approval for schema migrations does not authorize registry inserts.
2. Use the verified Supabase project dihufafcztqjuudjeqdm and postgres role. Incubator UUID: 87ce3cf3-a455-4bc3-a7bb-049882d985fa.
3. Run SELECT device_id,incubator_id,key_id,role,position,enabled FROM public.hatchai_sync_devices ORDER BY device_id; and review existing rows. Stop on any conflict.
4. Recheck SHA-256 of supabase/sprint4_registry_REVIEW.sql: 3723BB3C8E1E8A9FB7AEFBB79FBF69D0D7E4A8917088E9ACDC3AB0A6CC5B0A97.
5. Execute that complete reviewed transaction only. It refuses replacement and mapping drift, locks the registry and verified incubator, and inserts controller-sync-v1, upper-camera-v1, lower-camera-v1 identities with enabled=false. No secrets are stored.
6. Run the same SELECT. Expect exactly three approved rows for this incubator: controller with position NULL; cam01 upper; cam02 lower; all disabled. Export metadata only.
7. Stop on errors. Do not rerun successful INSERTs, enable rows, alter keys or delete referenced identities. No Package B/C operation is implied.

Retain disabled entries as safe rollback; no ingestion is enabled. Supabase execution is not available from this session and requires the approved SQL Editor/secure management connection.
