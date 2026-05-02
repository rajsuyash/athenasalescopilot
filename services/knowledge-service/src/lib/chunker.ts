/**
 * Sentence-aware text chunker. Targets ~500 tokens per chunk with ~50-token
 * overlap (PRD F7). Token count is approximated as 1 token ≈ 0.75 words for
 * English; precise enough for chunk sizing without pulling a tokenizer dep.
 */

export interface ChunkOptions {
  /** Target chunk size in *tokens* (approx). */
  targetTokens?: number;
  /** Overlap between adjacent chunks in *tokens* (approx). */
  overlapTokens?: number;
}

export interface Chunk {
  text: string;
  order: number;
  approxTokens: number;
}

const DEFAULT_TARGET = 500;
const DEFAULT_OVERLAP = 50;

const WORDS_PER_TOKEN = 0.75; // English approximation

function approxTokensFor(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.ceil(words / WORDS_PER_TOKEN);
}

function splitSentences(text: string): string[] {
  // Cheap sentence splitter: break on .?! followed by whitespace + capital, plus
  // newline groups. Avoid pulling NLP libs.
  const normalized = text.replace(/\s+/g, ' ').trim();
  const out: string[] = [];
  const re = /[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized)) !== null) {
    const s = m[0].trim();
    if (s) out.push(s);
  }
  return out;
}

export function chunkText(text: string, opts: ChunkOptions = {}): Chunk[] {
  const target = opts.targetTokens ?? DEFAULT_TARGET;
  const overlap = Math.min(opts.overlapTokens ?? DEFAULT_OVERLAP, target - 1);
  if (target <= 0) throw new Error('targetTokens must be > 0');

  const sentences = splitSentences(text);
  if (sentences.length === 0) return [];

  const chunks: Chunk[] = [];
  let buf: string[] = [];
  let bufTokens = 0;
  let order = 0;

  const flush = () => {
    if (buf.length === 0) return;
    const joined = buf.join(' ');
    chunks.push({ text: joined, order: order++, approxTokens: bufTokens });
  };

  for (const sentence of sentences) {
    const sTokens = approxTokensFor(sentence);
    // Sentence alone exceeds target — emit on its own (preserve content).
    if (sTokens >= target) {
      flush();
      buf = [];
      bufTokens = 0;
      chunks.push({ text: sentence, order: order++, approxTokens: sTokens });
      continue;
    }
    if (bufTokens + sTokens > target) {
      flush();
      // seed next buffer with last `overlap` tokens worth of sentences
      const tail: string[] = [];
      let tailTokens = 0;
      for (let i = buf.length - 1; i >= 0; i--) {
        const s = buf[i];
        if (s === undefined) break;
        const t = approxTokensFor(s);
        if (tailTokens + t > overlap) break;
        tail.unshift(s);
        tailTokens += t;
      }
      buf = tail;
      bufTokens = tailTokens;
    }
    buf.push(sentence);
    bufTokens += sTokens;
  }
  flush();

  return chunks;
}

/** SHA-256 of normalized text — used as a deduplication key for documents. */
export function contentHash(text: string): string {
  // node:crypto isn't imported here to keep the module pure; the caller hashes.
  return text; // placeholder, real impl in ingest service
}
