import kleur from 'kleur';
import { callApi, HttpError } from '../lib/api.js';
import { loadConfig } from '../lib/config.js';
import { box, print, wrap } from '../lib/print.js';

interface Recap {
  meetingId: string;
  title: string | null;
  host: { name: string; email: string };
  summary: string;
  objections: Array<{ category: string; text: string; resolution: string; notes: string | null }>;
  nextSteps: Array<{ owner: string; action: string; due: string | null }>;
  followupEmail: { subject: string; body: string };
  crmSuggestions: {
    stage: string;
    nextStep: string | null;
    objections: string[];
    useCase: string | null;
    closeDateConfidence: number;
  };
  adherence: { framework: string; score: number; missing: string[] };
  lowSignal: boolean;
  createdAt: string;
}

async function postcallBase(): Promise<string> {
  const cfg = await loadConfig();
  return cfg.postcallUrl;
}

interface RecapRunResult {
  id: string;
  cached: boolean;
  source?: 'llm' | 'fallback';
  lowSignal?: boolean;
}

export async function recapRunCmd(meetingId: string, opts: { force?: boolean; framework?: string }): Promise<void> {
  const baseUrl = await postcallBase();
  try {
    const r = await callApi<RecapRunResult>({
      method: 'POST',
      baseUrl,
      path: `/v1/postcall/meetings/${encodeURIComponent(meetingId)}/recap`,
      body: {
        ...(opts.force ? { force: opts.force } : {}),
        ...(opts.framework ? { framework: opts.framework } : {}),
      },
    });
    if (r.cached) {
      print.info('Cached recap exists — pass --force to regenerate.');
    } else {
      print.ok(`recap generated (source=${r.source ?? 'fallback'}, lowSignal=${String(r.lowSignal ?? false)})`);
    }
    await recapShowCmd(meetingId);
  } catch (err) {
    if (err instanceof HttpError) {
      print.err(`recap failed: ${err.code} — ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

export async function recapShowCmd(meetingId: string): Promise<void> {
  const baseUrl = await postcallBase();
  try {
    const r = await callApi<Recap>({
      baseUrl,
      path: `/v1/postcall/meetings/${encodeURIComponent(meetingId)}/recap`,
    });
    print.heading(`Recap — ${r.title ?? '(untitled)'}`);
    print.kv('meeting', r.meetingId);
    print.kv('host', `${r.host.name} <${r.host.email}>`);
    print.kv('generated', r.createdAt);
    if (r.lowSignal) print.warn('low_signal=true (short transcript)');
    print.blank();

    box('SUMMARY', wrap(r.summary, 76), 'cyan');

    if (r.objections.length > 0) {
      print.heading('Objections');
      for (const o of r.objections) {
        print.kv(`${o.category}/${o.resolution}`, o.text);
        if (o.notes) print.info(`  ↳ ${o.notes}`);
      }
      print.blank();
    }

    if (r.nextSteps.length > 0) {
      print.heading('Next steps');
      for (const n of r.nextSteps) {
        const due = n.due ? kleur.dim(` (due ${n.due})`) : '';
        print.kv(n.owner, `${n.action}${due}`);
      }
      print.blank();
    }

    print.heading('Follow-up email');
    print.kv('subject', r.followupEmail.subject);
    box('BODY', wrap(r.followupEmail.body, 76), 'green');

    print.heading('CRM suggestions');
    print.kv('stage', r.crmSuggestions.stage);
    if (r.crmSuggestions.nextStep) print.kv('next step', r.crmSuggestions.nextStep);
    if (r.crmSuggestions.useCase) print.kv('use case', r.crmSuggestions.useCase);
    if (r.crmSuggestions.objections.length > 0)
      print.kv('objection tags', r.crmSuggestions.objections.join(', '));
    print.kv('close date conf', r.crmSuggestions.closeDateConfidence.toFixed(2));
    print.blank();

    print.heading(`Adherence (${r.adherence.framework})`);
    print.kv('score', r.adherence.score.toFixed(2));
    if (r.adherence.missing.length > 0) {
      print.kv('missing', r.adherence.missing.join(', '));
    }
  } catch (err) {
    if (err instanceof HttpError) {
      if (err.code === 'NO_SUMMARY') {
        print.warn('No recap yet. Run `athena recap run <meetingId>`.');
        return;
      }
      print.err(`recap show failed: ${err.code}`);
      process.exit(1);
    }
    throw err;
  }
}
