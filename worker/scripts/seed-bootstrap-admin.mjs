#!/usr/bin/env node
/**
 * Bootstrap admin seed.
 *
 * Creates the platform-owner admin user with a fresh cryptographically
 * random password, hashed via bcryptjs at 12 rounds (matching
 * worker/src/lib/password.ts ROUNDS — the cost the app verifies against).
 *
 * Targets:
 *   - no --env        -> LOCAL dev D1 (`bussey-bussey` --local). Unchanged
 *                        from the original v1 behavior; this is what
 *                        `pnpm --filter @bussey/worker seed:bootstrap-admin`
 *                        runs.
 *   - --env staging   -> REMOTE staging D1 (name resolved from wrangler.toml)
 *   - --env production-> REMOTE production D1 (name resolved from wrangler.toml)
 *
 * Idempotent: if an admin_user with the target email already EXISTS in the
 * target environment, the script makes no changes, generates no password,
 * and says so. It never overwrites or rotates an existing admin's password.
 * (INSERT OR IGNORE on admin_user.email UNIQUE is a second backstop.)
 *
 * The plaintext password is printed exactly once, to stdout, at the end of
 * a successful run. It is NEVER:
 *   - written to a file (the temp SQL file holds only the bcrypt HASH)
 *   - logged elsewhere
 *   - committed to git (this source contains only email/name, not the password)
 *   - inserted into audit_log
 *
 * Inspect mode (--dry-run): prints the resolved target + the exact SQL
 * column shape it WOULD run, without contacting wrangler, without
 * generating a password, and without any remote write. Use this to verify
 * the target/columns before doing the real remote seed.
 *
 * Usage:
 *   node scripts/seed-bootstrap-admin.mjs                         # local dev
 *   node scripts/seed-bootstrap-admin.mjs --env staging           # remote staging
 *   node scripts/seed-bootstrap-admin.mjs --env production        # remote production
 *   node scripts/seed-bootstrap-admin.mjs --env staging --dry-run # inspect only
 *   ... [--name "Full Name"] [--email someone@example.com]
 *
 * via pnpm: pnpm --filter @bussey/worker seed:bootstrap-admin -- --env staging
 */

import { execFileSync } from 'node:child_process';
import { randomUUID, randomInt } from 'node:crypto';
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import bcrypt from 'bcryptjs';

// ─── Defaults (overridable via flags) ───────────────────────────────
const DEFAULT_EMAIL = 'mrmicaiah@gmail.com';
const DEFAULT_NAME = 'Micaiah Bussey';
const ROLE = 'owner';
const PASSWORD_LENGTH = 24;

/** bcrypt cost factor — matches worker/src/lib/password.ts (locked at 12). */
const BCRYPT_ROUNDS = 12;

/** URL-safe-ish alphabet, with visually ambiguous chars (0,1,O,I,l) removed. */
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

const LOCAL_DB_NAME = 'bussey-bussey';

// ─── Arg parsing ────────────────────────────────────────────────────
const argv = process.argv.slice(2);

/** Supports `--flag value` and `--flag=value`. */
function getFlag(name) {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const idx = argv.indexOf(`--${name}`);
  if (idx !== -1 && argv[idx + 1] && !argv[idx + 1].startsWith('--')) return argv[idx + 1];
  return undefined;
}

const DRY_RUN = argv.includes('--dry-run');
const ENV = getFlag('env') ?? null; // null => local dev (backward-compatible)
const EMAIL = getFlag('email') ?? DEFAULT_EMAIL;
const NAME = getFlag('name') ?? DEFAULT_NAME;

if (ENV !== null && ENV !== 'staging' && ENV !== 'production') {
  console.error(`Invalid --env "${ENV}". Use "staging", "production", or omit for local dev.`);
  process.exit(1);
}

// ─── Target resolution (which D1, local vs remote) ──────────────────

/**
 * Read worker/wrangler.toml and return the `database_name` declared under
 * the given environment's `[[env.<env>.d1_databases]]` block. Keeps the
 * remote DB names single-sourced in wrangler.toml rather than duplicated
 * here.
 */
function resolveRemoteDbName(env) {
  const tomlPath = fileURLToPath(new URL('../wrangler.toml', import.meta.url));
  const lines = readFileSync(tomlPath, 'utf8').split('\n');
  const header = `[[env.${env}.d1_databases]]`;
  let i = lines.findIndex((l) => l.trim() === header);
  if (i === -1) {
    throw new Error(`Could not find ${header} in wrangler.toml`);
  }
  for (i += 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith('[')) break; // hit the next section before finding it
    const m = t.match(/^database_name\s*=\s*"([^"]+)"/);
    if (m) return m[1];
  }
  throw new Error(`No database_name under ${header} in wrangler.toml`);
}

const TARGET =
  ENV === null
    ? { dbName: LOCAL_DB_NAME, locationFlags: ['--local'], label: 'LOCAL dev' }
    : { dbName: resolveRemoteDbName(ENV), locationFlags: ['--env', ENV, '--remote'], label: `REMOTE ${ENV}` };

// ─── wrangler wrappers ──────────────────────────────────────────────
function runWranglerJson(sqlCommand) {
  const stdout = execFileSync(
    'pnpm',
    ['exec', 'wrangler', 'd1', 'execute', TARGET.dbName, ...TARGET.locationFlags, '--json', '--command', sqlCommand],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
  return JSON.parse(stdout);
}

function runWranglerFile(sqlPath) {
  execFileSync(
    'pnpm',
    ['exec', 'wrangler', 'd1', 'execute', TARGET.dbName, ...TARGET.locationFlags, `--file=${sqlPath}`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
}

function sqlStringLiteral(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

// admin_user columns the INSERT supplies. created_at is filled by the
// column DEFAULT (ISO8601), last_login_at stays NULL. (Schema: migration
// 0001 — id, name, email, password_hash, role, active, created_at,
// last_login_at.)
const INSERT_COLUMNS = 'id, name, email, password_hash, role, active';

function buildInsertSql({ id, name, email, hash }) {
  return (
    `INSERT OR IGNORE INTO admin_user (${INSERT_COLUMNS}) VALUES (` +
    `${sqlStringLiteral(id)}, ${sqlStringLiteral(name)}, ${sqlStringLiteral(email)}, ` +
    `${sqlStringLiteral(hash)}, ${sqlStringLiteral(ROLE)}, 1);\n`
  );
}

const CHECK_SQL = `SELECT COUNT(*) AS n FROM admin_user WHERE email = ${sqlStringLiteral(EMAIL)};`;

// ─── Inspect mode (no wrangler, no password, no write) ──────────────
function printDryRun() {
  const bar = '─'.repeat(64);
  console.log('');
  console.log(bar);
  console.log('  DRY RUN — inspect only. No wrangler call, no password, no write.');
  console.log(bar);
  console.log('');
  console.log(`  Target:     ${TARGET.label}`);
  console.log(`  Database:   ${TARGET.dbName}`);
  console.log(`  Location:   wrangler d1 execute ${TARGET.dbName} ${TARGET.locationFlags.join(' ')}`);
  console.log(`  Email:      ${EMAIL}`);
  console.log(`  Name:       ${NAME}`);
  console.log(`  Role:       ${ROLE}`);
  console.log('');
  console.log('  1) Idempotency check it WOULD run:');
  console.log(`       ${CHECK_SQL}`);
  console.log('');
  console.log('  2) If absent, the INSERT it WOULD run (values illustrative):');
  console.log(
    '       ' +
      buildInsertSql({
        id: '<fresh-uuid>',
        name: NAME,
        email: EMAIL,
        hash: '<bcrypt-12-hash-of-random-password>',
      }).trim(),
  );
  console.log('');
  console.log('     created_at  -> filled by column DEFAULT (ISO8601)');
  console.log('     last_login_at -> NULL');
  console.log('');
  console.log('  No password was generated. Re-run without --dry-run to seed for real.');
  console.log(bar);
  console.log('');
}

// ─── Real seed ──────────────────────────────────────────────────────
function generatePassword(length) {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  }
  return out;
}

async function seed() {
  // 1. Idempotency check against the TARGET environment.
  const checkRows = runWranglerJson(CHECK_SQL);
  const count =
    Array.isArray(checkRows) && checkRows[0]?.results?.[0]?.n !== undefined
      ? Number(checkRows[0].results[0].n)
      : 0;

  if (count > 0) {
    console.log(
      `\nAdmin user ${EMAIL} already exists in ${TARGET.label} (${TARGET.dbName}). ` +
        `No changes made (idempotent no-op). Password NOT rotated.\n`,
    );
    return;
  }

  // 2. Generate password + hash + id (only after confirming none exists).
  const password = generatePassword(PASSWORD_LENGTH);
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const id = randomUUID();

  // 3. Insert via a temp SQL file (avoids any shell escaping for the hash).
  const dir = mkdtempSync(join(tmpdir(), 'bussey-seed-'));
  const sqlPath = join(dir, 'insert.sql');
  writeFileSync(sqlPath, buildInsertSql({ id, name: NAME, email: EMAIL, hash }), { mode: 0o600 });

  try {
    runWranglerFile(sqlPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // 4. Verify the row landed in the target environment.
  const verifyRows = runWranglerJson(
    `SELECT id, email, role FROM admin_user WHERE email = ${sqlStringLiteral(EMAIL)};`,
  );
  const row = Array.isArray(verifyRows) ? verifyRows[0]?.results?.[0] : null;
  if (!row) {
    throw new Error('Bootstrap admin verification failed — no row found after INSERT.');
  }

  // 5. Print credentials, exactly once.
  const bar = '━'.repeat(64);
  console.log('');
  console.log(bar);
  console.log('  BOOTSTRAP ADMIN CREATED — SAVE THIS PASSWORD NOW (shown once)');
  console.log(bar);
  console.log('');
  console.log(`  Environment: ${TARGET.label} (${TARGET.dbName})`);
  console.log(`  Email:       ${EMAIL}`);
  console.log(`  Name:        ${NAME}`);
  console.log(`  Role:        ${ROLE}`);
  console.log(`  User ID:     ${row.id}`);
  console.log(`  Password:    ${password}`);
  console.log('');
  console.log('  This password will NOT be displayed again. Store it now.');
  console.log(bar);
  console.log('');
}

async function main() {
  if (DRY_RUN) {
    printDryRun();
    return;
  }
  await seed();
}

main().catch((err) => {
  console.error('Bootstrap admin script failed:');
  console.error(err);
  process.exit(1);
});
