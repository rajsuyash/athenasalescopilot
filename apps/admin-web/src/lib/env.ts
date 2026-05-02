/**
 * Boundary validation for backend URLs. Server-side only — never reads cookies
 * or tokens here. Throws synchronously on missing required vars.
 */
export interface ServerEnv {
  apiUrl: string;
  knowledgeUrl: string;
  orchestratorUrl: string;
  postcallUrl: string;
  retentionUrl: string;
  analyticsUrl: string;
  billingUrl: string;
}

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const apiUrl = process.env.ATHENA_API_URL ?? 'http://localhost:4000';
  const knowledgeUrl = process.env.ATHENA_KNOWLEDGE_URL ?? 'http://localhost:4010';
  const orchestratorUrl = process.env.ATHENA_ORCHESTRATOR_URL ?? 'http://localhost:4020';
  const postcallUrl = process.env.ATHENA_POSTCALL_URL ?? 'http://localhost:4030';
  const retentionUrl = process.env.ATHENA_RETENTION_URL ?? 'http://localhost:4050';
  const analyticsUrl = process.env.ATHENA_ANALYTICS_URL ?? 'http://localhost:4060';
  const billingUrl = process.env.ATHENA_BILLING_URL ?? 'http://localhost:4070';
  for (const [k, v] of Object.entries({
    apiUrl,
    knowledgeUrl,
    orchestratorUrl,
    postcallUrl,
    retentionUrl,
    analyticsUrl,
    billingUrl,
  })) {
    try {
      new URL(v);
    } catch {
      throw new Error(`invalid URL for ${k}: ${v}`);
    }
  }
  cached = {
    apiUrl,
    knowledgeUrl,
    orchestratorUrl,
    postcallUrl,
    retentionUrl,
    analyticsUrl,
    billingUrl,
  };
  return cached;
}
