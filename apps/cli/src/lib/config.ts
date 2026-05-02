import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const ConfigSchema = z.object({
  apiUrl: z.string().url().default('http://localhost:4000'),
  knowledgeUrl: z.string().url().default('http://localhost:4010'),
  orchestratorUrl: z.string().url().default('http://localhost:4020'),
  postcallUrl: z.string().url().default('http://localhost:4030'),
  gatewayUrl: z.string().url().default('http://localhost:4040'),
  accessToken: z.string().nullable().default(null),
  refreshToken: z.string().nullable().default(null),
  expiresAt: z.string().nullable().default(null),
  workspaceId: z.string().nullable().default(null),
  userEmail: z.string().nullable().default(null),
});

export type Config = z.infer<typeof ConfigSchema>;

const CONFIG_DIR = path.join(os.homedir(), '.athena');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

async function ensureDir(): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
}

export async function loadConfig(): Promise<Config> {
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf8');
    return ConfigSchema.parse(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return ConfigSchema.parse({});
    }
    throw err;
  }
}

export async function saveConfig(cfg: Config): Promise<void> {
  await ensureDir();
  // 0600 — readable only by the user. The file holds JWTs.
  const tmp = `${CONFIG_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  await fs.rename(tmp, CONFIG_FILE);
}

export async function clearConfig(): Promise<void> {
  await ensureDir();
  await saveConfig(ConfigSchema.parse({}));
}

export function configPath(): string {
  return CONFIG_FILE;
}
