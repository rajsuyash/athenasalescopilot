/**
 * Package the built extension and keep the admin-web download in lockstep
 * with the source — automatically, on every deploy.
 *
 * Why this exists: the zips used to be hand-rolled, so the dashboard's
 * "Install extension" served 0.1.15 while the source was at 0.1.19 and
 * clients never received shipped fixes. Now admin-web's `build` script runs
 * `pnpm --filter @athena/chrome-extension package` first, so every push that
 * deploys admin-web regenerates the zip from source. Nothing to remember.
 *
 * Steps:
 *   1. Read the version from src/manifest.json (what Chrome actually shows)
 *      and assert it matches package.json (drift = hard fail).
 *   2. Run the prod build with API/gateway URLs derived from manifest
 *      host_permissions (env vars override).
 *   3. Zip dist/ → public/downloads/rocket-sales-agent-<version>.zip,
 *      removing any stale zips (uses adm-zip — no system `zip` needed on
 *      build images).
 *   4. Write apps/admin-web/src/lib/extension-meta.json so the install page
 *      renders the real version, filename, and size.
 *
 * Run via `pnpm run package`. Zips are gitignored; the meta JSON is committed
 * only so local typecheck works — deploys regenerate both.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const extRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(extRoot, '../..');
const distDir = path.join(extRoot, 'dist');
const downloadsDir = path.join(repoRoot, 'apps/admin-web/public/downloads');
const metaPath = path.join(repoRoot, 'apps/admin-web/src/lib/extension-meta.json');

const manifest = JSON.parse(fs.readFileSync(path.join(extRoot, 'src/manifest.json'), 'utf8'));

/**
 * Prod API/gateway URLs come from manifest host_permissions ONLY — the
 * extension can only call hosts listed there, so they are the single source
 * of truth. Deliberately NO env override: Railway injects service-internal
 * env vars (ATHENA_API_URL=http://athena-api.railway.internal:4000) into the
 * admin-web build, and honoring them baked an internet-unreachable URL into
 * the shipped zip (caught in the 0.1.21 deploy log).
 */
function hostUrl(matcher) {
  const entry = (manifest.host_permissions ?? []).find(
    (h) => h.startsWith('https://') && h.includes(matcher),
  );
  if (!entry) {
    console.error(`package: no https host matching "${matcher}" in manifest host_permissions.`);
    process.exit(1);
  }
  return entry.replace(/\/\*$/, '');
}

const env = {
  ...process.env,
  ATHENA_API_URL: hostUrl('athena-api'),
  ATHENA_GATEWAY_URL: hostUrl('athena-realtime'),
};
const version = manifest.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`package: unexpected manifest version "${version}".`);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(path.join(extRoot, 'package.json'), 'utf8'));
if (pkg.version !== version) {
  console.error(
    `package: package.json version (${pkg.version}) != manifest version (${version}) — sync them first.`,
  );
  process.exit(1);
}

console.log(`package: building prod (api=${env.ATHENA_API_URL}, gateway=${env.ATHENA_GATEWAY_URL})`);
execSync('pnpm run build:prod', { cwd: extRoot, env, stdio: 'inherit' });

const zipName = `rocket-sales-agent-${version}.zip`;
const zipPath = path.join(downloadsDir, zipName);

fs.mkdirSync(downloadsDir, { recursive: true });
for (const stale of fs.readdirSync(downloadsDir).filter((f) => f.endsWith('.zip'))) {
  fs.rmSync(path.join(downloadsDir, stale));
  console.log(`package: removed stale ${stale}`);
}

const zip = new AdmZip();
zip.addLocalFolder(distDir);
zip.writeZip(zipPath);

const zipSizeKb = Math.ceil(fs.statSync(zipPath).size / 1024);
fs.writeFileSync(metaPath, `${JSON.stringify({ version, zipName, zipSizeKb }, null, 2)}\n`);

console.log(`package: ${zipName} (${zipSizeKb} KB) → public/downloads, meta updated.`);
