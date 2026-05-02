import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import kleur from 'kleur';
import { createSttClient, type SttSegment } from '@athena/sdk-stt';
import { callApi, HttpError } from '../lib/api.js';
import { loadConfig } from '../lib/config.js';
import { SpeakerMapper, startAudioCapture } from '../lib/audio.js';
import { box, print, wrap } from '../lib/print.js';

interface ListenOpts {
  device?: string;
  sampleRate?: number;
  ffmpeg?: string;
  rep?: string;
  vocabulary?: string[];
  language?: string;
  /** Optional Deepgram override; defaults to env DEEPGRAM_API_KEY. */
  deepgramApiKey?: string;
  /** Print every final transcript regardless of speaker. */
  showAll?: boolean;
  /** Create a meeting and persist transcripts + suggestions under it. */
  meetingTitle?: string;
  /** Attach to an existing meeting id instead of creating one. */
  meetingId?: string;
  /** Auto-end the meeting on shutdown. Defaults to true when --meeting was used. */
  autoEnd?: boolean;
}

interface CoachResponse {
  intent: { categories: string[]; stageSignal: string; urgencyScore: number; confidence: number; source: string };
  suggestion: {
    type: 'answer' | 'ask_next' | 'coach' | 'risk';
    answerText: string | null;
    followupText: string | null;
    confidenceScore: number;
    priorityScore: number;
    sourceChunkIds: string[];
    rationale: string;
    policyVersion: string;
    display: boolean;
    sources: Array<{ id: string; documentName: string | null; score: number }>;
  };
}

function colorForType(t: CoachResponse['suggestion']['type']): 'cyan' | 'green' | 'yellow' | 'red' {
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

function renderSuggestion(r: CoachResponse, customerText: string): void {
  const s = r.suggestion;
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
      `confidence=${s.confidenceScore.toFixed(2)}  priority=${s.priorityScore.toFixed(2)}  intent=${r.intent.categories.join(',')}  urgency=${r.intent.urgencyScore.toFixed(2)}`,
    ),
  );
  if (s.sources.length > 0) {
    for (const src of s.sources) {
      lines.push(kleur.dim(`source: ${src.documentName ?? '?'} (score=${src.score.toFixed(2)})`));
    }
  }
  box(s.type.toUpperCase(), lines, colorForType(s.type));
}

interface RollingTurn {
  speaker: 'rep' | 'customer';
  text: string;
}

async function callOrchestrator(
  customerText: string,
  context: RollingTurn[],
  meetingId: string | null,
): Promise<CoachResponse & { suggestionId?: string }> {
  const cfg = await loadConfig();
  return callApi<CoachResponse & { suggestionId?: string }>({
    method: 'POST',
    baseUrl: cfg.orchestratorUrl,
    path: '/v1/orchestrator/suggest',
    body: {
      customerText,
      contextTurns: context.slice(-6),
      ...(meetingId ? { meetingId } : {}),
    },
  });
}

interface PendingSegment {
  speakerType: 'rep' | 'customer' | 'unknown';
  speakerLabel: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence: number;
  sourceType: 'stt_audio';
  language: string;
}

async function flushTranscriptBatch(
  meetingId: string,
  batch: PendingSegment[],
): Promise<void> {
  if (batch.length === 0) return;
  await callApi({
    method: 'POST',
    path: `/v1/meetings/${encodeURIComponent(meetingId)}/transcript`,
    body: { segments: batch },
  });
}

export async function listenCmd(opts: ListenOpts): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg.accessToken) {
    print.err('Not signed in. Run `athena login`.');
    process.exit(1);
  }

  const apiKey = opts.deepgramApiKey ?? process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    print.err('DEEPGRAM_API_KEY missing. Set env var or pass --deepgram-key.');
    process.exit(2);
  }

  const device = opts.device ?? ':0'; // default mic on macOS
  const sampleRate = opts.sampleRate ?? 16000;

  // Resolve meeting (create or attach).
  let meetingId: string | null = opts.meetingId ?? null;
  const wantPersist = !!opts.meetingId || !!opts.meetingTitle;
  if (wantPersist && !opts.meetingId) {
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

  print.heading('Athena listen — live capture + coach');
  print.kv('device', device);
  print.kv('sample rate', String(sampleRate));
  print.kv('rep override', opts.rep ?? '(auto: first speaker = rep)');
  if (meetingId) print.kv('meeting', meetingId);
  print.info('Hit Ctrl-C to stop. Type /rep <label> to reassign rep mid-call.');
  print.blank();

  const stt = createSttClient({ provider: 'deepgram', deepgramApiKey: apiKey });
  const speakerMap = new SpeakerMapper(opts.rep ?? null);
  const rolling: RollingTurn[] = [];

  let inflight = false;
  let pendingText: string | null = null;
  let pendingShownAt = 0;
  const COOLDOWN_MS = 1500;

  // Transcript persistence batching: collect segments and POST every 5s while
  // a meeting is attached. Avoids one HTTP call per segment.
  const transcriptBatch: PendingSegment[] = [];
  let lastFlush = Date.now();
  const TRANSCRIPT_FLUSH_MS = 5000;

  const flushTranscript = async (force = false): Promise<void> => {
    if (!meetingId) return;
    if (transcriptBatch.length === 0) return;
    if (!force && Date.now() - lastFlush < TRANSCRIPT_FLUSH_MS) return;
    const toSend = transcriptBatch.splice(0, transcriptBatch.length);
    lastFlush = Date.now();
    try {
      await flushTranscriptBatch(meetingId, toSend);
    } catch (err) {
      if (err instanceof HttpError) print.warn(`transcript persist: ${err.code}`);
      // Re-queue on failure so we don't lose segments on transient errors.
      transcriptBatch.unshift(...toSend);
    }
  };
  const transcriptTimer = setInterval(() => void flushTranscript(false), TRANSCRIPT_FLUSH_MS);

  const flush = async (text: string): Promise<void> => {
    inflight = true;
    try {
      const r = await callOrchestrator(text, rolling, meetingId);
      renderSuggestion(r, text);
    } catch (err) {
      if (err instanceof HttpError) print.err(`${err.code} — ${err.message}`);
      else print.err(String(err));
    } finally {
      inflight = false;
      // If a newer customer turn arrived during the call, fire it now.
      if (pendingText && Date.now() - pendingShownAt > COOLDOWN_MS) {
        const next = pendingText;
        pendingText = null;
        await flush(next);
      }
    }
  };

  const onFinal = (seg: SttSegment): void => {
    const speaker = speakerMap.classify(seg.speakerLabel);
    rolling.push({ speaker, text: seg.text });
    if (opts.showAll || speaker === 'rep') {
      const tag = speaker === 'rep' ? kleur.green('rep') : kleur.cyan('customer');
      process.stdout.write(`${kleur.dim('▸')} ${tag} (${seg.speakerLabel}): ${seg.text}\n`);
    }
    if (meetingId) {
      transcriptBatch.push({
        speakerType: speaker,
        speakerLabel: seg.speakerLabel,
        text: seg.text,
        startMs: seg.startMs,
        endMs: seg.endMs,
        confidence: seg.confidence,
        sourceType: 'stt_audio',
        language: seg.language,
      });
    }
    if (speaker !== 'customer') return;
    if (inflight) {
      pendingText = seg.text;
      pendingShownAt = Date.now();
      return;
    }
    void flush(seg.text);
  };

  const stream = await stt.open(
    {
      workspaceId: cfg.workspaceId ?? 'unknown',
      language: opts.language ?? 'en-US',
      sampleRate,
      channels: 1,
      ...(opts.vocabulary && opts.vocabulary.length > 0 ? { vocabulary: opts.vocabulary } : {}),
    },
    {
      onFinal,
      onError: (err) => print.err(`STT error: ${err.message}`),
      onClose: () => print.info('STT stream closed'),
    },
  );

  // Spawn ffmpeg + pipe PCM to Deepgram.
  const audio = startAudioCapture({ device, sampleRate, ...(opts.ffmpeg ? { ffmpeg: opts.ffmpeg } : {}) });
  audio.proc.stdout.on('data', (chunk: Buffer) => stream.push(chunk));
  audio.proc.stderr.on('data', (chunk: Buffer) => {
    const msg = chunk.toString('utf8').trim();
    if (msg) print.warn(`ffmpeg: ${msg.split('\n')[0]}`);
  });
  audio.proc.on('exit', (code) => {
    if (code !== 0 && code !== null) print.warn(`ffmpeg exited with code ${code}`);
  });

  // Parallel REPL for /rep, /ctx, /quit.
  const rl = readline.createInterface({ input, output, terminal: true });
  rl.on('line', (line) => {
    const cmd = line.trim();
    if (cmd === '/quit' || cmd === '/exit') {
      rl.close();
    } else if (cmd === '/ctx') {
      print.info(`context (${rolling.length} turns):`);
      for (const t of rolling.slice(-6)) print.kv(t.speaker, t.text.slice(0, 120));
    } else if (cmd === '/rep' || cmd.startsWith('/rep ')) {
      const arg = cmd.slice(4).trim();
      if (arg) {
        speakerMap.setRep(arg);
        print.ok(`rep label set to "${arg}"`);
      } else {
        print.kv('current rep', speakerMap.getRep() ?? '(none)');
      }
    }
  });

  const shutdown = async (): Promise<void> => {
    print.info('shutting down…');
    clearInterval(transcriptTimer);
    rl.close();
    await audio.stop();
    await stream.close();
    await flushTranscript(true);
    if (meetingId && opts.autoEnd !== false && wantPersist) {
      try {
        await callApi({
          method: 'POST',
          path: `/v1/meetings/${encodeURIComponent(meetingId)}/end`,
        });
        print.ok(`meeting ${meetingId} ended`);
      } catch (err) {
        if (err instanceof HttpError) print.warn(`end meeting: ${err.code}`);
      }
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
