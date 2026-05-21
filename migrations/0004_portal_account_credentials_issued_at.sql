-- Migration 0004 — portal_account.credentials_issued_at
--
-- Added during step I to support the 24-hour credentials re-display window
-- (spec 07 "Re-display window" + step I subtask 6).
--
-- When an opportunity is activated, the system generates a one-time temp
-- password, returns it to the admin once, and stores only its bcrypt hash
-- in portal_account.password_hash. For 24 hours after issuance the admin
-- can re-open the credentials handoff modal on the opportunity page to
-- recover the plaintext (cached out-of-band — not in this column). After
-- 24 hours the re-display link flips to "Reset password and share new
-- credentials," which generates a fresh temp password, bumps this
-- timestamp, and invalidates the old plaintext cache.
--
-- credentials_issued_at is the single source of truth for the window:
-- the server compares it to now() on every re-display request. It's
-- updated whenever a temp password is (re-)issued — initial activation
-- AND any subsequent admin-initiated reset.
--
-- SQLite's ALTER TABLE ADD COLUMN doesn't accept strftime() defaults, so
-- the column is nullable and the service layer writes an explicit value
-- on every (re-)issuance. Existing rows (none expected at step I, but
-- safe regardless) are backfilled from created_at — for any portal
-- account that already exists, treating account creation as the original
-- issuance is the correct semantic.

ALTER TABLE portal_account ADD COLUMN credentials_issued_at TEXT;
UPDATE portal_account SET credentials_issued_at = created_at WHERE credentials_issued_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_portal_account_credentials_issued_at ON portal_account(credentials_issued_at);
