import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { safeFetch, SsrfBlocked } from './ssrf-guard.js';

// We exercise the guard via safeFetch — it covers the pure helper paths
// (scheme + IP-literal blocking) without making real network calls.

describe('safeFetch SSRF guard', () => {
  it('rejects non-http(s) schemes', async () => {
    await assert.rejects(safeFetch('file:///etc/passwd'), SsrfBlocked);
    await assert.rejects(safeFetch('gopher://internal:70/x'), SsrfBlocked);
    await assert.rejects(safeFetch('javascript:void(0)'), SsrfBlocked);
  });

  it('rejects malformed URLs', async () => {
    await assert.rejects(safeFetch('not-a-url'), SsrfBlocked);
  });

  it('rejects IPv4 loopback literals', async () => {
    await assert.rejects(safeFetch('http://127.0.0.1/'), SsrfBlocked);
    await assert.rejects(safeFetch('http://127.255.0.1/'), SsrfBlocked);
  });

  it('rejects IPv4 private ranges', async () => {
    await assert.rejects(safeFetch('http://10.0.0.1/'), SsrfBlocked);
    await assert.rejects(safeFetch('http://172.16.5.5/'), SsrfBlocked);
    await assert.rejects(safeFetch('http://172.31.255.255/'), SsrfBlocked);
    await assert.rejects(safeFetch('http://192.168.1.1/'), SsrfBlocked);
  });

  it('rejects IPv4 link-local + cloud metadata IP', async () => {
    await assert.rejects(safeFetch('http://169.254.169.254/latest/meta-data/'), SsrfBlocked);
    await assert.rejects(safeFetch('http://169.254.0.1/'), SsrfBlocked);
  });

  it('rejects 0.0.0.0 + multicast + reserved', async () => {
    await assert.rejects(safeFetch('http://0.0.0.0/'), SsrfBlocked);
    await assert.rejects(safeFetch('http://224.0.0.1/'), SsrfBlocked);
    await assert.rejects(safeFetch('http://240.0.0.1/'), SsrfBlocked);
  });

  it('rejects IPv6 loopback + link-local + ula + IPv4-mapped private', async () => {
    await assert.rejects(safeFetch('http://[::1]/'), SsrfBlocked);
    await assert.rejects(safeFetch('http://[fe80::1]/'), SsrfBlocked);
    await assert.rejects(safeFetch('http://[fc00::1]/'), SsrfBlocked);
    await assert.rejects(safeFetch('http://[::ffff:127.0.0.1]/'), SsrfBlocked);
    await assert.rejects(safeFetch('http://[::ffff:10.0.0.1]/'), SsrfBlocked);
  });

  it('rejects hostnames that fail to resolve', async () => {
    // .invalid is a reserved TLD per RFC 2606 — guaranteed NXDOMAIN.
    await assert.rejects(safeFetch('http://no-such-host-anywhere.invalid/'), SsrfBlocked);
  });

  it('rejects internal-style hostnames that resolve to private IPs', async () => {
    // localhost resolves to 127.0.0.1 / ::1 — must be rejected even though
    // it's a hostname not an IP literal.
    await assert.rejects(safeFetch('http://localhost/'), SsrfBlocked);
  });
});
