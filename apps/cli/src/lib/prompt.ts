import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

/** Single-line prompt. Echoes input. */
export async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(question);
    return answer.trim();
  } finally {
    rl.close();
  }
}

/** Hidden prompt for passwords / tokens. Disables echo on TTY. */
export async function askHidden(question: string): Promise<string> {
  output.write(question);
  return new Promise<string>((resolve, reject) => {
    let buf = '';
    const onData = (chunk: Buffer): void => {
      const s = chunk.toString('utf8');
      for (const ch of s) {
        if (ch === '\n' || ch === '\r' || ch === '\u0004') {
          cleanup();
          output.write('\n');
          resolve(buf);
          return;
        }
        if (ch === '\u0003') {
          cleanup();
          output.write('\n');
          reject(new Error('cancelled'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') {
          buf = buf.slice(0, -1);
          continue;
        }
        buf += ch;
      }
    };
    const cleanup = (): void => {
      input.off('data', onData);
      if (input.isTTY) input.setRawMode(false);
      input.pause();
    };
    if (input.isTTY) input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}
