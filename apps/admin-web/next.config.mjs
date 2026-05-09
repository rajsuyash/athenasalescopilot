/**
 * Content Security Policy.
 *
 * Why explicit: Chrome warns "'script-src' was not explicitly set, so
 * 'default-src' is used as a fallback" on every page when CSP is partial.
 * Setting an explicit policy here silences that warning AND establishes a
 * baseline for future hardening (move to nonces in a follow-up — needs
 * middleware integration).
 *
 * Notes on what's allowed:
 *   - script-src: 'self' for Next chunks; *.clerk.accounts.dev + *.accounts.dev
 *     for Clerk's hosted JS bundles (clerk-js, ui); 'unsafe-inline' +
 *     'unsafe-eval' because Next.js inlines hydration scripts and Clerk's
 *     SDK uses Function() in some paths. Tightening to nonces is a separate
 *     PR.
 *   - connect-src: Railway hostnames for the api/realtime/knowledge services
 *     plus Clerk's frontend API.
 *   - img-src + frame-src: Clerk renders provider icons + occasional iframes.
 *   - frame-ancestors 'none': defends against clickjacking.
 *
 * If we later move Clerk to a custom domain (accounts.rocketsalesagent.com),
 * append it to script-src/connect-src/frame-src.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.clerk.accounts.dev https://*.accounts.dev https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.clerk.accounts.dev https://*.accounts.dev https://*.up.railway.app wss://*.up.railway.app https://challenges.cloudflare.com",
  "frame-src 'self' https://*.clerk.accounts.dev https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://*.clerk.accounts.dev",
  "object-src 'none'",
  'upgrade-insecure-requests',
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        // Apply to every route. Static assets (images, fonts) get the same
        // headers — Chrome ignores CSP on most non-HTML responses, so the
        // only meaningful application is HTML + JS/CSS responses.
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: CSP },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
