#!/usr/bin/env node
/**
 * tools/verify-extension.mjs
 *
 * Loads the unpacked Chrome extension from --ext-path (default: ./dist),
 * navigates to one or more test URLs where content scripts should activate,
 * captures console errors from BOTH the page AND the service worker,
 * optionally drives the popup, and prints a structured JSON report.
 *
 * Used by the chrome-extension-verifier subagent (.claude/agents/chrome-extension-verifier.md)
 * via the /verify-ext slash command.
 *
 * One-time install:
 *   pnpm add -D playwright       (or npm/yarn equivalent)
 *   npx playwright install chromium
 *
 * Usage:
 *   node tools/verify-extension.mjs \
 *     --ext-path apps/chrome-extension/dist \
 *     --url https://example.com/page-where-content-script-runs \
 *     --popup
 *
 * Flags:
 *   --ext-path <path>   built extension folder (default apps/chrome-extension/dist)
 *   --url <url>         repeatable; each URL where a content script should run
 *   --popup             also open chrome-extension://<id>/popup.html
 *   --options           also open chrome-extension://<id>/options.html
 *   --headless          run headless (default headed; some ext APIs need headed)
 *   --out-dir <path>    screenshot output dir (default .claude/screenshots)
 *
 * Exit code: 0 on PASS, 1 on FAIL (errors > 0).
 */

import { chromium } from 'playwright';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

function parseArgs(argv) {
  const out = {
    extPath: 'apps/chrome-extension/dist',
    urls: [],
    popup: false,
    options: false,
    headless: false,
    outDir: '.claude/screenshots',
    swWarmupMs: 0,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ext-path') out.extPath = argv[++i];
    else if (a === '--url') out.urls.push(argv[++i]);
    else if (a === '--popup') out.popup = true;
    else if (a === '--options') out.options = true;
    else if (a === '--headless') out.headless = true;
    else if (a === '--out-dir') out.outDir = argv[++i];
    else if (a === '--sw-warmup') out.swWarmupMs = parseInt(argv[++i], 10) || 0;
  }
  return out;
}

function emit(report, exitCode) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(exitCode);
}

const args = parseArgs(process.argv);
const errors = [];
const warnings = [];
const screenshots = [];

mkdirSync(args.outDir, { recursive: true });

// 1. Validate manifest
let manifest;
const manifestPath = join(args.extPath, 'manifest.json');
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
} catch (err) {
  emit({
    ok: false,
    reason: 'MANIFEST_NOT_FOUND_OR_INVALID',
    extPath: resolve(args.extPath),
    detail: err.message,
    hint: 'Run your build command first (e.g. pnpm build) and confirm dist/manifest.json exists.',
  }, 1);
}

if (manifest.manifest_version !== 3) {
  warnings.push({ source: 'manifest', text: `manifest_version is ${manifest.manifest_version}; v3 expected.` });
}

// 2. Launch persistent context with extension loaded
const userDataDir = `/tmp/playwright-ext-${Date.now()}`;
const extPath = resolve(args.extPath);

let context;
try {
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: args.headless,
    args: [
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
} catch (err) {
  emit({
    ok: false,
    reason: 'BROWSER_LAUNCH_FAILED',
    detail: err.message,
    hint: err.message.includes('Cannot find module')
      ? 'Run: pnpm add -D playwright && npx playwright install chromium'
      : 'Check Playwright install and Chromium availability.',
  }, 1);
}

// 3. Wait for service worker (Manifest V3)
let extensionId = null;
let sw = null;
const swDeadline = Date.now() + 5000;
while (Date.now() < swDeadline && !sw) {
  const workers = context.serviceWorkers();
  sw = workers.find(w => w.url().startsWith('chrome-extension://'));
  if (!sw) await new Promise(r => setTimeout(r, 100));
}

if (sw) {
  extensionId = sw.url().split('/')[2];
  sw.on('console', msg => {
    if (msg.type() === 'error') errors.push({ source: 'service_worker', text: msg.text() });
    else if (msg.type() === 'warning') warnings.push({ source: 'service_worker', text: msg.text() });
  });
  sw.on('pageerror', err => errors.push({ source: 'service_worker', text: err.message }));
  // Optional warmup — gives the SW time to import its module graph,
  // register chrome.runtime.onMessage listeners, and hydrate storage.
  // Use --sw-warmup 3000 when testing whether a popup crash is a
  // race-on-first-launch vs a real bug.
  if (args.swWarmupMs > 0) {
    await new Promise(r => setTimeout(r, args.swWarmupMs));
  }
} else {
  errors.push({
    source: 'service_worker',
    text: 'Service worker did not register within 5s. Check manifest.background.service_worker path and SW for top-level errors.',
  });
}

// 4. Navigate each URL — content script verification
for (const url of args.urls) {
  const page = await context.newPage();
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push({ source: 'page', url, text: msg.text() });
    else if (msg.type() === 'warning') warnings.push({ source: 'page', url, text: msg.text() });
  });
  page.on('pageerror', err => errors.push({ source: 'page', url, text: err.message }));
  page.on('requestfailed', req => {
    if (extensionId && req.url().startsWith(`chrome-extension://${extensionId}`)) return;
    warnings.push({
      source: 'network',
      url,
      text: `${req.method()} ${req.url()} ${req.failure()?.errorText ?? 'failed'}`,
    });
  });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1500); // let content scripts settle
    const slug = url.replace(/[^a-z0-9]/gi, '_').slice(0, 60);
    const shotPath = join(args.outDir, `ext-${slug}-${Date.now()}.png`);
    await page.screenshot({ path: shotPath });
    screenshots.push({ context: 'content_script', url, path: shotPath });
  } catch (err) {
    errors.push({ source: 'navigation', url, text: err.message });
  } finally {
    await page.close();
  }
}

// 5. Optional: popup
let popupReport = null;
if (args.popup && extensionId) {
  const popupUrl = `chrome-extension://${extensionId}/popup.html`;
  const popupErrors = [];
  const page = await context.newPage();
  page.on('console', msg => { if (msg.type() === 'error') popupErrors.push(msg.text()); });
  page.on('pageerror', err => popupErrors.push(err.message));
  try {
    await page.goto(popupUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const shotPath = join(args.outDir, `ext-popup-${Date.now()}.png`);
    await page.screenshot({ path: shotPath });
    popupReport = { url: popupUrl, errors: popupErrors, screenshot: shotPath };
    if (popupErrors.length) errors.push(...popupErrors.map(t => ({ source: 'popup', text: t })));
    screenshots.push({ context: 'popup', url: popupUrl, path: shotPath });
  } catch (err) {
    popupReport = { url: popupUrl, errors: [err.message], screenshot: null };
    errors.push({ source: 'popup', text: err.message });
  } finally {
    await page.close();
  }
}

// 6. Optional: options page
let optionsReport = null;
if (args.options && extensionId) {
  const optionsUrl = `chrome-extension://${extensionId}/options.html`;
  const optErrors = [];
  const page = await context.newPage();
  page.on('console', msg => { if (msg.type() === 'error') optErrors.push(msg.text()); });
  page.on('pageerror', err => optErrors.push(err.message));
  try {
    await page.goto(optionsUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const shotPath = join(args.outDir, `ext-options-${Date.now()}.png`);
    await page.screenshot({ path: shotPath });
    optionsReport = { url: optionsUrl, errors: optErrors, screenshot: shotPath };
    if (optErrors.length) errors.push(...optErrors.map(t => ({ source: 'options', text: t })));
    screenshots.push({ context: 'options', url: optionsUrl, path: shotPath });
  } catch (err) {
    optionsReport = { url: optionsUrl, errors: [err.message], screenshot: null };
    errors.push({ source: 'options', text: err.message });
  } finally {
    await page.close();
  }
}

await context.close();

const report = {
  ok: errors.length === 0,
  manifestVersion: manifest.manifest_version,
  extensionName: manifest.name,
  extensionId,
  serviceWorker: sw ? 'registered' : 'missing',
  urlsChecked: args.urls,
  popup: popupReport,
  options: optionsReport,
  errors,
  warnings,
  screenshots,
  timestamp: new Date().toISOString(),
};
emit(report, errors.length ? 1 : 0);
