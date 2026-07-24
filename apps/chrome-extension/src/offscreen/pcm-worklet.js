/**
 * Rocket PCM encoder worklet.
 *
 * Receives Float32 audio frames from the AudioContext, downsamples to 16 kHz
 * via linear interpolation if the host context is at a higher rate, converts
 * to little-endian Int16, and posts ArrayBuffer batches of ~20 ms (~320
 * frames) up to the offscreen document. The offscreen doc forwards each batch
 * as a binary WebSocket frame to the gateway.
 *
 * F17: channel-preserving. When the input has 2 channels (tab audio on ch0,
 * rep mic on ch1 — see offscreen/index.ts ChannelMerger routing) it emits
 * INTERLEAVED stereo PCM (L0 R0 L1 R1 …) so Deepgram multichannel can attribute
 * speaker→role by channel. A 1-channel input emits mono, unchanged. Both
 * channels resample against a shared read position so they stay aligned.
 */
const TARGET_RATE = 16000;
const BATCH_FRAMES = 320; // 20 ms @ 16 kHz, per channel

class PcmEncoder extends AudioWorkletProcessor {
  constructor() {
    super();
    this._ratio = sampleRate / TARGET_RATE; // global from AudioWorkletGlobalScope
    this._channels = 1;
    this._tails = [new Float32Array(0)];
    this._readPos = 0; // fractional read position, shared across channels
    // Interleaved output, sized for the stereo worst case.
    this._buf = new Int16Array(BATCH_FRAMES * 2);
    this._frames = 0; // frames accumulated in _buf
  }

  _flush(channels) {
    const used = this._frames * channels;
    const out = new ArrayBuffer(used * 2); // Int16 = 2 bytes
    new Int16Array(out).set(this._buf.subarray(0, used));
    this.port.postMessage(out, [out]);
    this._frames = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) return true;
    const channels = Math.min(2, input.length);
    if (channels !== this._channels) {
      // Channel count settled (first callback, or a graph change) — reset the
      // per-channel tails and the in-flight batch so we never interleave a
      // stale mono tail into a stereo frame.
      this._channels = channels;
      this._tails = Array.from({ length: channels }, () => new Float32Array(0));
      this._readPos = 0;
      this._frames = 0;
    }
    const frameLen = input[0].length;

    // Concatenate each channel with its leftover tail from the prior callback.
    const merged = [];
    for (let c = 0; c < channels; c++) {
      const ch = input[c] ?? input[0];
      const m = new Float32Array(this._tails[c].length + frameLen);
      m.set(this._tails[c], 0);
      m.set(ch, this._tails[c].length);
      merged.push(m);
    }

    const len = merged[0].length;
    let pos = this._readPos;
    while (pos + 1 < len) {
      const i = Math.floor(pos);
      const frac = pos - i;
      const base = this._frames * channels;
      for (let c = 0; c < channels; c++) {
        const sample = merged[c][i] * (1 - frac) + merged[c][i + 1] * frac;
        const clipped = Math.max(-1, Math.min(1, sample));
        this._buf[base + c] = clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff;
      }
      this._frames++;
      if (this._frames >= BATCH_FRAMES) this._flush(channels);
      pos += this._ratio;
    }

    // Keep the unread tail (same cut point for every channel → stays aligned).
    const consumed = Math.floor(pos);
    for (let c = 0; c < channels; c++) this._tails[c] = merged[c].slice(consumed);
    this._readPos = pos - consumed;
    return true;
  }
}

registerProcessor('pcm-encoder', PcmEncoder);
