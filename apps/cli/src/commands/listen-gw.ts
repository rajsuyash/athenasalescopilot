import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import kleur from 'kleur';
import WebSocket from 'ws';
import { callApi, HttpError } from '../lib/api.js';
import { loadConfig } from '../lib/config.js';
import { startAudioCapture } from '../lib/audio.js';
import { box, print, wrap } from '../lib/print.js';

interface ListenGwOpts {
  device?: string;
  sampleRate?: number;
  ffmpeg?: string;
  rep?: string;
  vocabulary?: string[];
  language?: string;
  meetingTitle?: string;
  meetingId?: string;
  autoEnd?: boolean;
  /** Print every transcript (rep + customer + unknown). */
  showAll?: boolean;
}

interface SuggestionPayload {
  type: 'answer' | 'ask_next' | 'coach' | 'risk';
  answerText: string | null;
  followupText: string | null;
  confidenceScore: number;
  priorityScore: number;
  display: boolean;
  rationale: string;
  intent: { categories: string[]; stageSignal: string; urgencyScore: number };
  sources: Array<{ id: string; documentName: string | null; score: number }>;
}

interface RecapPayload {
  meetingId: string;
  title: string | null;
  summary: string;
  followupEmail: { subject: string; body: string };
  nextSteps: Array<{ owner: string; action: string; due: string | null }>;
  objections: Array<{ category: string; text: string; resolution: string; notes: string | null }>;
  crmSuggestions: {
    stage: string;
    nextStep: string | null;
    objections: string[];
    useCase: string | null;
    closeDateConfidence: number;
  };
  adherence: { framework: string; score: number; missing: string[] };
  lowSignal: boolean;
}

function renderRecap(r: RecapPayload): void {
  print.blank();
  print.heading(`Recap — ${r.title ?? '(untitled)'}`);
  if (r.lowSignal) print.warn('low_signal=true (short transcript)');
  box('SUMMARY', wrap(r.summary, 76), 'cyan');
  if (r.objections.length > 0) {
    print.heading('Objections');
    for (const o of r.objections) {
      print.kv(`${o.category}/${o.resolution}`, o.text);
    }
  }
  if (r.nextSteps.length > 0) {
    print.heading('Next steps');
    for (const n of r.nextSteps) {
      const due = n.due ? kleur.dim(` (due ${n.due})`) : '';
      print.kv(n.owner, `${n.action}${due}`);
    }
  }
  print.heading('Follow-up email');
  print.kv('subject', r.followupEmail.subject);
  box('BODY', wrap(r.followupEmail.body, 76), 'green');
  print.heading(`CRM (${r.crmSuggestions.stage})`);
  if (r.crmSuggestions.nextStep) print.kv('next step', r.crmSuggestions.nextStep);
  if (r.crmSuggestions.useCase) print.kv('use case', r.crmSuggestions.useCase);
  print.kv('close date conf', r.crmSuggestions.closeDateConfidence.toFixed(2));
  print.heading(`Adherence (${r.adherence.framework})`);
  print.kv('score', r.adherence.score.toFixed(2));
  if (r.adherence.missing.length > 0) print.kv('missing', r.adherence.missing.join(', '));
}

function colorForType(t: SuggestionPayload['type']): 'cyan' | 'green' | 'yellow' | 'red' {
  switch (t) {
    case 'answer':
      return 'green';
    case 'ask_next':
      return 'cyan';
    case 'coach':
      return 'yellow';
    case 'risk':
      return 'red';
  }
}

function renderSuggestion(s: SuggestionPayload, customerText: string): void {
  const lines: string[] = [];
  lines.push(kleur.dim(`customer: ${customerText.slice(0, 200)}`));
  lines.push('');
  if (s.answerText) lines.push(...wrap(s.answerText, 76));
  if (s.followupText) {
    if (s.answerText) lines.push('');
    lines.push(kleur.dim('Ask next:'));
    lines.push(...wrap(s.followupText, 76));
  }
  if (!s.answerText && !s.followupText) {
    lines.push(kleur.dim('(no displayable suggestion)'));
  }
  lines.push('');
  lines.push(
    kleur.dim(
      `confidence=${s.confidenceScore.toFixed(2)} priority=${s.priorityScore.toFixed(2)} intent=${s.intent.categories.join(',')} urgency=${s.intent.urgencyScore.toFixed(2)}`,
    ),
  );
  for (const src of s.sources) {
    lines.push(kleur.dim(`source: ${src.documentName ?? '?'} (score=${src.score.toFixed(2)})`));
  }
  box(s.type.toUpperCase(), lines, colorForType(s.type));
}

export async function listenGwCmd(opts: ListenGwOpts): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg.accessToken) {
    print.err('Not signed in. Run `athena login`.');
    process.exit(1);
  }

  const device = opts.device ?? ':0';
  const sampleRate = opts.sampleRate ?? 16000;

  // Resolve / create the meeting via the api service.
  let meetingId: string | null = opts.meetingId ?? null;
  const wantPersist = !!opts.meetingId || !!opts.meetingTitle;
  if (!meetingId) {
    try {
      const m = await callApi<{ id: string; title: string | null }>({
        method: 'POST',
        path: '/v1/meetings',
        body: opts.meetingTitle ? { title: opts.meetingTitle } : {},
      });
      meetingId = m.id;
      print.ok(`meeting created: ${m.id}${m.title ? ` (${m.title})` : ''}`);
    } catch (err) {
      if (err instanceof HttpError) print.err(`failed to create meeting: ${err.code}`);
      throw err;
    }
  }

  const wsUrl = cfg.gatewayUrl.replace(/^http/, 'ws') + `/v1/sessions?token=${encodeURIComponent(cfg.accessToken)}`;

  print.heading('Athena listen — gateway mode (server owns STT + persistence)');
  print.kv('gateway', cfg.gatewayUrl);
  print.kv('meeting', meetingId);
  print.kv('device', device);
  print.kv('sample rate', String(sampleRate));
  print.info('Hit Ctrl-C to stop. /rep <label>, /quit.');
  print.blank();

  const ws = new WebSocket(wsUrl);
  let ready = false;
  const pendingCustomerText = new Map<string, string>(); // turnId not exposed by gateway → keyed by suggestion order

  const audio = startAudioCapture({
    device,
    sampleRate,
    ...(opts.ffmpeg ? { ffmpeg: opts.ffmpeg } : {}),
  });
  audio.proc.stderr.on('data', (chunk: Buffer) => {
    const msg = chunk.toString('utf8').trim();
    if (msg) print.warn(`ffmpeg: ${msg.split('\n')[0]}`);
  });

  ws.on('open', () => {
    /* server sends hello.required first */
  });
  ws.on('message', (data: WebSocket.RawData) => {
    let payload: { type?: string; [k: string]: unknown };
    try {
      payload = JSON.parse(data.toString('utf8')) as typeof payload;
    } catch {
      return;
    }
    switch (payload.type) {
      case 'hello.required': {
        ws.send(
          JSON.stringify({
            type: 'hello',
            meetingId,
            sampleRate,
            language: opts.language ?? 'en-US',
            ...(opts.vocabulary?.length ? { vocabulary: opts.vocabulary } : {}),
            ...(opts.rep ? { repLabel: opts.rep } : {}),
          }),
        );
        break;
      }
      case 'ready': {
        ready = true;
        print.ok(`session ready (${(payload as { sessionId?: string }).sessionId ?? '?'})`);
        // Start streaming PCM only after server is ready.
        audio.proc.stdout.on('data', (chunk: Buffer) => {
          if (!ready || ws.readyState !== WebSocket.OPEN) return;
          ws.send(chunk);
        });
        break;
      }
      case 'transcript.partial':
        // Quietly ignore by default; uncomment for debug.
        break;
      case 'transcript.final': {
        const seg = (payload as { segment: { text: string; speakerLabel: string } }).segment;
        const speaker = (payload as { speaker: 'rep' | 'customer' | 'unknown' }).speaker;
        if (opts.showAll || speaker === 'rep') {
          const tag = speaker === 'rep' ? kleur.green('rep') : kleur.cyan(speaker);
          process.stdout.write(`${kleur.dim('▸')} ${tag} (${seg.speakerLabel}): ${seg.text}\n`);
        }
        if (speaker === 'customer') pendingCustomerText.set(seg.text.slice(0, 60), seg.text);
        break;
      }
      case 'suggestion.generated': {
        const s = (payload as { suggestion: SuggestionPayload }).suggestion;
        // Best-effort: pop the most recent customer text for the box header.
        let customerText = '';
        const lastKey = [...pendingCustomerText.keys()].pop();
        if (lastKey) {
          customerText = pendingCustomerText.get(lastKey) ?? '';
          pendingCustomerText.delete(lastKey);
        }
        renderSuggestion(s, customerText);
        break;
      }
      case 'recap.ready': {
        const recap = (payload as { recap: RecapPayload }).recap;
        renderRecap(recap);
        break;
      }
      case 'error':
        print.err(
          `${(payload as { code?: string }).code ?? 'ERROR'} — ${(payload as { message?: string }).message ?? ''}`,
        );
        break;
      case 'closed':
        print.info(`session closed (${(payload as { reason?: string }).reason ?? ''})`);
        break;
      default:
        // Unknown; drop.
        break;
    }
  });

  ws.on('error', (err: Error) => print.err(`ws error: ${err.message}`));
  ws.on('close', () => print.info('ws closed'));

  const rl = readline.createInterface({ input, output, terminal: true });
  rl.on('line', (line) => {
    const cmd = line.trim();
    if (cmd === '/quit' || cmd === '/exit') {
      rl.close();
    } else if (cmd.startsWith('/rep')) {
      const label = cmd.slice(4).trim();
      if (label && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'set_rep', label }));
      }
    }
  });

  const shutdown = async (): Promise<void> => {
    print.info('shutting down… (waiting for gateway recap)');
    rl.close();
    await audio.stop();
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'bye' }));
    } catch {
      /* ignore */
    }
    // Give the gateway up to 90s to fire postcall + push recap.ready, then closed.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), 90_000);
      ws.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
