/**
 * Onboarding seed — pretrains a fresh workspace with the Andres Contreras
 * Socratic-reframe objection-handling framework so the rep gets grounded
 * suggestions on call #1, before they upload anything of their own.
 *
 * Calls knowledge-service over HTTP using the user's freshly-issued access
 * token. Fire-and-forget: a knowledge-service outage must not block signup.
 *
 * Source files live in src/seed/objection-framework/ and ship with the
 * service image. Replace or extend by dropping new .md files there and
 * adding an entry to FRAMEWORK_DOCS.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(__dirname, '..', 'seed', 'objection-framework');

interface FrameworkDoc {
  /** Source filename in SEED_DIR. */
  file: string;
  /** Display name shown on /knowledge. */
  name: string;
  /** Category lets the orchestrator filter retrieval if it ever needs to. */
  category: string;
}

const FRAMEWORK_DOCS: FrameworkDoc[] = [
  {
    file: 'SKILL.md',
    name: 'Objection Reframer — 7-step loop (master)',
    category: 'objection-handling-framework',
  },
  {
    file: 'reframe-library.md',
    name: 'Objection Reframer — reframe library by archetype',
    category: 'objection-handling-library',
  },
  {
    file: 'tonality-and-delivery.md',
    name: 'Objection Reframer — tonality & delivery',
    category: 'objection-handling-tonality',
  },
  {
    file: 'source-analysis.md',
    name: 'Objection Reframer — source analysis',
    category: 'objection-handling-source',
  },
];

interface SeedTags {
  framework: string;
  preTrained: boolean;
}

const SEED_TAGS: SeedTags = {
  framework: 'andres-reframe-v1',
  preTrained: true,
};

export async function seedWorkspaceKnowledge(input: {
  knowledgeUrl: string;
  accessToken: string;
}): Promise<void> {
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${input.accessToken}`,
  };
  for (const doc of FRAMEWORK_DOCS) {
    let text: string;
    try {
      text = readFileSync(join(SEED_DIR, doc.file), 'utf8');
    } catch {
      // Seed file missing on disk — skip silently. The workspace still works,
      // just without pre-training.
      continue;
    }
    try {
      await fetch(`${input.knowledgeUrl}/v1/knowledge/text`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: doc.name,
          category: doc.category,
          format: 'markdown',
          text,
          tags: SEED_TAGS,
        }),
      });
    } catch {
      // Best-effort. Knowledge-service down or slow → skip.
    }
  }
}
