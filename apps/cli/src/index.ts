#!/usr/bin/env node
import { signupCmd, loginCmd, logoutCmd, whoamiCmd } from './commands/auth.js';
import { kbAddCmd, kbListCmd, kbSearchCmd } from './commands/kb.js';
import { coachCmd, liveCmd } from './commands/coach.js';
import { configShowCmd, configSetCmd } from './commands/config.js';
import { listenCmd } from './commands/listen.js';
import { listenGwCmd } from './commands/listen-gw.js';
import { meetingEndCmd, meetingListCmd, meetingShowCmd, meetingStartCmd } from './commands/meeting.js';
import { recapRunCmd, recapShowCmd } from './commands/recap.js';
import { flagNumber, flagString, parseArgs } from './lib/args.js';
import { print } from './lib/print.js';

const HELP = `
Athena CLI

Usage:
  athena signup
  athena login
  athena logout
  athena whoami

  athena kb add (--file <path> | --url <url> | --text <text>)
                [--name <name>] [--category <cat>] [--language <lang>]
  athena kb list
  athena kb search <query> [--topK 5]

  athena coach "<customer question>"
  athena live
  athena listen [--device :0] [--rep "Speaker 1"] [--vocab "MEDDIC,Athena"]
                [--language en-US] [--show-all]
                [--meeting "Title"] [--meeting-id <uuid>] [--no-end]
                [--gateway]   # use realtime-gateway (server owns STT)

  athena meeting start [--title "..."]
  athena meeting end <id>
  athena meeting list [--limit 20] [--status live|completed]
  athena meeting show <id>

  athena recap run <meetingId> [--force] [--framework MEDDIC|BANT|SPICED]
  athena recap show <meetingId>

  athena config show
  athena config set <apiUrl|knowledgeUrl|orchestratorUrl|postcallUrl|gatewayUrl> <url>

Defaults:
  apiUrl           http://localhost:4000
  knowledgeUrl     http://localhost:4010
  orchestratorUrl  http://localhost:4020
  postcallUrl      http://localhost:4030
  gatewayUrl       http://localhost:4040

Tokens stored at ~/.athena/config.json (mode 0600).
`.trim();

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help' || argv[0] === 'help') {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  const parsed = parseArgs(argv);
  const [cmd, sub, ...rest] = parsed.positional;

  switch (cmd) {
    case 'signup':
      await signupCmd();
      return;
    case 'login':
      await loginCmd();
      return;
    case 'logout':
      await logoutCmd();
      return;
    case 'whoami':
      await whoamiCmd();
      return;
    case 'kb': {
      if (sub === 'add') {
        await kbAddCmd({
          ...(flagString(parsed, 'file') ? { file: flagString(parsed, 'file') } : {}),
          ...(flagString(parsed, 'url') ? { url: flagString(parsed, 'url') } : {}),
          ...(flagString(parsed, 'text') ? { text: flagString(parsed, 'text') } : {}),
          ...(flagString(parsed, 'name') ? { name: flagString(parsed, 'name') } : {}),
          ...(flagString(parsed, 'category') ? { category: flagString(parsed, 'category') } : {}),
          ...(flagString(parsed, 'language') ? { language: flagString(parsed, 'language') } : {}),
        });
        return;
      }
      if (sub === 'list') {
        await kbListCmd();
        return;
      }
      if (sub === 'search') {
        const q = rest.join(' ');
        if (!q) {
          print.err('Provide a query: `athena kb search "data retention"`');
          process.exit(2);
        }
        const topK = flagNumber(parsed, 'topK');
        await kbSearchCmd(q, topK !== undefined ? { topK } : {});
        return;
      }
      print.err(`Unknown kb subcommand: ${sub}`);
      process.exit(2);
      return;
    }
    case 'coach': {
      const q = [sub, ...rest].filter(Boolean).join(' ');
      await coachCmd(q);
      return;
    }
    case 'live':
      await liveCmd();
      return;
    case 'listen': {
      const vocabStr = flagString(parsed, 'vocab');
      const useGateway = parsed.flags.gateway === true;
      if (useGateway) {
        await listenGwCmd({
          ...(flagString(parsed, 'device') ? { device: flagString(parsed, 'device') } : {}),
          ...(flagNumber(parsed, 'sample-rate') !== undefined
            ? { sampleRate: flagNumber(parsed, 'sample-rate') }
            : {}),
          ...(flagString(parsed, 'ffmpeg') ? { ffmpeg: flagString(parsed, 'ffmpeg') } : {}),
          ...(flagString(parsed, 'rep') ? { rep: flagString(parsed, 'rep') } : {}),
          ...(flagString(parsed, 'language') ? { language: flagString(parsed, 'language') } : {}),
          ...(vocabStr
            ? { vocabulary: vocabStr.split(',').map((s) => s.trim()).filter(Boolean) }
            : {}),
          ...(parsed.flags['show-all'] === true ? { showAll: true } : {}),
          ...(flagString(parsed, 'meeting') ? { meetingTitle: flagString(parsed, 'meeting') } : {}),
          ...(flagString(parsed, 'meeting-id') ? { meetingId: flagString(parsed, 'meeting-id') } : {}),
          ...(parsed.flags['no-end'] === true ? { autoEnd: false } : {}),
        });
        return;
      }
      await listenCmd({
        ...(flagString(parsed, 'device') ? { device: flagString(parsed, 'device') } : {}),
        ...(flagNumber(parsed, 'sample-rate') !== undefined
          ? { sampleRate: flagNumber(parsed, 'sample-rate') }
          : {}),
        ...(flagString(parsed, 'ffmpeg') ? { ffmpeg: flagString(parsed, 'ffmpeg') } : {}),
        ...(flagString(parsed, 'rep') ? { rep: flagString(parsed, 'rep') } : {}),
        ...(flagString(parsed, 'language') ? { language: flagString(parsed, 'language') } : {}),
        ...(flagString(parsed, 'deepgram-key')
          ? { deepgramApiKey: flagString(parsed, 'deepgram-key') }
          : {}),
        ...(vocabStr
          ? { vocabulary: vocabStr.split(',').map((s) => s.trim()).filter(Boolean) }
          : {}),
        ...(parsed.flags['show-all'] === true ? { showAll: true } : {}),
        ...(flagString(parsed, 'meeting') ? { meetingTitle: flagString(parsed, 'meeting') } : {}),
        ...(flagString(parsed, 'meeting-id') ? { meetingId: flagString(parsed, 'meeting-id') } : {}),
        ...(parsed.flags['no-end'] === true ? { autoEnd: false } : {}),
      });
      return;
    }
    case 'meeting': {
      if (sub === 'start') {
        await meetingStartCmd({
          ...(flagString(parsed, 'title') ? { title: flagString(parsed, 'title') } : {}),
        });
        return;
      }
      if (sub === 'end') {
        const [id] = rest;
        if (!id) {
          print.err('Usage: athena meeting end <id>');
          process.exit(2);
        }
        await meetingEndCmd(id);
        return;
      }
      if (sub === 'list') {
        const limit = flagNumber(parsed, 'limit');
        await meetingListCmd({
          ...(limit !== undefined ? { limit } : {}),
          ...(flagString(parsed, 'status') ? { status: flagString(parsed, 'status') } : {}),
        });
        return;
      }
      if (sub === 'show') {
        const [id] = rest;
        if (!id) {
          print.err('Usage: athena meeting show <id>');
          process.exit(2);
        }
        await meetingShowCmd(id);
        return;
      }
      print.err(`Unknown meeting subcommand: ${sub}`);
      process.exit(2);
      return;
    }
    case 'recap': {
      const [id] = rest;
      if (sub === 'run') {
        if (!id) {
          print.err('Usage: athena recap run <meetingId>');
          process.exit(2);
        }
        await recapRunCmd(id, {
          ...(parsed.flags.force === true ? { force: true } : {}),
          ...(flagString(parsed, 'framework') ? { framework: flagString(parsed, 'framework') } : {}),
        });
        return;
      }
      if (sub === 'show') {
        if (!id) {
          print.err('Usage: athena recap show <meetingId>');
          process.exit(2);
        }
        await recapShowCmd(id);
        return;
      }
      print.err(`Unknown recap subcommand: ${sub}`);
      process.exit(2);
      return;
    }
    case 'config': {
      if (sub === 'show') {
        await configShowCmd();
        return;
      }
      if (sub === 'set') {
        const [key, value] = rest;
        if (!key || !value) {
          print.err('Usage: athena config set <key> <value>');
          process.exit(2);
        }
        await configSetCmd(key, value);
        return;
      }
      print.err(`Unknown config subcommand: ${sub}`);
      process.exit(2);
      return;
    }
    default:
      print.err(`Unknown command: ${cmd}`);
      process.stdout.write(`${HELP}\n`);
      process.exit(2);
  }
}

main().catch((err: unknown) => {
  if (err instanceof Error) print.err(err.message);
  else print.err(String(err));
  process.exit(1);
});
