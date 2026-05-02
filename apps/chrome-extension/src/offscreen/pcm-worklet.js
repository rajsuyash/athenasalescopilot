/**
 * Athena PCM encoder worklet.
 *
 * Receives Float32 audio frames from the AudioContext, downsamples to 16 kHz
 * via linear interpolation if the host context is at a higher rate, converts
 * to little-endian Int16, and posts ArrayBuffer batches of ~20 ms (~320
 * samples) up to the offscreen document. The offscreen doc forwards each
 * batch as a binary WebSocket frame to the gateway. Matches the wire format
 * `apps/cli/src/lib/audio.ts` produces via ffmpeg (`pcm_s16le @ 16 kHz mono`).
 */
const TARGET_RATE = 16000;
const BATCH_SAMPLES = 320; // 20 ms @ 16 kHz

class PcmEncoder extends AudioWorkletProcessor {
  constructor() {
    super();
    this._inputRate = sampleRate; // global from AudioWorkletGlobalScope
    this._ratio = this._inputRate / TARGET_RATE;
    this._buf = new Int16Array(BATCH_SAMPLES);
    this._bufLen = 0;
    this._readPos = 0; // fractional read position into the rolling float buffer
    this._tail = new Float32Array(0);
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    // Mix down to mono by averaging channels.
    const ch0 = input[0];
    if (!ch0) return true;
    const frames = ch0.length;
    let mono = ch0;
    if (input.length > 1) {
      mono = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < input.length; c++) sum += input[c][i];
        mono[i] = sum / input.length;
      }
    }
    // Concatenate with leftover tail from prior callback.
    const merged = new Float32Array(this._tail.length + mono.length);
    merged.set(this._tail, 0);
    merged.set(mono, this._tail.length);
    // Downsample by stepping with this._ratio. Linear interp.
    let pos = this._readPos;
    while (pos + 1 < merged.length) {
      const i = Math.floor(pos);
      const frac = pos - i;
      const sample = merged[i] * (1 - frac) + merged[i + 1] * frac;
      const clipped = Math.max(-1, Math.min(1, sample));
      this._buf[this._bufLen++] = clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff;
      if (this._bufLen >= BATCH_SAMPLES) {
        // Send a copy so the worklet can keep mutating its own buffer.
        const out = new ArrayBuffer(this._buf.byteLength);
        new Int16Array(out).set(this._buf);
        this.port.postMessage(out, [out]);
        this._bufLen = 0;
      }
      pos += this._ratio;
    }
    // Keep the unread tail for the next callback.
    const consumed = Math.floor(pos);
    this._tail = merged.slice(consumed);
    this._readPos = pos - consumed;
    return true;
  }
}

registerProcessor('pcm-encoder', PcmEncoder);
