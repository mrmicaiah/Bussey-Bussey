#!/usr/bin/env node
/**
 * Bootstrap admin seed.
 *
 * One-time use: creates the platform-owner admin user with a fresh
 * cryptographically random password, hashed via bcryptjs at 12 rounds.
 *
 * Idempotent: re-running with an existing email is a no-op
 * (INSERT OR IGNORE keys on admin_user.email UNIQUE).
 *
 * The plaintext password is printed exactly once, to stdout, at the end
 * of a successful run. It is NEVER:
 *   - written to a file
 *   - logged elsewhere
 *   - committed to git (this source contains only email/name, not the password)
 *   - inserted into audit_log
 *
 * v1 BOOTSTRAP — see notes/deferred-cleanup.md. Replace with a proper CLI
 * admin creation flow (interactive prompt, --remote support, audit_log row,
 * tested via the actual API once auth is up) before a second admin user
 * is needed.
 *
 * Run: pnpm --filter @bussey/worker seed:bootstrap-admin
 */

import { execFileSync } from 'node:child_process';
import { randomUUID, randomInt } from 'node:crypto';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import bcrypt from 'bcryptjs';

const EMAIL = 'mrmicaiah@gmail.com';
const NAME = 'Micaiah Busssey';
const ROLE = 'owner';
const PASSWORD_LENGTH = 24;

/** URL-safe-ish alphabet, with visually ambiguous chars (0,1,O,I,l) removed. */
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function generatePassword(length) {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  }
  return out;
}

function runWranglerJson(sqlCommand) {
  const stdout = execFileSync(
    'pnpm',
    ['exec', 'wrangler', 'd1', 'execute', 'bussey-bussey', '--local', '--json', '--command', sqlCommand],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
  return JSON.parse(stdout);
}

function runWranglerFile(sqlPath) {
  execFileSync(
    'pnpm',
    ['exec', 'wrangler', 'd1', 'execute', 'bussey-bussey', '--local', `--file=${sqlPath}`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
}

function sqlStringLiteral(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

async function main() {
  // 1. Idempotency check
  const checkRows = runWranglerJson(
    `SELECT COUNT(*) AS n FROM admin_user WHERE email = ${sqlStringLiteral(EMAIL)};`,
  );
  const count =
    Array.isArray(checkRows) && checkRows[0]?.results?.[0]?.n !== undefined
      ? Number(checkRows[0].results[0].n)
      : 0;

  if (count > 0) {
    console.log(`\nAdmin user ${EMAIL} already exists. No changes made (idempotent no-op).\n`);
    return;
  }

  // 2. Generate password + hash
  const password = generatePassword(PASSWORD_LENGTH);
  const hash = await bcrypt.hash(password, 12);
  const id = randomUUID();

  // 3. Insert via a temp SQL file (avoids any shell escaping for the bcrypt hash)
  const dir = mkdtempSync(join(tmpdir(), 'bussey-seed-'));
  const sqlPath = join(dir, 'insert.sql');
  const sql =
    `INSERT OR IGNORE INTO admin_user (id, name, email, password_hash, role, active) VALUES (` +
    `${sqlStringLiteral(id)}, ${sqlStringLiteral(NAME)}, ${sqlStringLiteral(EMAIL)}, ` +
    `${sqlStringLiteral(hash)}, ${sqlStringLiteral(ROLE)}, 1);\n`;
  writeFileSync(sqlPath, sql, { mode: 0o600 });

  try {
    runWranglerFile(sqlPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // 4. Verify
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
  console.log('  BOOTSTRAP ADMIN CREATED — SAVE THESE CREDENTIALS NOW');
  console.log(bar);
  console.log('');
  console.log(`  Email:    ${EMAIL}`);
  console.log(`  Name:     ${NAME}`);
  console.log(`  Role:     ${ROLE}`);
  console.log(`  User ID:  ${row.id}`);
  console.log(`  Password: ${password}`);
  console.log('');
  console.log('  This password will NOT be displayed again. Store it now.');
  console.log('  v1 bootstrap — see notes/deferred-cleanup.md.');
  console.log(bar);
  console.log('');
}

main().catch((err) => {
  console.error('Bootstrap admin script failed:');
  console.error(err);
  process.exit(1);
});
