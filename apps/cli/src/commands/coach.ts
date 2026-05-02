import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import kleur from 'kleur';
import { callApi, HttpError } from '../lib/api.js';
import { loadConfig } from '../lib/config.js';
import { box, print, wrap } from '../lib/print.js';

interface CoachResponse {
  intent: {
    categories: string[];
    stageSignal: string;
    urgencyScore: number;
    confidence: number;
    source: string;
  };
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

interface CoachContextTurn {
  speaker: 'rep' | 'customer' | 'unknown';
  text: string;
}

async function callOrchestrator(
  customerText: string,
  context: CoachContextTurn[],
): Promise<CoachResponse> {
  const cfg = await loadConfig();
  if (!cfg.accessToken) {
    print.err('Not signed in. Run `athena login`.');
    process.exit(1);
  }
  return callApi<CoachResponse>({
    method: 'POST',
    baseUrl: cfg.orchestratorUrl,
    path: '/v1/orchestrator/suggest',
    body: { customerText, contextTurns: context.slice(-6) },
  });
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

function renderSuggestion(r: CoachResponse): void {
  const s = r.suggestion;
  const lines: string[] = [];
  if (s.answerText) {
    lines.push(...wrap(s.answerText, 76));
  }
  if (s.followupText) {
    if (lines.length > 0) lines.push('');
    lines.push(kleur.dim('Ask next:'));
    lines.push(...wrap(s.followupText, 76));
  }
  if (lines.length === 0) {
    lines.push(kleur.dim('(no displayable suggestion — see rationale)'));
  }
  lines.push('');
  lines.push(
    kleur.dim(
      `confidence=${s.confidenceScore.toFixed(2)}  priority=${s.priorityScore.toFixed(2)}  type=${s.type}  display=${s.display}`,
    ),
  );
  lines.push(kleur.dim(`intent=${r.intent.categories.join(',')}  stage=${r.intent.stageSignal}  urgency=${r.intent.urgencyScore.toFixed(2)}  src=${r.intent.source}`));
  if (s.sources.length > 0) {
    lines.push(kleur.dim('source:'));
    for (const src of s.sources) {
      lines.push(kleur.dim(`  • ${src.documentName ?? '?'} (score=${src.score.toFixed(2)})`));
    }
  }
  lines.push(kleur.dim(`rationale: ${s.rationale}`));
  box(s.type.toUpperCase(), lines, colorForType(s.type));
}

export async function coachCmd(question: string): Promise<void> {
  if (!question.trim()) {
    print.err('Provide a customer question, e.g. `athena coach "What is your data retention policy?"`');
    process.exit(2);
  }
  try {
    const r = await callOrchestrator(question, []);
    renderSuggestion(r);
  } catch (err) {
    if (err instanceof HttpError) {
      print.err(`coach failed: ${err.code} — ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

/**
 * Live coaching REPL. Type each customer turn (or your own with `me:`) and the
 * orchestrator returns a grounded suggestion. Maintains a rolling context of
 * the last 6 turns. Designed to run in a second terminal during a real call.
 */
export async function liveCmd(): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg.accessToken) {
    print.err('Not signed in. Run `athena login`.');
    process.exit(1);
  }

  print.heading('Athena live coach');
  print.info('Each line is a customer turn. Prefix with "me:" to log a rep turn.');
  print.info('Commands: /reset, /quit. Ctrl-C to exit.');
  print.blank();

  const rl = readline.createInterface({ input, output, terminal: true });
  rl.setPrompt(kleur.cyan('customer › '));
  rl.prompt();

  const context: CoachContextTurn[] = [];

  rl.on('line', async (raw) => {
    const line = raw.trim();
    if (!line) {
      rl.prompt();
      return;
    }
    if (line === '/quit' || line === '/exit') {
      rl.close();
      return;
    }
    if (line === '/reset') {
      context.length = 0;
      print.ok('Context cleared.');
      rl.prompt();
      return;
    }

    let speaker: 'rep' | 'customer' = 'customer';
    let text = line;
    if (line.startsWith('me:')) {
      speaker = 'rep';
      text = line.slice(3).trim();
      if (!text) {
        rl.prompt();
        return;
      }
      context.push({ speaker, text });
      print.info(`logged rep turn (context size=${context.length})`);
      rl.prompt();
      return;
    }

    context.push({ speaker, text });
    try {
      const r = await callOrchestrator(text, context);
      renderSuggestion(r);
    } catch (err) {
      if (err instanceof HttpError) {
        print.err(`${err.code} — ${err.message}`);
      } else {
        print.err(String(err));
      }
    }
    rl.prompt();
  });

  rl.on('close', () => {
    print.info('bye');
    process.exit(0);
  });
}
