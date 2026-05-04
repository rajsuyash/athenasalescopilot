/**
 * Anthropic Skill bundle loader.
 *
 * Athena ships a few `.skill` bundles in-tree (packages/skills/bundles/).
 * Each bundle is a zip containing SKILL.md + optional references/*.md.
 * At service boot, `initSkills(dir)` reads every bundle's contents
 * directly via adm-zip (pure JS, no system unzip dependency — Railway's
 * Node container doesn't ship unzip). Caches the prepared
 * system-prompt-ready string in memory.
 */
import AdmZip from 'adm-zip';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

interface LoadedSkill {
  name: string;
  body: string;
  /** Original byte size of SKILL.md + concatenated references. Useful for
   *  budget warnings if a skill grows past a sensible token cap. */
  bytes: number;
}

const skills = new Map<string, LoadedSkill>();
let initialized = false;

/** Maximum combined size of SKILL.md + reference files. Skills larger than
 *  this are loaded but a warning is logged. ~30 KB → roughly 7-8k tokens. */
const SKILL_BYTE_BUDGET = 30_000;

/** Read a single .skill bundle (zip) into a system-prompt-ready string. */
function readSkillBundle(bundlePath: string): LoadedSkill | null {
  if (!existsSync(bundlePath)) return null;
  const zip = new AdmZip(bundlePath);
  const entries = zip.getEntries();
  if (entries.length === 0) return null;

  // Skill bundles wrap the skill folder inside the zip — locate SKILL.md
  // anywhere in the tree (typically <name>/SKILL.md).
  const skillEntry = entries.find((e) => e.entryName.toLowerCase().endsWith('/skill.md') || e.entryName.toLowerCase() === 'skill.md');
  if (!skillEntry) return null;

  const skillBody = skillEntry.getData().toString('utf8').trim();
  const skillDir = skillEntry.entryName.replace(/SKILL\.md$/i, '');
  const referencesPrefix = `${skillDir}references/`;
  const refs = entries
    .filter((e) => !e.isDirectory && e.entryName.startsWith(referencesPrefix) && e.entryName.toLowerCase().endsWith('.md'))
    .sort((a, b) => a.entryName.localeCompare(b.entryName))
    .map((e) => `### ${e.entryName.slice(referencesPrefix.length)}\n\n${e.getData().toString('utf8').trim()}`);

  const body = [
    skillBody,
    refs.length > 0
      ? `\n\n---\n\n## Reference materials (provided to the skill)\n\n${refs.join('\n\n---\n\n')}`
      : '',
  ].join('');
  const name = nameFromBundlePath(bundlePath);
  return { name, body, bytes: Buffer.byteLength(body, 'utf8') };
}

function nameFromBundlePath(bundlePath: string): string {
  return bundlePath
    .split('/')
    .pop()!
    .replace(/\.skill$/, '');
}

/**
 * Initialize the skill cache from every .skill bundle in `dir`. Idempotent:
 * subsequent calls re-scan the directory so a deploy that drops a new
 * bundle will pick it up at the next service start. Throws if `dir`
 * doesn't exist — fail-fast so missing skills surface immediately.
 */
export function initSkills(dir: string): { loaded: string[]; skipped: string[] } {
  if (!existsSync(dir)) {
    throw new Error(`skills directory not found: ${dir}`);
  }
  skills.clear();
  const loaded: string[] = [];
  const skipped: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.skill')) continue;
    const full = join(dir, entry);
    try {
      const skill = readSkillBundle(full);
      if (skill) {
        skills.set(skill.name, skill);
        loaded.push(skill.name);
        if (skill.bytes > SKILL_BYTE_BUDGET) {
          // eslint-disable-next-line no-console
          console.warn(
            `[skills] ${skill.name} is ${skill.bytes} bytes (budget ${SKILL_BYTE_BUDGET}); consider trimming references`,
          );
        }
      } else {
        skipped.push(entry);
      }
    } catch (err) {
      skipped.push(`${entry} (${err instanceof Error ? err.message : 'unknown'})`);
    }
  }
  initialized = true;
  return { loaded, skipped };
}

/**
 * Get a skill's prompt body. Throws if the cache wasn't initialized or the
 * named skill isn't loaded — these are programmer errors that should fail
 * fast rather than silently returning empty content.
 */
export function loadSkill(name: string): string {
  if (!initialized) {
    throw new Error('initSkills() has not been called — invoke at service boot');
  }
  const skill = skills.get(name);
  if (!skill) {
    const available = [...skills.keys()].join(', ') || '(none)';
    throw new Error(`skill not loaded: ${name} (available: ${available})`);
  }
  return skill.body;
}

export function loadedSkills(): string[] {
  return [...skills.keys()];
}
