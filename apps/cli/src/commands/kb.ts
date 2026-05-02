import { promises as fs } from 'node:fs';
import path from 'node:path';
import { callApi, HttpError, uploadFile } from '../lib/api.js';
import { loadConfig } from '../lib/config.js';
import { print } from '../lib/print.js';

interface IngestResult {
  documentId: string;
  versionId: string;
  chunkCount: number;
  duplicate: boolean;
}

interface DocSummary {
  id: string;
  name: string;
  category: string;
  status: string;
  createdAt: string;
}

const FORMATS_BY_EXT: Record<string, 'pdf' | 'csv' | 'docx' | 'markdown' | 'text'> = {
  '.pdf': 'pdf',
  '.csv': 'csv',
  '.docx': 'docx',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.txt': 'text',
};

interface AddOpts {
  file?: string;
  url?: string;
  text?: string;
  name?: string;
  category?: string;
  language?: string;
}

export async function kbAddCmd(opts: AddOpts): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg.accessToken) {
    print.err('Not signed in. Run `athena login`.');
    process.exit(1);
  }
  const inputs = [opts.file, opts.url, opts.text].filter(Boolean).length;
  if (inputs !== 1) {
    print.err('Provide exactly one of --file, --url, or --text.');
    process.exit(2);
  }

  try {
    if (opts.file) {
      const abs = path.resolve(opts.file);
      const buf = await fs.readFile(abs);
      const ext = path.extname(abs).toLowerCase();
      const format = FORMATS_BY_EXT[ext];
      if (!format) {
        print.err(`Unsupported extension: ${ext}. Supported: ${Object.keys(FORMATS_BY_EXT).join(', ')}`);
        process.exit(2);
      }
      const result = await uploadFile<IngestResult>({
        baseUrl: cfg.knowledgeUrl,
        path: '/v1/knowledge/upload',
        formFields: {
          name: opts.name ?? path.basename(abs),
          category: opts.category ?? 'product_notes',
          format,
        },
        fileBuffer: buf,
        fileName: path.basename(abs),
      });
      reportIngest(result);
      return;
    }
    if (opts.url) {
      const result = await callApi<IngestResult>({
        method: 'POST',
        baseUrl: cfg.knowledgeUrl,
        path: '/v1/knowledge/url',
        body: {
          name: opts.name ?? new URL(opts.url).hostname,
          category: opts.category ?? 'product_notes',
          format: 'url',
          url: opts.url,
          ...(opts.language ? { language: opts.language } : {}),
        },
      });
      reportIngest(result);
      return;
    }
    if (opts.text) {
      const result = await callApi<IngestResult>({
        method: 'POST',
        baseUrl: cfg.knowledgeUrl,
        path: '/v1/knowledge/text',
        body: {
          name: opts.name ?? `inline-${Date.now()}`,
          category: opts.category ?? 'product_notes',
          format: 'text',
          text: opts.text,
          ...(opts.language ? { language: opts.language } : {}),
        },
      });
      reportIngest(result);
      return;
    }
  } catch (err) {
    if (err instanceof HttpError) {
      print.err(`ingest failed: ${err.code} — ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

function reportIngest(r: IngestResult): void {
  if (r.duplicate) {
    print.warn(`Duplicate content; reused existing document ${r.documentId}`);
  } else {
    print.ok(`Ingested ${r.chunkCount} chunks → document ${r.documentId}`);
  }
}

export async function kbListCmd(): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg.accessToken) {
    print.err('Not signed in.');
    process.exit(1);
  }
  try {
    const docs = await callApi<DocSummary[]>({
      baseUrl: cfg.knowledgeUrl,
      path: '/v1/knowledge/documents',
    });
    if (docs.length === 0) {
      print.warn('No documents yet. Add one with `athena kb add --file ...`');
      return;
    }
    print.heading(`${docs.length} document(s)`);
    for (const d of docs) {
      print.kv(d.id, `${d.name} [${d.category}/${d.status}] ${d.createdAt}`);
    }
  } catch (err) {
    if (err instanceof HttpError) {
      print.err(`list failed: ${err.code}`);
      process.exit(1);
    }
    throw err;
  }
}

interface SearchHit {
  id: string;
  text: string;
  score: number;
  documentName: string | null;
  category: string | null;
}

export async function kbSearchCmd(query: string, opts: { topK?: number }): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg.accessToken) {
    print.err('Not signed in.');
    process.exit(1);
  }
  const params = new URLSearchParams({ query });
  if (opts.topK) params.set('topK', String(opts.topK));
  try {
    const r = await callApi<{ chunks: SearchHit[] }>({
      baseUrl: cfg.knowledgeUrl,
      path: `/v1/knowledge/search?${params.toString()}`,
    });
    if (r.chunks.length === 0) {
      print.warn('No matching chunks above threshold.');
      return;
    }
    print.heading(`${r.chunks.length} chunk(s)`);
    for (const c of r.chunks) {
      print.kv(
        `${c.score.toFixed(3)} ${c.documentName ?? '?'}`,
        c.text.slice(0, 220) + (c.text.length > 220 ? '…' : ''),
      );
    }
  } catch (err) {
    if (err instanceof HttpError) {
      print.err(`search failed: ${err.code}`);
      process.exit(1);
    }
    throw err;
  }
}
