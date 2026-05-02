import kleur from 'kleur';

export const print = {
  ok(msg: string): void {
    process.stdout.write(`${kleur.green('✓')} ${msg}\n`);
  },
  warn(msg: string): void {
    process.stdout.write(`${kleur.yellow('⚠')} ${msg}\n`);
  },
  err(msg: string): void {
    process.stderr.write(`${kleur.red('✗')} ${msg}\n`);
  },
  info(msg: string): void {
    process.stdout.write(`${kleur.dim('·')} ${msg}\n`);
  },
  blank(): void {
    process.stdout.write('\n');
  },
  heading(msg: string): void {
    process.stdout.write(`${kleur.bold().cyan(msg)}\n`);
  },
  kv(k: string, v: string): void {
    process.stdout.write(`  ${kleur.dim(k)}: ${v}\n`);
  },
};

/** Box drawing for the live overlay output. */
export function box(title: string, lines: string[], color: 'cyan' | 'green' | 'yellow' | 'red' = 'cyan'): void {
  const width = Math.max(title.length + 4, ...lines.map((l) => l.length)) + 2;
  const top = `╭${'─'.repeat(width)}╮`;
  const bot = `╰${'─'.repeat(width)}╯`;
  const titleLine = `│ ${title.padEnd(width - 2)} │`;
  const sep = `├${'─'.repeat(width)}┤`;
  const c = kleur[color];
  process.stdout.write(`${c(top)}\n${c(titleLine)}\n${c(sep)}\n`);
  for (const l of lines) {
    process.stdout.write(`${c('│')} ${l.padEnd(width - 2)} ${c('│')}\n`);
  }
  process.stdout.write(`${c(bot)}\n`);
}

export function wrap(text: string, width = 76): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (line.length + word.length + 1 > width) {
        if (line) out.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}
