-- Additive only. push_tokens must already exist; never recreate or rewrite it.
CREATE TABLE pairing_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  device_id TEXT NOT NULL,
  device_key_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'challenge' CHECK(state IN
    ('challenge','issued','redeemed','registered','cancelled','expired')),
  device_challenge TEXT NOT NULL UNIQUE,
  challenge_expires_at INTEGER NOT NULL,
  code_hash TEXT UNIQUE,
  code_issued_at INTEGER,
  code_expires_at INTEGER,
  browser_public_key_jwk TEXT,
  grant_hash TEXT UNIQUE,
  grant_expires_at INTEGER,
  registration_attempt_id TEXT UNIQUE,
  redeemed_at INTEGER,
  registered_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(challenge_expires_at > created_at),
  CHECK((code_issued_at IS NULL AND code_expires_at IS NULL) OR
    (code_issued_at IS NOT NULL AND code_expires_at = code_issued_at + 300)),
  CHECK(browser_public_key_jwk IS NULL OR json_valid(browser_public_key_jwk)),
  CHECK(state <> 'issued' OR (code_hash IS NOT NULL AND code_expires_at IS NOT NULL)),
  CHECK(state <> 'redeemed' OR (browser_public_key_jwk IS NOT NULL AND
    grant_hash IS NOT NULL AND grant_expires_at IS NOT NULL AND redeemed_at IS NOT NULL)),
  CHECK(state <> 'registered' OR (registered_at IS NOT NULL AND registration_attempt_id IS NOT NULL))
);
CREATE INDEX pairing_sessions_device_created ON pairing_sessions(device_id,created_at);
CREATE INDEX pairing_sessions_state_expiry ON pairing_sessions(state,code_expires_at);
CREATE UNIQUE INDEX pairing_sessions_one_active_device ON pairing_sessions(device_id)
  WHERE state IN ('issued','redeemed');

CREATE TABLE push_registration_auth (
  registration_id TEXT PRIMARY KEY NOT NULL REFERENCES push_tokens(id) ON DELETE RESTRICT,
  pairing_session_id TEXT UNIQUE REFERENCES pairing_sessions(id) ON DELETE SET NULL,
  device_id TEXT NOT NULL,
  device_key_id TEXT NOT NULL,
  browser_public_key_jwk TEXT NOT NULL CHECK(json_valid(browser_public_key_jwk)),
  request_nonce TEXT NOT NULL UNIQUE,
  nonce_expires_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 0 CHECK(version >= 0),
  authorized_until INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(authorized_until > created_at)
);
CREATE INDEX push_registration_auth_device ON push_registration_auth(device_id);
CREATE INDEX push_registration_auth_expiry ON push_registration_auth(authorized_until);
