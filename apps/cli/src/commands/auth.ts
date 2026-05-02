import { callApi, HttpError } from '../lib/api.js';
import { clearConfig, loadConfig, saveConfig } from '../lib/config.js';
import { print } from '../lib/print.js';
import { ask, askHidden } from '../lib/prompt.js';

interface TokenBundle {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  user: { id: string };
  workspace: { id: string };
}

export async function signupCmd(): Promise<void> {
  const cfg = await loadConfig();
  print.heading('Create your Athena workspace');
  const name = await ask('Your name: ');
  const email = await ask('Email: ');
  const password = await askHidden('Password (min 12 chars): ');
  const workspaceName = await ask('Workspace name (e.g. "Acme Sales"): ');
  const workspaceSlug = await ask('Workspace slug (lowercase, dashes ok): ');

  try {
    const r = await callApi<TokenBundle>({
      method: 'POST',
      path: '/v1/auth/signup',
      auth: 'none',
      body: { name, email, password, workspaceName, workspaceSlug },
    });
    await saveConfig({
      ...cfg,
      accessToken: r.accessToken,
      refreshToken: r.refreshToken,
      expiresAt: r.expiresAt,
      workspaceId: r.workspace.id,
      userEmail: email,
    });
    print.ok(`Workspace created. user=${r.user.id} workspace=${r.workspace.id}`);
  } catch (err) {
    if (err instanceof HttpError) {
      print.err(`signup failed: ${err.code} — ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

export async function loginCmd(): Promise<void> {
  const cfg = await loadConfig();
  print.heading('Sign in to Athena');
  const email = await ask('Email: ');
  const password = await askHidden('Password: ');
  const slug = await ask('Workspace slug (blank = default): ');

  try {
    const r = await callApi<TokenBundle>({
      method: 'POST',
      path: '/v1/auth/login',
      auth: 'none',
      body: { email, password, ...(slug ? { workspaceSlug: slug } : {}) },
    });
    await saveConfig({
      ...cfg,
      accessToken: r.accessToken,
      refreshToken: r.refreshToken,
      expiresAt: r.expiresAt,
      workspaceId: r.workspace.id,
      userEmail: email,
    });
    print.ok(`Signed in as ${email}`);
  } catch (err) {
    if (err instanceof HttpError) {
      print.err(`login failed: ${err.code}`);
      process.exit(1);
    }
    throw err;
  }
}

export async function logoutCmd(): Promise<void> {
  const cfg = await loadConfig();
  if (cfg.refreshToken) {
    try {
      await callApi({
        method: 'POST',
        path: '/v1/auth/logout',
        auth: 'none',
        body: { refreshToken: cfg.refreshToken },
      });
    } catch {
      /* ignore */
    }
  }
  await clearConfig();
  print.ok('Signed out');
}

export async function whoamiCmd(): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg.accessToken) {
    print.warn('Not signed in. Run `athena login` or `athena signup`.');
    return;
  }
  try {
    const r = await callApi<{
      user: { id: string; email: string; name: string };
      workspace: { id: string; name: string; slug: string; planTier: string };
      role: string;
    }>({ path: '/v1/auth/me' });
    print.heading('Athena identity');
    print.kv('user', `${r.user.name} <${r.user.email}>`);
    print.kv('workspace', `${r.workspace.name} (${r.workspace.slug})`);
    print.kv('plan', r.workspace.planTier);
    print.kv('role', r.role);
  } catch (err) {
    if (err instanceof HttpError) {
      print.err(`whoami failed: ${err.code}`);
      process.exit(1);
    }
    throw err;
  }
}
