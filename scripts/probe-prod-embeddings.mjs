#!/usr/bin/env node
/**
 * Probe Railway Postgres to see embedding state. Reads DATABASE_URL from env.
 * Usage: DATABASE_URL=postgresql://... node scripts/probe-prod-embeddings.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Client } = require('pg');

const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const docs = await c.query('SELECT COUNT(*)::int AS n FROM knowledge_documents');
console.log('documents:', docs.rows[0].n);

const chunks = await c.query('SELECT COUNT(*)::int AS n FROM knowledge_chunks');
console.log('chunks total:', chunks.rows[0].n);

const active = await c.query('SELECT COUNT(*)::int AS n FROM knowledge_chunks WHERE active = true');
console.log('chunks active:', active.rows[0].n);

const withEmbed = await c.query('SELECT COUNT(*)::int AS n FROM knowledge_chunks WHERE embedding IS NOT NULL');
console.log('chunks with embedding:', withEmbed.rows[0].n);

// Sample a chunk to see embedding shape
const sample = await c.query("SELECT id, length(chunk_text) AS textlen, (embedding::text)[1:60] AS embed_head FROM knowledge_chunks LIMIT 3");
console.log('\nsamples:');
for (const r of sample.rows) {
  console.log(`  ${r.id}: textlen=${r.textlen} embed_head=${r.embed_head}`);
}

// Probe a simple cosine query
console.log('\nprobe cosine sim (using all-zero query vec; expect ~0):');
const zeroVec = '[' + '0,'.repeat(255) + '0]';
try {
  const probe = await c.query(`
    SELECT id, 1 - (embedding <=> $1::vector) AS score
    FROM knowledge_chunks
    WHERE active = true AND embedding IS NOT NULL
    ORDER BY embedding <=> $1::vector
    LIMIT 3
  `, [zeroVec]);
  for (const r of probe.rows) {
    console.log(`  ${r.id}: score=${r.score}`);
  }
} catch (e) {
  console.error('  probe failed:', e.message);
}

// Check workspaces
const ws = await c.query("SELECT w.id, w.name, COUNT(kc.id)::int AS chunks FROM workspaces w LEFT JOIN knowledge_chunks kc ON kc.workspace_id = w.id GROUP BY w.id, w.name ORDER BY chunks DESC LIMIT 5");
console.log('\nworkspaces:');
for (const r of ws.rows) {
  console.log(`  ${r.name} (${r.id}): chunks=${r.chunks}`);
}

await c.end();
