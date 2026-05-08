/**
 * SSRF guard for any caller fetching a user-supplied URL.
 *
 * The /v1/knowledge/url ingestion path lets an authenticated workspace user
 * hand us a URL that we then fetch server-side. Without this guard the user
 * could point us at:
 *   - internal services (http://api:4000, http://orchestrator:4020, …)
 *   - cloud metadata (http://169.254.169.254/…)
 *   - private network ranges (10.x, 172.16-31.x, 192.168.x)
 *   - localhost / loopback
 *   - attacker-controlled redirects to any of the above
 *
 * Defense in depth:
 *   1. Scheme allowlist (http/https only).
 *   2. Hostname → IP resolution + reject private/loopback/link-local ranges.
 *   3. Manual redirect handling: re-validate every Location target.
 *   4. Hard byte cap + AbortSignal timeout.
 */
import { promises as dns } from 'node:dns';
import { BlockList, isIP } from 'node:net';

export class SsrfBlocked extends Error {
  constructor(reason: string) {
    super(`SSRF blocked: ${reason}`);
    this.name = 'SsrfBlocked';
  }
}

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);
const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Block list covering every IP range we never want server-side fetch to reach.
 * Node's BlockList canonicalizes addresses (IPv4-mapped IPv6 ::ffff:127.0.0.1
 * → 127.0.0.1, hex-compressed ::ffff:7f00:1 → 127.0.0.1, etc.) so a single
 * IPv4 rule catches every URL-parser canonical form.
 */
const BLOCKED = new BlockList();
// IPv4 reserved ranges
BLOCKED.addSubnet('0.0.0.0', 8, 'ipv4'); // current network
BLOCKED.addSubnet('10.0.0.0', 8, 'ipv4'); // private
BLOCKED.addSubnet('100.64.0.0', 10, 'ipv4'); // carrier-grade NAT
BLOCKED.addSubnet('127.0.0.0', 8, 'ipv4'); // loopback
BLOCKED.addSubnet('169.254.0.0', 16, 'ipv4'); // link-local + cloud metadata
BLOCKED.addSubnet('172.16.0.0', 12, 'ipv4'); // private
BLOCKED.addSubnet('192.0.0.0', 24, 'ipv4'); // IETF protocol assignments
BLOCKED.addSubnet('192.168.0.0', 16, 'ipv4'); // private
BLOCKED.addSubnet('224.0.0.0', 4, 'ipv4'); // multicast
BLOCKED.addSubnet('240.0.0.0', 4, 'ipv4'); // reserved
// IPv6 reserved ranges
BLOCKED.addAddress('::', 'ipv6'); // unspecified
BLOCKED.addAddress('::1', 'ipv6'); // loopback
BLOCKED.addSubnet('fc00::', 7, 'ipv6'); // unique-local
BLOCKED.addSubnet('fe80::', 10, 'ipv6'); // link-local
BLOCKED.addSubnet('ff00::', 8, 'ipv6'); // multicast

function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 0) return true;
  return BLOCKED.check(ip, v === 4 ? 'ipv4' : 'ipv6');
}

async function assertHostAllowed(hostname: string): Promise<void> {
  // Strip surrounding brackets from IPv6 literals.
  const host = hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    if (isBlockedIp(host)) {
      throw new SsrfBlocked(`IP literal ${host} is in a blocked range`);
    }
    return;
  }
  // Resolve A + AAAA. Reject if ANY resolved address is in a blocked range —
  // a hostname with a mix of public + private IPs (DNS rebinding setup) is
  // unsafe to fetch.
  const records = await dns
    .lookup(host, { all: true, verbatim: true })
    .catch(() => [] as Array<{ address: string }>);
  if (records.length === 0) {
    throw new SsrfBlocked(`hostname ${host} did not resolve`);
  }
  for (const r of records) {
    if (isBlockedIp(r.address)) {
      throw new SsrfBlocked(`hostname ${host} resolves to blocked IP ${r.address}`);
    }
  }
}

export interface SafeFetchOpts {
  /** Hard byte cap on the response body. Default 5 MB. */
  maxBytes?: number;
  /** Per-request timeout. Default 10 s. */
  timeoutMs?: number;
}

export interface SafeFetchResult {
  status: number;
  contentType: string | null;
  text: string;
  finalUrl: string;
}

/**
 * Fetches an external URL with SSRF protection. Manually walks redirects so
 * each Location target is re-validated against the host allowlist — Node's
 * built-in `redirect: 'follow'` doesn't expose hooks for that.
 */
export async function safeFetch(
  rawUrl: string,
  opts: SafeFetchOpts = {},
): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let currentUrl: URL;
  try {
    currentUrl = new URL(rawUrl);
  } catch {
    throw new SsrfBlocked('malformed URL');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!ALLOWED_SCHEMES.has(currentUrl.protocol)) {
        throw new SsrfBlocked(`scheme ${currentUrl.protocol} not allowed`);
      }
      await assertHostAllowed(currentUrl.hostname);

      const res = await fetch(currentUrl, {
        redirect: 'manual',
        signal: controller.signal,
      });

      // 3xx with a Location header → validate and follow.
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) {
          throw new SsrfBlocked(`redirect status ${res.status} without Location`);
        }
        if (hop === MAX_REDIRECTS) {
          throw new SsrfBlocked(`exceeded ${MAX_REDIRECTS} redirects`);
        }
        try {
          currentUrl = new URL(loc, currentUrl);
        } catch {
          throw new SsrfBlocked(`malformed redirect Location: ${loc}`);
        }
        continue;
      }

      // Read the body with a hard byte cap so a multi-GB response can't OOM us.
      const reader = res.body?.getReader();
      let received = 0;
      const chunks: Uint8Array[] = [];
      if (reader) {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            received += value.byteLength;
            if (received > maxBytes) {
              try {
                await reader.cancel();
              } catch {
                /* best-effort */
              }
              throw new SsrfBlocked(`response exceeded ${maxBytes} bytes`);
            }
            chunks.push(value);
          }
        }
      }
      const buf = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
      return {
        status: res.status,
        contentType: res.headers.get('content-type'),
        text: buf.toString('utf8'),
        finalUrl: currentUrl.toString(),
      };
    }
    throw new SsrfBlocked(`exceeded ${MAX_REDIRECTS} redirects`);
  } finally {
    clearTimeout(timer);
  }
}
