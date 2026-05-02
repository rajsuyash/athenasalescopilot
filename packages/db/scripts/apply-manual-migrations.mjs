#!/usr/bin/env node
/**
 * Apply hand-written SQL migrations after `prisma migrate deploy`.
 *
 * Prisma's vector + extension support is incomplete, so we keep these
 * outside the standard migration history. Idempotent (every statement
 * uses `IF NOT EXISTS` or is wrapped in a guard) so safe to run on every
 * deploy.
 *
 * Usage: node packages/db/scripts/apply-manual-migrations.mjs
 * Env:   DATABASE_URL (required)
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
// Use the pg client that ships transitively via Prisma. If unavailable,
// install via `pnpm --filter @athena/db add pg`.
const { Client } = require('pg');

const MANUAL_DIR = join(__dirname, '..', 'prisma', 'migrations', 'manual');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('[manual-migrate] DATABASE_URL not set, skipping');
    process.exit(0);
  }
  const files = (await readdir(MANUAL_DIR)).filter((f) => f.endsWith('.sql')).sort();
  if (files.length === 0) {
    console.log('[manual-migrate] no manual SQL files found');
    return;
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log(`[manual-migrate] applying ${files.length} files`);
  for (const f of files) {
    const sql = await readFile(join(MANUAL_DIR, f), 'utf8');
    console.log(`[manual-migrate] → ${f}`);
    try {
      await client.query(sql);
    } catch (err) {
      console.error(`[manual-migrate] FAILED ${f}: ${err.message}`);
      throw err;
    }
  }
  await client.end();
  console.log('[manual-migrate] done');
}

main().catch((err) => {
  console.error('[manual-migrate] fatal', err);
  process.exit(1);
});
