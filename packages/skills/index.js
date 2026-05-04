// Resolves to the absolute path of the bundles/ directory containing every
// .skill zip. Consumers pass this to @athena/sdk-llm's initSkills(dir).
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const dir = join(here, 'bundles');
