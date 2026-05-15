/**
 * Popup — pure DOM. Status + sign-in + capture controls.
 *
 * Token hygiene: the popup is a privileged context, but it never receives
 * raw access/refresh tokens. The SW's `popup.query` returns only an
 * `account` summary (isSignedIn, email, expiresAt) plus a sanitized `prefs`
 * object. The SW does all signedFetch — popup never touches the bearer.
 */
import {
  type ActiveMeeting,
  type CaptionStats,
  type CaptureStatus,
  type AccountInfo,
  type InboxNotification,
  type PopupPrefs,
  type PopupQueryResponse,
  type RuntimeMessage,
} from '../shared/types.js';

const root = document.getElementById('root');

async function load(): Promise<PopupQueryResponse> {
  return (await chrome.runtime.sendMessage({
    type: 'popup.query',
  } satisfies RuntimeMessage)) as PopupQueryResponse;
}

function isDevBuild(prefs: PopupPrefs): boolean {
  return /localhost|127\.0\.0\.1/.test(prefs.gatewayUrl);
}

async function render(): Promise<void> {
  if (!root) return;
  const { active, account, prefs, captionStats, inbox, capture } = await load();
  const devMode = isDevBuild(prefs);
  root.replaceChildren();
  root.appendChild(activeCard(active, captionStats, capture, account.isSignedIn, devMode));
  if (inbox.length > 0) root.appendChild(inboxCard(inbox));
  if (!account.isSignedIn) {
    root.appendChild(signInCard(prefs));
  } else {
    root.appendChild(signedInCard(account, prefs, devMode));
  }
  // Endpoints editor is dev-only — paying customers never need to override
  // the production backend URLs.
  if (devMode) root.appendChild(advancedCard(prefs));
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
  row.style.borderTop = '1px solid rgba(255,255,255,0.08)';
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
  devMode: boolean,
): HTMLElement {
  if (!active) {
    const empty = document.createElement('div');
    empty.className = 'card muted';
    empty.textContent = 'No Google Meet detected. Open a meet.google.com tab to pair Rocket.';
    return empty;
  }
  const card = document.createElement('div');
  card.className = 'card stack';
  const title = document.createElement('div');
  const pill = document.createElement('span');
  pill.className = 'pill';
  pill.textContent = 'DETECTED';
  title.appendChild(pill);
  title.appendChild(document.createTextNode(' ' + (active.title ?? '(untitled)')));
  card.appendChild(title);
  if (devMode) {
    const id = document.createElement('div');
    const code = document.createElement('code');
    code.textContent = active.meetingId;
    id.appendChild(code);
    card.appendChild(id);
  }

  const capturing = !!capture && !capture.closed;
  if (capturing && capture) {
    const s = document.createElement('div');
    s.style.fontSize = '11px';
    if (capture.reconnectAttempt) {
      s.style.color = '#facc15';
      s.textContent = `Reconnecting (attempt ${capture.reconnectAttempt})…`;
    } else if (capture.lastError && devMode) {
      s.style.color = '#86efac';
      s.textContent = `● live · ${capture.lastError}`;
    } else if (devMode) {
      s.style.color = '#86efac';
      s.textContent = `● live · audio frames ${capture.shipped} · finals ${capture.finalsHeard} · suggestions ${capture.suggestionsHeard}`;
    } else {
      s.style.color = '#86efac';
      s.textContent = `● Live — listening for prompts`;
    }
    card.appendChild(s);
  } else if (capture && capture.closed && capture.lastError) {
    const s = document.createElement('div');
    s.style.fontSize = '11px';
    s.style.color = '#fca5a5';
    s.textContent = `Capture stopped — ${capture.lastError}`;
    card.appendChild(s);
  } else if (stats && devMode) {
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
  const open = document.createElement('button');
  open.className = 'btn';
  open.type = 'button';
  open.textContent = 'Open in Rocket';
  open.addEventListener('click', () => {
    void chrome.runtime
      .sendMessage({ type: 'panel.openInAthena' })
      .catch(() => undefined);
  });
  buttons.appendChild(open);
  card.appendChild(buttons);

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
      if (!capturing) {
        try {
          const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
          probe.getTracks().forEach((t) => t.stop());
        } catch {
          /* continue without mic — tab audio still ships */
        }

        // Mint the tabCapture streamId HERE in the popup. The popup is a
        // valid extension-invocation surface; the SW's onMessage handler
        // is NOT — Chrome raises "Extension has not been invoked for the
        // current page" if getMediaStreamId runs from onMessage. Doing it
        // here also targets the right tab even if it isn't currently
        // focused: the `tabCapture` permission + popup-invocation grant
        // covers `targetTabId`.
        let streamId: string;
        try {
          streamId = await new Promise<string>((resolve, reject) => {
            chrome.tabCapture.getMediaStreamId(
              { targetTabId: active.tabId },
              (id) => {
                // Snapshot lastError as the first line — Chrome clears it
                // once the callback returns and any await inside the
                // reject path could race with that reset.
                const err = chrome.runtime.lastError;
                if (err || !id) {
                  reject(new Error(err?.message ?? 'no streamId returned'));
                  return;
                }
                resolve(id);
              },
            );
          });
        } catch (err) {
          cap.textContent = `Failed: ${(err as Error).message}`;
          setTimeout(() => void render(), 2500);
          return;
        }

        const resp = (await chrome.runtime.sendMessage({
          type: 'capture.start',
          streamId,
        } satisfies RuntimeMessage)) as { ok: boolean; error?: string };
        if (!resp?.ok) {
          cap.textContent = `Failed: ${resp?.error ?? 'unknown'}`;
          setTimeout(() => void render(), 2000);
        } else {
          void render();
        }
        return;
      }

      // Stop path — no streamId needed.
      const resp = (await chrome.runtime.sendMessage({
        type: 'capture.stop',
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

  if (devMode) {
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
  }
  return card;
}

function signInCard(initialPrefs: PopupPrefs): HTMLElement {
  const card = document.createElement('div');
  card.className = 'card stack';
  const heading = document.createElement('div');
  heading.style.fontWeight = '600';
  heading.textContent = 'Sign in to Rocket';
  card.appendChild(heading);
  const help = document.createElement('div');
  help.className = 'muted';
  help.style.fontSize = '11px';
  help.textContent =
    'Sign in once with your Rocket Sales Agent email + password. The extension will keep itself signed in and ship captions automatically.';
  card.appendChild(help);

  // ─── Mode toggle: password vs pairing-code ────────────────────────────
  // Google/OAuth signups have no password. They mint a one-time pairing code
  // on admin-web (/connect-extension) and paste it here.
  let mode: 'password' | 'pair' = 'password';
  const tabRow = document.createElement('div');
  tabRow.className = 'row';
  tabRow.style.gap = '4px';
  tabRow.style.marginTop = '4px';
  const tabPwd = document.createElement('button');
  tabPwd.className = 'btn btn-secondary';
  tabPwd.style.fontSize = '11px';
  tabPwd.style.padding = '4px 8px';
  tabPwd.textContent = 'Password';
  const tabCode = document.createElement('button');
  tabCode.className = 'btn btn-secondary';
  tabCode.style.fontSize = '11px';
  tabCode.style.padding = '4px 8px';
  tabCode.textContent = 'Pairing code';
  tabRow.appendChild(tabPwd);
  tabRow.appendChild(tabCode);
  card.appendChild(tabRow);

  const passwordPane = document.createElement('div');
  passwordPane.className = 'stack';
  const codePane = document.createElement('div');
  codePane.className = 'stack';
  codePane.style.display = 'none';
  card.appendChild(passwordPane);
  card.appendChild(codePane);

  const setMode = (next: 'password' | 'pair'): void => {
    mode = next;
    passwordPane.style.display = mode === 'password' ? '' : 'none';
    codePane.style.display = mode === 'pair' ? '' : 'none';
    tabPwd.style.opacity = mode === 'password' ? '1' : '0.5';
    tabCode.style.opacity = mode === 'pair' ? '1' : '0.5';
    error.textContent = '';
  };
  tabPwd.addEventListener('click', () => setMode('password'));
  tabCode.addEventListener('click', () => setMode('pair'));

  // ─── Password pane ────────────────────────────────────────────────────
  const email = labeledInput('Email', '', 'email');
  passwordPane.appendChild(email.wrap);
  const password = labeledInput('Password', '', 'password');
  passwordPane.appendChild(password.wrap);
  const slug = labeledInput('Workspace slug (optional)', '');
  passwordPane.appendChild(slug.wrap);

  // ─── Pairing-code pane ────────────────────────────────────────────────
  const codeHelp = document.createElement('div');
  codeHelp.className = 'muted';
  codeHelp.style.fontSize = '11px';
  codeHelp.innerHTML =
    'Signed up with Google? Visit <a href="https://rocketsalesagent.com/connect-extension" target="_blank" rel="noopener" style="color:#34D399">rocketsalesagent.com/connect-extension</a> to mint a 10-minute pairing code, then paste it here.';
  codePane.appendChild(codeHelp);
  const codeInput = labeledInput('Pairing code (ATH-XXXX-XXXX)', '');
  codeInput.input.style.fontFamily = 'ui-monospace, monospace';
  codeInput.input.style.letterSpacing = '0.1em';
  codeInput.input.placeholder = 'ATH-A3F7-9KP2';
  codeInput.input.autocapitalize = 'characters';
  codeInput.input.spellcheck = false;
  codePane.appendChild(codeInput.wrap);

  // ─── Shared controls ──────────────────────────────────────────────────
  const ship = document.createElement('label');
  ship.className = 'row';
  ship.style.fontSize = '11px';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = initialPrefs.shipCaptions;
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
    submit.disabled = true;
    submit.textContent = 'Signing in…';

    // Persist shipCaptions toggle alongside the login regardless of mode.
    await chrome.runtime.sendMessage({
      type: 'settings.save',
      prefs: { ...initialPrefs, shipCaptions: cb.checked },
    } satisfies RuntimeMessage);

    let resp: { ok: boolean; error?: string };
    if (mode === 'password') {
      const e = email.input.value.trim();
      const p = password.input.value;
      const s = slug.input.value.trim();
      if (!e || !p) {
        error.textContent = 'Email + password are required.';
        submit.disabled = false;
        submit.textContent = 'Sign in';
        return;
      }
      resp = (await chrome.runtime.sendMessage({
        type: 'auth.login',
        email: e,
        password: p,
        ...(s ? { workspaceSlug: s } : {}),
      } satisfies RuntimeMessage)) as { ok: boolean; error?: string };
    } else {
      const code = codeInput.input.value.trim().toUpperCase();
      if (!/^ATH-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) {
        error.textContent = 'Code must look like ATH-XXXX-XXXX.';
        submit.disabled = false;
        submit.textContent = 'Sign in';
        return;
      }
      resp = (await chrome.runtime.sendMessage({
        type: 'auth.pair',
        code,
      } satisfies RuntimeMessage)) as { ok: boolean; error?: string };
    }

    submit.disabled = false;
    submit.textContent = 'Sign in';
    if (!resp?.ok) {
      error.textContent = resp?.error ?? 'Sign-in failed.';
      return;
    }
    void render();
  });
  card.appendChild(submit);

  setMode('password');
  return card;
}

function signedInCard(account: AccountInfo, initialPrefs: PopupPrefs, devMode: boolean): HTMLElement {
  const card = document.createElement('div');
  card.className = 'card stack';
  const heading = document.createElement('div');
  heading.style.fontWeight = '600';
  heading.textContent = 'Signed in';
  card.appendChild(heading);
  const who = document.createElement('div');
  who.className = 'muted';
  who.style.fontSize = '11px';
  who.textContent = account.email ? `as ${account.email}` : '';
  card.appendChild(who);

  const soloCb = document.createElement('input');
  soloCb.type = 'checkbox';
  soloCb.checked = initialPrefs.forceCustomer === true;
  if (devMode) {
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
  if (devMode) {
    const save = document.createElement('button');
    save.className = 'btn';
    save.textContent = 'Save';
    save.addEventListener('click', async () => {
      save.textContent = 'Saving…';
      await chrome.runtime.sendMessage({
        type: 'settings.save',
        prefs: { ...initialPrefs, forceCustomer: soloCb.checked },
      } satisfies RuntimeMessage);
      save.textContent = 'Saved';
      setTimeout(() => (save.textContent = 'Save'), 1200);
      void render();
    });
    row.appendChild(save);
  }
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

function advancedCard(initialPrefs: PopupPrefs): HTMLElement {
  const wrap = document.createElement('details');
  wrap.className = 'card stack';
  const summary = document.createElement('summary');
  summary.style.fontWeight = '600';
  summary.style.fontSize = '12px';
  summary.style.cursor = 'pointer';
  summary.textContent = 'Advanced — endpoints';
  wrap.appendChild(summary);

  const apiUrl = labeledInput('API URL', initialPrefs.apiUrl);
  wrap.appendChild(apiUrl.wrap);
  const gatewayUrl = labeledInput('Gateway URL', initialPrefs.gatewayUrl);
  wrap.appendChild(gatewayUrl.wrap);

  const save = document.createElement('button');
  save.className = 'btn btn-secondary';
  save.textContent = 'Save endpoints';
  save.addEventListener('click', async () => {
    save.textContent = 'Saving…';
    await chrome.runtime.sendMessage({
      type: 'settings.save',
      prefs: {
        ...initialPrefs,
        apiUrl: (apiUrl.input.value || initialPrefs.apiUrl).trim(),
        gatewayUrl: (gatewayUrl.input.value || initialPrefs.gatewayUrl).trim(),
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

void render();
