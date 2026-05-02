import { loadConfig, saveConfig, configPath } from '../lib/config.js';
import { print } from '../lib/print.js';

export async function configShowCmd(): Promise<void> {
  const cfg = await loadConfig();
  print.heading('Athena CLI config');
  print.kv('path', configPath());
  print.kv('apiUrl', cfg.apiUrl);
  print.kv('knowledgeUrl', cfg.knowledgeUrl);
  print.kv('orchestratorUrl', cfg.orchestratorUrl);
  print.kv('postcallUrl', cfg.postcallUrl);
  print.kv('gatewayUrl', cfg.gatewayUrl);
  print.kv('signedIn', cfg.accessToken ? 'yes' : 'no');
  if (cfg.userEmail) print.kv('email', cfg.userEmail);
  if (cfg.workspaceId) print.kv('workspaceId', cfg.workspaceId);
  if (cfg.expiresAt) print.kv('access expires', cfg.expiresAt);
}

export async function configSetCmd(key: string, value: string): Promise<void> {
  const cfg = await loadConfig();
  const allowed = new Set([
    'apiUrl',
    'knowledgeUrl',
    'orchestratorUrl',
    'postcallUrl',
    'gatewayUrl',
  ]);
  if (!allowed.has(key)) {
    print.err(`Unknown key: ${key}. Allowed: ${[...allowed].join(', ')}`);
    process.exit(2);
  }
  try {
    new URL(value);
  } catch {
    print.err(`Not a valid URL: ${value}`);
    process.exit(2);
  }
  await saveConfig({ ...cfg, [key]: value });
  print.ok(`set ${key}=${value}`);
}
