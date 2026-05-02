import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { flagNumber, flagString, parseArgs } from './args.js';

describe('parseArgs', () => {
  it('parses positional + flags with space and equals', () => {
    const p = parseArgs(['kb', 'add', '--file', '/x.pdf', '--category=security', '--force']);
    assert.deepEqual(p.positional, ['kb', 'add']);
    assert.equal(p.flags.file, '/x.pdf');
    assert.equal(p.flags.category, 'security');
    assert.equal(p.flags.force, true);
  });

  it('flagNumber parses', () => {
    const p = parseArgs(['kb', 'search', '--topK', '7']);
    assert.equal(flagNumber(p, 'topK'), 7);
    assert.equal(flagString(p, 'topK'), '7');
  });

  it('flagNumber undefined when missing', () => {
    const p = parseArgs(['x']);
    assert.equal(flagNumber(p, 'topK'), undefined);
  });

  it('treats --foo --bar as flag-only foo', () => {
    const p = parseArgs(['--foo', '--bar', 'baz']);
    assert.equal(p.flags.foo, true);
    assert.equal(p.flags.bar, 'baz');
  });
});
