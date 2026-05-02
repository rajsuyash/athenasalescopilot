/**
 * Plain-text extraction from supported upload formats. Keep this file
 * dependency-light; PDF parsing only loaded on demand.
 */

export type SupportedFormat = 'text' | 'markdown' | 'pdf' | 'csv' | 'docx' | 'url';

export interface ExtractInput {
  format: SupportedFormat;
  buffer?: Buffer;
  /** For format=url. */
  url?: string;
  /** For format=text/markdown when caller already has text. */
  text?: string;
}

export interface ExtractResult {
  text: string;
  format: SupportedFormat;
  pageCount?: number;
}

const MAX_BYTES = 50 * 1024 * 1024; // PRD F7: 50 MB upload cap

export async function extractText(input: ExtractInput): Promise<ExtractResult> {
  if (input.buffer && input.buffer.byteLength > MAX_BYTES) {
    throw Object.assign(new Error('FILE_TOO_LARGE'), { statusCode: 413 });
  }
  switch (input.format) {
    case 'text':
    case 'markdown':
      return {
        text: input.text ?? input.buffer?.toString('utf8') ?? '',
        format: input.format,
      };
    case 'csv':
      return { text: input.buffer?.toString('utf8') ?? input.text ?? '', format: 'csv' };
    case 'pdf': {
      if (!input.buffer) throw new Error('pdf requires buffer');
      // Lazy import — pdf-parse pulls a sizable chain.
      const mod = await import('pdf-parse');
      const fn: (buf: Buffer) => Promise<{ text: string; numpages: number }> =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mod as any).default ?? (mod as any);
      const r = await fn(input.buffer);
      return { text: r.text, format: 'pdf', pageCount: r.numpages };
    }
    case 'docx':
      throw Object.assign(new Error('docx ingestion not yet implemented'), { statusCode: 415 });
    case 'url': {
      if (!input.url) throw new Error('url requires url');
      const res = await fetch(input.url, { redirect: 'follow' });
      if (!res.ok) throw Object.assign(new Error(`URL_FETCH_${res.status}`), { statusCode: 422 });
      const text = await res.text();
      return { text, format: 'url' };
    }
  }
}
