import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';

type FfmpegProcess = ChildProcessByStdio<null, Readable, Readable>;

export interface AudioSourceOpts {
  /** ffmpeg avfoundation device spec, e.g. ":0" (default mic), ":1" (BlackHole). */
  device: string;
  sampleRate: number;
  /** Path or name of ffmpeg. Defaults to "ffmpeg". */
  ffmpeg?: string;
}

export interface AudioSource {
  /** Spawned ffmpeg process — kill() to stop capture. */
  proc: FfmpegProcess;
  /** Stop capture and wait for the process to exit. */
  stop(): Promise<void>;
}

/**
 * Start ffmpeg capturing from the macOS avfoundation input and emitting raw
 * 16-bit signed mono PCM at `sampleRate` to stdout.
 *
 * Caller pipes `proc.stdout` chunks into the STT push() handler.
 *
 * macOS-only by design (PRD §3 in-scope OS). For Linux/Windows we'd swap the
 * input format (`alsa`/`dshow`); not in v1.
 */
export function startAudioCapture(opts: AudioSourceOpts): AudioSource {
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'avfoundation',
    '-i',
    opts.device,
    '-ac',
    '1',
    '-ar',
    String(opts.sampleRate),
    '-acodec',
    'pcm_s16le',
    '-f',
    's16le',
    '-',
  ];
  const proc = spawn(opts.ffmpeg ?? 'ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

  return {
    proc,
    async stop(): Promise<void> {
      if (proc.killed) return;
      proc.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          if (!proc.killed) proc.kill('SIGKILL');
          resolve();
        }, 1500);
        proc.once('exit', () => {
          clearTimeout(t);
          resolve();
        });
      });
    },
  };
}

/**
 * Heuristic mapping speaker label → rep | customer | unknown.
 *
 * macOS mic-only setups will see one speaker (`Speaker 0`) — that's the rep.
 * With BlackHole + multi-output piping the meeting audio in, Deepgram diarizes
 * across both channels and we get `Speaker 0`/`Speaker 1`/...
 *
 * Convention used here: the FIRST speaker we ever see in a session is the rep
 * (because the rep usually opens the call). Every other speaker is the
 * customer. Manually overrideable via the CLI's `/rep <label>` command.
 */
export class SpeakerMapper {
  private repLabel: string | null = null;
  private readonly forcedRep: string | null;

  constructor(forcedRep: string | null = null) {
    this.forcedRep = forcedRep;
    if (forcedRep) this.repLabel = forcedRep;
  }

  classify(label: string): 'rep' | 'customer' {
    if (this.forcedRep) return label === this.forcedRep ? 'rep' : 'customer';
    if (this.repLabel === null) {
      this.repLabel = label;
      return 'rep';
    }
    return label === this.repLabel ? 'rep' : 'customer';
  }

  setRep(label: string): void {
    this.repLabel = label;
  }

  getRep(): string | null {
    return this.repLabel;
  }
}
