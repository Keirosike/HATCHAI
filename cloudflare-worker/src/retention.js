// No token or ownership records are deleted. A registered pairing remains linked
// throughout its full 90-day authorization plus a seven-day recovery margin.
// Each invocation is bounded; configured cron runs every minute.
export const CLEANUP_BATCH = 250;
export const CLEANUP_ROUNDS = 4;
export async function cleanup(env) {
  const totals = { expired: 0, deleted: 0, retiredNonces: 0 };
  for (let round = 0; round < CLEANUP_ROUNDS; round++) {
    const results = await env.DB.batch([
      env.DB.prepare(`UPDATE pairing_sessions SET state='expired',code_hash=NULL,
        grant_hash=NULL,updated_at=unixepoch() WHERE id IN (
          SELECT id FROM pairing_sessions WHERE
          (state='challenge' AND challenge_expires_at<=unixepoch()) OR
          (state='issued' AND code_expires_at<=unixepoch()) OR
          (state='redeemed' AND grant_expires_at<=unixepoch()) LIMIT 250)`),
      env.DB.prepare(`DELETE FROM pairing_sessions WHERE id IN (
        SELECT id FROM pairing_sessions WHERE
          (state IN ('expired','cancelled') AND updated_at<=unixepoch()-86400) OR
          (state='registered' AND registered_at<=unixepoch()-8380800 AND NOT EXISTS (
            SELECT 1 FROM push_registration_auth a WHERE a.pairing_session_id=pairing_sessions.id
            AND a.revoked_at IS NULL AND a.authorized_until>unixepoch()))
        LIMIT 250)`),
      env.DB.prepare(`UPDATE push_registration_auth SET
        request_nonce='retired:'||registration_id||':'||version,
        nonce_expires_at=0,version=version+1 WHERE registration_id IN (
          SELECT registration_id FROM push_registration_auth WHERE nonce_expires_at>0
          AND (nonce_expires_at<=unixepoch() OR authorized_until<=unixepoch() OR revoked_at IS NOT NULL)
          LIMIT 250)`)
    ]);
    const counts = results.map(r => Number(r.meta?.changes || 0));
    totals.expired += counts[0]; totals.deleted += counts[1]; totals.retiredNonces += counts[2];
    if (counts.every(n => n < CLEANUP_BATCH)) break;
  }
  return { ...totals, backlogPossible: Object.values(totals).some(n => n >= CLEANUP_BATCH * CLEANUP_ROUNDS) };
}
