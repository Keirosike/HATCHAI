# Sprint 4 private camera Storage — approval draft

No bucket, policy, secret, registry row or deployment has been changed by this document.

## Database gate

User reports migrations 003, 004 and 005 executed. Installation is not independently verified yet. Run each SELECT in supabase/verify_sprint3_REST_READ_ONLY.sql separately and export the first three results. Expect seven tables owned by postgres, RLS enabled and forced, all three direct-access columns false; 13 unique new functions owned by postgres with SECURITY DEFINER, fixed pg_catalog search_path, browser/anon EXECUTE false and service_role EXECUTE true; all indexes valid. Stop if any differ.

## Proposed bucket configuration

Proposed new bucket ID: hatchai-camera-captures (a proposal, not an existing resource).
Public: false. File size limit: 131072 bytes. Allowed MIME types: image/jpeg only.
Create through Supabase Storage's supported dashboard/API, not direct writes to storage metadata tables. No browser Storage policies are needed: the existing Worker uses its backend credential, checks incubator ownership, and proxies authorized image bytes. Do not create broad authenticated SELECT or INSERT policies.

Before approval, confirm the proposed bucket ID. After separately approved creation, run the two Storage metadata SELECTs in the verification file separately. Verify the exact bucket ID, private flag, size and MIME restrictions, and review every storage.objects policy. Empty policies are expected for this backend-only design. Never set CAMERA_CAPTURE_STORAGE_REVIEWED true on bucket privacy alone.

## Later Worker configuration — separate approval required

CAMERA_CAPTURE_BUCKET=hatchai-camera-captures only if that exact bucket is approved and created.
Keep CAMERA_CAPTURE_STORAGE_REVIEWED=false, CAMERA_CAPTURES_ENABLED=false, CAMERA_EVENTS_ENABLED=false and TELEMETRY_ENABLED=false until their respective gates pass. Preserve existing native push settings and secrets. No device keys are generated here.

## Validation and recovery

Local tests cover immutable uploads, duplicate reconciliation, bounded JPEGs, ownership denial and interrupted-upload cleanup. Actual Storage integration still requires supervised production verification. Do not claim camera uploads from unit tests.
If a problem occurs, keep capture ingestion disabled and preserve metadata and objects. Do not delete a populated bucket as rollback. Registry credentials, Worker deployment, Hosting deployment, device provisioning and flashing remain separately gated.
