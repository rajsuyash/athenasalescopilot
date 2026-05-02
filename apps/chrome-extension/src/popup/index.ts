/**
 * Popup — pure DOM. Status + settings (token paste + caption shipping toggle).
 */
import {
  DEFAULT_SETTINGS,
  type ActiveMeeting,
  type CaptionStats,
  type CaptureStatus,
  type ExtensionSettings,
  type InboxNotification,
  type RuntimeMessage,
} from '../shared/types.js';

interface QueryResponse {
  active: ActiveMeeting | null;
  settings: ExtensionSettings;
  captionStats: CaptionStats | null;
  inbox: InboxNotification[];
  capture: CaptureStatus | null;
}

const root = document.getElementById('root');

async function load(): Promise<QueryResponse> {
  return (await chrome.runtime.sendMessage({
    type: 'popup.query',
  } satisfies RuntimeMessage)) as QueryResponse;
}

async function render(): Promise<void> {
  if (!root) return;
  const { active, settings, captionStats, inbox, capture } = await load();
  root.innerHTML = '';
  root.appendChild(activeCard(active, captionStats, capture, !!settings.accessToken));
  if (inbox.length > 0) root.appendChild(inboxCard(inbox));
  // Choose auth flow based on whether we have a refresh token
  if (!settings.refreshToken) {
    root.appendChild(signInCard(settings));
  } else {
    root.appendChild(signedInCard(settings));
  }
  root.appendChild(advancedCard(settings));
}

function inboxCard(items: InboxNotification[]): HTMLElement {
  const card = document.createElement('div');
  card.className = 'card stack';
  const heading = document.createElement('div');
  heading.style.fontWeight = '600';
  heading.textContent = `Inbox (${items.length})`;
  card.appendChild(heading);
  for (const n of items.slice(0, 6)) card.appendChild(inboxRow(n));
  return card;
}

function inboxRow(n: InboxNotification): HTMLElement {
  const row = document.createElement('div');
  row.className = 'stack';
  row.style.gap = '2px';
  row.style.borderTop = '1px solid var(--border)';
  row.style.paddingTop = '6px';
  const title = document.createElement('div');
  title.style.fontSize = '12px';
  title.textContent = n.title;
  row.appendChild(title);
  const body = document.createElement('div');
  body.className = 'muted';
  body.style.fontSize = '11px';
  body.textContent = n.body;
  row.appendChild(body);
  const actions = document.createElement('div');
  actions.className = 'row';
  actions.style.gap = '6px';
  const dismiss = document.createElement('button');
  dismiss.className = 'btn btn-secondary';
  dismiss.style.padding = '2px 6px';
  dismiss.style.fontSize = '11px';
  dismiss.textContent = 'Mark read';
  dismiss.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'inbox.markRead', id: n.id } satisfies RuntimeMessage);
    void render();
  });
  actions.appendChild(dismiss);
  row.appendChild(actions);
  return row;
}

function activeCard(
  active: ActiveMeeting | null,
  stats: CaptionStats | null,
  capture: CaptureStatus | null,
  signedIn: boolean,
): HTMLElement {
  if (!active) {
    const empty = document.createElement('div');
    empty.className = 'card muted';
    empty.textContent = 'No Google Meet detected. Open a meet.google.com tab to pair Athena.';
    return empty;
  }
  const card = document.createElement('div');
  card.className = 'card stack';
  const title = document.createElement('div');
  title.innerHTML = `<span class="pill">DETECTED</span> ${escapeHtml(active.title ?? '(untitled)')}`;
  card.appendChild(title);
  const id = document.createElement('div');
  id.innerHTML = `<code>${escapeHtml(active.meetingId)}</code>`;
  card.appendChild(id);

  const capturing = !!capture && !capture.closed;
  if (capturing && capture) {
    const s = document.createElement('div');
    s.style.fontSize = '11px';
    if (capture.reconnectAttempt) {
      s.style.color = '#facc15';
      s.textContent = `● reconnecting (attempt ${capture.reconnectAttempt}) · finals ${capture.finalsHeard} · suggestions ${capture.suggestionsHeard}`;
    } else if (capture.lastError) {
      s.style.color = '#86efac';
      s.textContent = `● live · audio frames ${capture.shipped} · finals ${capture.finalsHeard} · ${capture.lastError}`;
    } else {
      s.style.color = '#86efac';
      s.textContent = `● live · audio frames ${capture.shipped} · finals ${capture.finalsHeard} · suggestions ${capture.suggestionsHeard}`;
    }
    card.appendChild(s);
  } else if (capture && capture.closed && capture.lastError) {
    const s = document.createElement('div');
    s.style.fontSize = '11px';
    s.style.color = '#fca5a5';
    s.textContent = `capture stopped — ${capture.lastError}`;
    card.appendChild(s);
  } else if (stats) {
    const s = document.createElement('div');
    s.className = 'muted';
    s.style.fontSize = '11px';
    s.textContent =
      stats.lastError !== null
        ? `captions: shipped ${stats.shipped} · buffered ${stats.buffered} · ${stats.lastError}`
        : `captions: shipped ${stats.shipped} · buffered ${stats.buffered}`;
    card.appendChild(s);
  }
  const buttons = document.createElement('div');
  buttons.className = 'row';
  const copy = document.createElement('button');
  copy.className = 'btn btn-secondary';
  copy.textContent = 'Copy meeting ID';
  copy.addEventListener('click', async () => {
    await navigator.clipboard.writeText(active.meetingId);
    copy.textContent = 'Copied';
    setTimeout(() => (copy.textContent = 'Copy meeting ID'), 1200);
  });
  buttons.appendChild(copy);
  const open = document.createElement('a');
  open.className = 'btn';
  open.href = `athena://start?meeting_id=${encodeURIComponent(
    active.meetingId,
  )}&title=${encodeURIComponent(active.title ?? '')}`;
  open.textContent = 'Open in Athena';
  buttons.appendChild(open);
  card.appendChild(buttons);

  // Primary path for paying customers: real-time Meet tab-audio capture →
  // gateway WS → Deepgram STT → coach. Replaces the caption-DOM scraper
  // (which is fragile to Meet UI revisions) with the same proven audio path
  // the CLI uses.
  const cap = document.createElement('button');
  cap.className = capturing ? 'btn btn-secondary' : 'btn';
  cap.style.marginTop = '6px';
  if (!signedIn) {
    cap.disabled = true;
    cap.textContent = 'Sign in to capture';
  } else {
    cap.textContent = capturing ? 'Stop live capture' : 'Start live capture';
    cap.addEventListener('click', async () => {
      cap.disabled = true;
      cap.textContent = capturing ? 'Stopping…' : 'Starting…';
      // Mic probe is best-effort — popup windows auto-dismiss prompts when
      // they lose focus, so we don't block capture on it. Customer audio
      // (tabCapture) flows regardless. Rep voice mixing requires the
      // dedicated permission page (see "Grant mic permission" below).
      if (!capturing) {
        try {
          const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
          probe.getTracks().forEach((t) => t.stop());
        } catch {
          /* continue without mic — tab audio still ships */
        }
      }
      const resp = (await chrome.runtime.sendMessage({
        type: capturing ? 'capture.stop' : 'capture.start',
      } satisfies RuntimeMessage)) as { ok: boolean; error?: string };
      if (!resp?.ok) {
        cap.textContent = `Failed: ${resp?.error ?? 'unknown'}`;
        setTimeout(() => void render(), 2000);
      } else {
        void render();
      }
    });
  }
  card.appendChild(cap);

  // Mic-permission helper. Popup windows can't reliably show getUserMedia
  // prompts (they auto-dismiss on focus loss), so we hand off to a real
  // extension tab where the prompt sticks. Once granted, offscreen reuses it.
  if (signedIn) {
    const grant = document.createElement('button');
    grant.className = 'btn btn-secondary';
    grant.style.marginTop = '6px';
    grant.style.fontSize = '12px';
    grant.textContent = 'Grant mic permission (one-time)';
    grant.addEventListener('click', () => {
      void chrome.tabs.create({ url: chrome.runtime.getURL('permission/index.html') });
    });
    card.appendChild(grant);
  }

  // Demo path: ship 3 canned objections through the same pipeline the
  // content-script caption capture would use. Lets the rep prove the
  // coach loop end-to-end without depending on Meet's caption DOM.
  const demo = document.createElement('button');
  demo.className = 'btn btn-secondary';
  demo.style.marginTop = '6px';
  demo.textContent = 'Inject 3 demo objections';
  demo.addEventListener('click', async () => {
    demo.disabled = true;
    demo.textContent = 'Shipping…';
    const resp = (await chrome.runtime.sendMessage({
      type: 'demo.injectCaptions',
      meetingId: active.meetingId,
    } satisfies RuntimeMessage)) as { ok: boolean; injected?: number; error?: string };
    demo.disabled = false;
    demo.textContent = resp?.ok
      ? `Shipped ${resp.injected ?? 3} ✓`
      : `Failed: ${resp?.error ?? 'unknown'}`;
    setTimeout(() => (demo.textContent = 'Inject 3 demo objections'), 2400);
    void render();
  });
  card.appendChild(demo);
  return card;
}

function signInCard(initial: ExtensionSettings): HTMLElement {
  const card = document.createElement('div');
  card.className = 'card stack';
  const heading = document.createElement('div');
  heading.style.fontWeight = '600';
  heading.textContent = 'Sign in to Athena';
  card.appendChild(heading);
  const help = document.createElement('div');
  help.className = 'muted';
  help.style.fontSize = '11px';
  help.textContent =
    'Sign in once with your Athena email + password. The extension will keep itself signed in and ship captions automatically.';
  card.appendChild(help);

  const email = labeledInput('Email', initial.userEmail ?? '', 'email');
  card.appendChild(email.wrap);
  const password = labeledInput('Password', '', 'password');
  card.appendChild(password.wrap);
  const slug = labeledInput('Workspace slug (optional)', '');
  card.appendChild(slug.wrap);

  const ship = document.createElement('label');
  ship.className = 'row';
  ship.style.fontSize = '11px';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = initial.shipCaptions;
  ship.appendChild(cb);
  ship.appendChild(document.createTextNode(' Ship Meet captions while signed in'));
  card.appendChild(ship);

  const error = document.createElement('div');
  error.style.fontSize = '11px';
  error.style.color = '#fca5a5';
  card.appendChild(error);

  const submit = document.createElement('button');
  submit.className = 'btn';
  submit.textContent = 'Sign in';
  submit.addEventListener('click', async () => {
    error.textContent = '';
    const e = email.input.value.trim();
    const p = password.input.value;
    const s = slug.input.value.trim();
    if (!e || !p) {
      error.textContent = 'Email + password are required.';
      return;
    }
    submit.textContent = 'Signing in…';
    submit.disabled = true;
    // Persist shipCaptions toggle alongside the login (so the ship pref is
    // captured even when the user changes nothing else).
    await chrome.runtime.sendMessage({
      type: 'settings.save',
      settings: {
        ...initial,
        shipCaptions: cb.checked,
      },
    } satisfies RuntimeMessage);
    const resp = (await chrome.runtime.sendMessage({
      type: 'auth.login',
      email: e,
      password: p,
      ...(s ? { workspaceSlug: s } : {}),
    } satisfies RuntimeMessage)) as { ok: boolean; error?: string };
    submit.disabled = false;
    submit.textContent = 'Sign in';
    if (!resp?.ok) {
      error.textContent = resp?.error ?? 'Sign-in failed.';
      return;
    }
    void render();
  });
  card.appendChild(submit);
  return card;
}

function signedInCard(initial: ExtensionSettings): HTMLElement {
  const card = document.createElement('div');
  card.className = 'card stack';
  const heading = document.createElement('div');
  heading.style.fontWeight = '600';
  heading.textContent = 'Signed in';
  card.appendChild(heading);
  const who = document.createElement('div');
  who.className = 'muted';
  who.style.fontSize = '11px';
  who.textContent = initial.userEmail
    ? `as ${initial.userEmail} — token auto-refreshes in the background`
    : 'token auto-refreshes in the background';
  card.appendChild(who);

  const ship = document.createElement('label');
  ship.className = 'row';
  ship.style.fontSize = '11px';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = initial.shipCaptions;
  ship.appendChild(cb);
  ship.appendChild(document.createTextNode(' Ship Meet captions to api'));
  card.appendChild(ship);

  // Solo-test mode is dev-only. Hide it in builds that don't talk to a
  // localhost gateway so paying customers can't accidentally enable it and
  // pollute their own analytics.
  const isDevGateway = /localhost|127\.0\.0\.1/.test(initial.gatewayUrl);
  const soloCb = document.createElement('input');
  soloCb.type = 'checkbox';
  soloCb.checked = initial.forceCustomer === true;
  if (isDevGateway) {
    const solo = document.createElement('label');
    solo.className = 'row';
    solo.style.fontSize = '11px';
    solo.title = 'Dev only — classifies every transcript turn as customer so the coach fires when you test alone in Meet.';
    solo.appendChild(soloCb);
    solo.appendChild(document.createTextNode(' Solo-test mode (force customer)'));
    card.appendChild(solo);
  }

  const row = document.createElement('div');
  row.className = 'row';
  row.style.gap = '6px';
  const save = document.createElement('button');
  save.className = 'btn';
  save.textContent = 'Save';
  save.addEventListener('click', async () => {
    save.textContent = 'Saving…';
    await chrome.runtime.sendMessage({
      type: 'settings.save',
      settings: { ...initial, shipCaptions: cb.checked, forceCustomer: soloCb.checked },
    } satisfies RuntimeMessage);
    save.textContent = 'Saved';
    setTimeout(() => (save.textContent = 'Save'), 1200);
    void render();
  });
  row.appendChild(save);
  const out = document.createElement('button');
  out.className = 'btn btn-secondary';
  out.textContent = 'Sign out';
  out.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'auth.logout' } satisfies RuntimeMessage);
    void render();
  });
  row.appendChild(out);
  card.appendChild(row);
  return card;
}

function advancedCard(initial: ExtensionSettings): HTMLElement {
  const wrap = document.createElement('details');
  wrap.className = 'card stack';
  const summary = document.createElement('summary');
  summary.style.fontWeight = '600';
  summary.style.fontSize = '12px';
  summary.style.cursor = 'pointer';
  summary.textContent = 'Advanced — endpoints';
  wrap.appendChild(summary);

  const apiUrl = labeledInput('API URL', initial.apiUrl);
  wrap.appendChild(apiUrl.wrap);
  const gatewayUrl = labeledInput('Gateway URL', initial.gatewayUrl);
  wrap.appendChild(gatewayUrl.wrap);

  const save = document.createElement('button');
  save.className = 'btn btn-secondary';
  save.textContent = 'Save endpoints';
  save.addEventListener('click', async () => {
    save.textContent = 'Saving…';
    await chrome.runtime.sendMessage({
      type: 'settings.save',
      settings: {
        ...initial,
        apiUrl: (apiUrl.input.value || DEFAULT_SETTINGS.apiUrl).trim(),
        gatewayUrl: (gatewayUrl.input.value || DEFAULT_SETTINGS.gatewayUrl).trim(),
      },
    } satisfies RuntimeMessage);
    save.textContent = 'Saved';
    setTimeout(() => (save.textContent = 'Save endpoints'), 1200);
  });
  wrap.appendChild(save);
  return wrap;
}

function labeledInput(
  label: string,
  value: string,
  type = 'text',
): { wrap: HTMLLabelElement; input: HTMLInputElement } {
  const wrap = document.createElement('label');
  wrap.className = 'stack';
  wrap.style.gap = '2px';
  const span = document.createElement('span');
  span.className = 'muted';
  span.style.fontSize = '10px';
  span.textContent = label;
  wrap.appendChild(span);
  const input = document.createElement('input');
  input.type = type;
  input.value = value;
  input.spellcheck = false;
  input.style.cssText =
    'background: rgba(255,255,255,0.05); color: var(--fg); border: 1px solid var(--border); border-radius: 4px; padding: 4px 6px; font-size: 12px; font-family: inherit;';
  wrap.appendChild(input);
  return { wrap, input };
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

void render();
