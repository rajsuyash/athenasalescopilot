import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The worklet runs in AudioWorkletGlobalScope (no imports, special globals).
// Load its source with those globals stubbed so we can unit-test the audio
// math — interleaving + Int16 conversion + channel alignment — without a
// browser.
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'pcm-worklet.js'), 'utf8');

function loadProcessor(sampleRate = 16000) {
  let Registered;
  const AudioWorkletProcessor = class {};
  const registerProcessor = (_name, cls) => {
    Registered = cls;
  };
  // eslint-disable-next-line no-new-func
  new Function('sampleRate', 'AudioWorkletProcessor', 'registerProcessor', src)(
    sampleRate,
    AudioWorkletProcessor,
    registerProcessor,
  );
  return new Registered();
}

function drive(proc, channels, blocks, blockLen = 128) {
  const posted = [];
  proc.port = { postMessage: (buf) => posted.push(new Int16Array(buf.slice(0))) };
  for (let b = 0; b < blocks; b++) {
    const input = channels.map((v) => new Float32Array(blockLen).fill(v));
    proc.process([input]);
  }
  return posted;
}

const I16 = (v) => (v < 0 ? Math.trunc(v * 0x8000) : Math.trunc(v * 0x7fff));

test('stereo: output is interleaved L,R with distinct channels', () => {
  const proc = loadProcessor(16000);
  // ch0 (tab/customer) = +0.5, ch1 (mic/rep) = -0.5.
  const posted = drive(proc, [0.5, -0.5], 4);
  assert.ok(posted.length >= 1, 'expected at least one flushed batch');
  const buf = posted[0];
  assert.equal(buf.length, 320 * 2, 'stereo batch = 320 frames * 2 channels');
  // Even indices = ch0, odd = ch1 — the two speakers stay separated.
  assert.equal(buf[0], I16(0.5));
  assert.equal(buf[1], I16(-0.5));
  assert.equal(buf[2], I16(0.5));
  assert.equal(buf[3], I16(-0.5));
});

test('mono: output is a single-channel batch, unchanged behavior', () => {
  const proc = loadProcessor(16000);
  const posted = drive(proc, [0.25], 4);
  assert.ok(posted.length >= 1);
  const buf = posted[0];
  assert.equal(buf.length, 320, 'mono batch = 320 frames');
  assert.equal(buf[0], I16(0.25));
  assert.equal(buf[1], I16(0.25));
});
