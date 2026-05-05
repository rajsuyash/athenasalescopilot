import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

// Set required env BEFORE importing the service module (db client needs them).
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.JWT_ACCESS_SECRET ??= 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET ??= 'b'.repeat(48);

const { generatePairingCode, isValidPairingCode } = await import('./service.js');

describe('generatePairingCode', () => {
  it('produces ATH-XXXX-XXXX with no ambiguous chars', () => {
    const code = generatePairingCode();
    assert.match(code, /^ATH-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    assert.equal(code.includes('0'), false);
    assert.equal(code.includes('1'), false);
    assert.equal(code.includes('O'), false);
    assert.equal(code.includes('I'), false);
  });

  it('does not collide trivially across 1k draws', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const c = generatePairingCode();
      assert.equal(seen.has(c), false, `dup at iteration ${i}: ${c}`);
      seen.add(c);
    }
  });
});

describe('isValidPairingCode', () => {
  it('accepts a freshly-generated code', () => {
    assert.equal(isValidPairingCode(generatePairingCode()), true);
  });

  it('rejects malformed shapes', () => {
    assert.equal(isValidPairingCode('abc'), false);
    assert.equal(isValidPairingCode('XYZ-AAAA-BBBB'), false); // wrong prefix
    assert.equal(isValidPairingCode('ATH-AAA-AAAA'), false); // wrong segment len
    assert.equal(isValidPairingCode('ATH-AAAA-1111'), false); // banned chars
    assert.equal(isValidPairingCode(''), false);
    assert.equal(isValidPairingCode('ATH-aaaa-bbbb'), false); // lowercase
  });
});
