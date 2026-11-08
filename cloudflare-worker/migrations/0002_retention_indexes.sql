-- Additive indexes only. No existing token rows or authorization rows are changed.
CREATE INDEX pairing_cleanup_terminal ON pairing_sessions(state,updated_at);
CREATE INDEX pairing_cleanup_challenge ON pairing_sessions(challenge_expires_at) WHERE state='challenge';
CREATE INDEX pairing_cleanup_grant ON pairing_sessions(grant_expires_at) WHERE state='redeemed';
CREATE INDEX pairing_cleanup_registered ON pairing_sessions(registered_at) WHERE state='registered';
CREATE INDEX registration_cleanup_nonce ON push_registration_auth(nonce_expires_at);
