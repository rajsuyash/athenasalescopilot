#!/usr/bin/env node
/**
 * Backfill knowledge_chunks.embedding for rows where embedding IS NULL.
 *
 * Runs at api startup AFTER apply-manual-migrations.mjs. Idempotent: only
 * touches rows with NULL embeddings. Skips gracefully if OPENAI_API_KEY
 * is not set (workspace will still function with degraded retrieval — see
 * coach.ts askNext fallback).
 *
 * Why this exists: `prisma db push --accept-data-loss` was dropping the
 * pgvector embedding column on every redeploy because schema.prisma did
 * not declare it. We've now declared it as Unsupported("vector(256)") so
 * the column survives db push, but the historical rows still have NULL
 * embeddings from the previous bug. This script is the one-shot recovery.
 *
 * Env: DATABASE_URL (required), OPENAI_API_KEY (required to embed),
 *      EMBEDDING_DIMENSION (default 256), EMBEDDING_MODEL (default text-embedding-3-small)
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Client } = require('pg');

const MODEL = process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small';
const DIM = Number(process.env.EMBEDDING_DIMENSION ?? 256);
const BATCH = 16;

async function embed(texts) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL, input: texts, dimensions: DIM }),
  });
  if (!res.ok) {
    throw new Error(`openai ${res.status}: ${await res.text()}`);
  }
  const body = await res.json();
  return body.data.map((d) => d.embedding);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('[backfill-embeddings] DATABASE_URL not set, skipping');
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    console.warn('[backfill-embeddings] OPENAI_API_KEY not set, skipping');
    return;
  }
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const { rows: pending } = await c.query(
    `SELECT id, chunk_text FROM knowledge_chunks WHERE embedding IS NULL ORDER BY id`,
  );
  if (pending.length === 0) {
    console.log('[backfill-embeddings] no rows to backfill');
    await c.end();
    return;
  }
  console.log(`[backfill-embeddings] backfilling ${pending.length} chunks (model=${MODEL} dim=${DIM})`);

  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    const texts = batch.map((r) => r.chunk_text);
    let vectors;
    try {
      vectors = await embed(texts);
    } catch (err) {
      console.error(`[backfill-embeddings] embed failed at batch ${i}: ${err.message}`);
      throw err;
    }
    for (let j = 0; j < batch.length; j++) {
      const literal = `[${vectors[j].join(',')}]`;
      await c.query(
        `UPDATE knowledge_chunks SET embedding = $1::vector WHERE id = $2::uuid`,
        [literal, batch[j].id],
      );
    }
    console.log(`[backfill-embeddings] +${batch.length} (total ${Math.min(i + batch.length, pending.length)}/${pending.length})`);
  }

  await c.end();
  console.log('[backfill-embeddings] done');
}

main().catch((err) => {
  console.error('[backfill-embeddings] fatal', err);
  process.exit(1);
});
