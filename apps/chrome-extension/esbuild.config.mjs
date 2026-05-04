import esbuild from 'esbuild';
import { mkdirSync, existsSync, rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const outdir = 'dist';
if (existsSync(outdir)) rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

const isProd = process.env.ATHENA_PROD === '1';
const apiUrl = process.env.ATHENA_API_URL ?? (isProd ? 'https://athena.app' : 'http://localhost:4000');
const gatewayUrl = process.env.ATHENA_GATEWAY_URL ?? (isProd ? 'wss://athena.app/ws' : 'http://localhost:4040');

const common = {
  bundle: true,
  format: 'esm',
  target: ['chrome120'],
  // Sourcemaps are useful in dev but MUST NOT ship to the Chrome Web Store —
  // they bloat the zip ~4x and leak our source layout to anyone who opens
  // devtools on the extension. Inline maps in dev (so the watch flow keeps
  // working) and drop them entirely in prod.
  sourcemap: isProd ? false : 'inline',
  logLevel: 'info',
  minify: !watch,
  define: {
    'process.env.ATHENA_API_URL': JSON.stringify(apiUrl),
    'process.env.ATHENA_GATEWAY_URL': JSON.stringify(gatewayUrl),
    'process.env.ATHENA_DEV': JSON.stringify(isProd ? 'false' : 'true'),
  },
};

const entries = [
  { entryPoints: ['src/background/index.ts'], outfile: `${outdir}/background/index.js` },
  { entryPoints: ['src/content/index.ts'], outfile: `${outdir}/content/index.js` },
  { entryPoints: ['src/popup/index.ts'], outfile: `${outdir}/popup/index.js` },
  { entryPoints: ['src/offscreen/index.ts'], outfile: `${outdir}/offscreen/index.js` },
  { entryPoints: ['src/permission/index.ts'], outfile: `${outdir}/permission/index.js` },
];

if (watch) {
  for (const e of entries) {
    const ctx = await esbuild.context({ ...common, ...e });
    await ctx.watch();
  }
} else {
  for (const e of entries) {
    await esbuild.build({ ...common, ...e });
  }
}
