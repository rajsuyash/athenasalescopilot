/**
 * Connect-page content script — one-click sign-in bridge (Fathom-style).
 *
 * Injected ONLY on the admin-web /connect-extension page (see manifest
 * content_scripts). The page mints a pairing code while the user is signed
 * in via Clerk (Google login included) and posts it to us; we forward it to
 * the SW, which claims it against the api. The user never types anything.
 *
 * Trust model:
 *  - We accept postMessage only from THIS window and THIS origin, with the
 *    page's source tag. The pairing code is single-use and 10-minute TTL.
 *  - The SW re-validates the sender (tab pinned to the connect-page origin)
 *    and the code format before claiming — a hostile page on another origin
 *    never reaches the claim path.
 */
import { PAIRING_CODE_RE, type RuntimeMessage } from '../shared/types.js';

const FROM_PAGE = 'rocket-connect-page';
const FROM_EXTENSION = 'rocket-extension';

interface PageMessage {
  source?: string;
  type?: string;
  code?: string;
}

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data = event.data as PageMessage | null;
  if (!data || data.source !== FROM_PAGE) return;
  // The page may hydrate after our load-time `ready` announcement — answer
  // pings so it can discover us regardless of load order.
  if (data.type === 'ping') {
    postToPage({ type: 'ready', version: chrome.runtime.getManifest().version });
    return;
  }
  if (data.type === 'status') {
    void chrome.runtime
      .sendMessage({ type: 'auth.statusForWeb' } satisfies RuntimeMessage)
      .then((resp: { ok?: boolean; signedIn?: boolean } | undefined) => {
        postToPage({ type: 'status-result', signedIn: !!resp?.signedIn });
      })
      .catch(() => postToPage({ type: 'status-result', signedIn: false }));
    return;
  }
  if (data.type !== 'pair') return;
  const code = typeof data.code === 'string' ? data.code.trim().toUpperCase() : '';
  if (!PAIRING_CODE_RE.test(code)) {
    postToPage({ type: 'pair-result', ok: false, error: 'bad_code' });
    return;
  }
  void chrome.runtime
    .sendMessage({ type: 'auth.pairFromWeb', code } satisfies RuntimeMessage)
    .then((resp: { ok?: boolean; error?: string } | undefined) => {
      postToPage({
        type: 'pair-result',
        ok: !!resp?.ok,
        ...(resp?.error ? { error: resp.error } : {}),
      });
    })
    .catch((err: unknown) => {
      postToPage({
        type: 'pair-result',
        ok: false,
        error: err instanceof Error ? err.message : 'extension_unreachable',
      });
    });
});

function postToPage(payload: Record<string, unknown>): void {
  window.postMessage({ source: FROM_EXTENSION, ...payload }, window.location.origin);
}

// Announce presence so the page can auto-start the handshake (and show a
// "extension not installed" hint when this never arrives).
postToPage({ type: 'ready', version: chrome.runtime.getManifest().version });
