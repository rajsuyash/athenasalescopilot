/**
 * Anthropic Skill bundle loader.
 *
 * Athena ships a few `.skill` bundles in-tree (athena/skills/). Each bundle
 * is a zip containing SKILL.md + optional references/*.md. At service boot,
 * `initSkills(dir)` extracts every bundle once and caches the prepared
 * system-prompt-ready string in memory. Consumers call `loadSkill(name)`
 * to get that string and prepend it to their LLM messages array.
 *
 * We deliberately avoid adding a zip dependency — uses the system `unzip`
 * binary (present on every Linux container and macOS dev machine).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

/** Read a single .skill bundle into a system-prompt-ready string. */
function readSkillBundle(bundlePath: string): LoadedSkill | null {
  if (!existsSync(bundlePath)) return null;
  const tmpDir = mkdtempSync(join(tmpdir(), 'athena-skill-'));
  try {
    execFileSync('unzip', ['-q', '-o', bundlePath, '-d', tmpDir], { stdio: 'pipe' });
  } catch (err) {
    rmSync(tmpDir, { recursive: true, force: true });
    throw new Error(
      `failed to unzip skill bundle ${bundlePath}: ${err instanceof Error ? err.message : 'unknown'}`,
    );
  }
  try {
    // Skill bundles wrap the skill folder inside the zip — find the
    // SKILL.md anywhere up to depth 3.
    const skillMd = findFile(tmpDir, 'SKILL.md', 3);
    if (!skillMd) return null;
    const skillRoot = skillMd.replace(/\/SKILL\.md$/, '');
    const refs = readReferenceFiles(skillRoot);
    const body = [
      readFileSync(skillMd, 'utf8').trim(),
      refs.length > 0
        ? `\n\n---\n\n## Reference materials (provided to the skill)\n\n${refs.join('\n\n---\n\n')}`
        : '',
    ].join('');
    const name = nameFromBundlePath(bundlePath);
    return { name, body, bytes: Buffer.byteLength(body, 'utf8') };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function findFile(root: string, target: string, maxDepth: number): string | null {
  const stack: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];
  while (stack.length > 0) {
    const { path, depth } = stack.pop() as { path: string; depth: number };
    let entries: string[];
    try {
      entries = readdirSync(path);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(path, entry);
      let s;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      if (s.isFile() && entry === target) return full;
      if (s.isDirectory() && depth < maxDepth) stack.push({ path: full, depth: depth + 1 });
    }
  }
  return null;
}

function readReferenceFiles(skillRoot: string): string[] {
  const refsDir = join(skillRoot, 'references');
  if (!existsSync(refsDir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(refsDir).sort()) {
    if (!entry.endsWith('.md')) continue;
    const full = join(refsDir, entry);
    try {
      out.push(`### ${entry}\n\n${readFileSync(full, 'utf8').trim()}`);
    } catch {
      // ignore unreadable refs
    }
  }
  return out;
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
