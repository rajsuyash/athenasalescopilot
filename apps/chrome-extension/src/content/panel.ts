/**
 * In-Meet suggestion history panel. Mounts a floating button (bottom-right of
 * the viewport) and a slide-in side panel that lists every suggestion the
 * coach has emitted during the active capture session.
 *
 * Persists the last 50 suggestions per meetingId to chrome.storage.local so
 * the rep can scroll back through earlier prompts and the history survives
 * a tab reload (Meet sometimes refreshes the tab on participant changes).
 *
 * Renders entirely inside a Shadow DOM so Meet can't restyle or remove our
 * UI — Meet rewrites its own DOM aggressively but Shadow roots are out of
 * reach of normal querySelectorAll sweeps.
 */
import { log } from '../shared/log.js';

export interface PanelSuggestion {
  type?: string;
  answerText?: string | null;
  followupText?: string | null;
  confidenceScore?: number;
  rationale?: string;
  receivedAt?: number;
  id?: string;
}

const HOST_ID = 'athena-panel-host';
const MAX_HISTORY = 50;
const STORAGE_PREFIX = 'panel.suggestions.';

type Filter = 'all' | 'ask_next' | 'answer' | 'coach' | 'risk';

interface PanelState {
  meetingId: string | null;
  history: PanelSuggestion[];
  filter: Filter;
  open: boolean;
}

const state: PanelState = {
  meetingId: null,
  history: [],
  filter: 'all',
  open: false,
};

let shadow: ShadowRoot | null = null;
let listEl: HTMLDivElement | null = null;
let badgeEl: HTMLSpanElement | null = null;
let panelEl: HTMLDivElement | null = null;

function storageKey(meetingId: string): string {
  return `${STORAGE_PREFIX}${meetingId}`;
}

function ensureHost(): ShadowRoot {
  if (shadow) return shadow;
  const existing = document.getElementById(HOST_ID);
  if (existing && existing.shadowRoot) {
    shadow = existing.shadowRoot;
    return shadow;
  }
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647';
  document.documentElement.appendChild(host);
  shadow = host.attachShadow({ mode: 'closed' });
  buildTree(shadow);
  return shadow;
}

function buildTree(root: ShadowRoot): void {
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .btn {
      position: fixed; bottom: 24px; right: 24px;
      background: rgba(15,23,42,0.96); color: #f8fafc;
      border: 1px solid rgba(148,163,184,0.3);
      border-radius: 999px; padding: 10px 14px;
      font: 600 13px -apple-system, system-ui, sans-serif;
      cursor: pointer; box-shadow: 0 8px 24px rgba(0,0,0,0.35);
      display: flex; align-items: center; gap: 8px;
      pointer-events: auto;
    }
    .btn:hover { background: rgba(30,41,59,0.96); }
    .badge {
      background: #10b981; color: #052e1f;
      border-radius: 999px; font-size: 10px;
      padding: 1px 6px; font-weight: 700;
      min-width: 16px; text-align: center;
    }
    .panel {
      position: fixed; top: 0; right: 0; bottom: 0; width: 340px;
      background: rgba(15,23,42,0.97); color: #f8fafc;
      border-left: 1px solid rgba(148,163,184,0.18);
      box-shadow: -8px 0 32px rgba(0,0,0,0.35);
      transform: translateX(100%); transition: transform 200ms ease-out;
      display: flex; flex-direction: column;
      font: 13px -apple-system, system-ui, sans-serif;
      pointer-events: auto;
    }
    .panel.open { transform: translateX(0); }
    .panel header {
      padding: 12px 14px; border-bottom: 1px solid rgba(148,163,184,0.18);
      display: flex; align-items: center; gap: 8px;
    }
    .panel header h2 { margin: 0; font-size: 14px; font-weight: 600; }
    .panel header .close {
      margin-left: auto; cursor: pointer; color: #94a3b8;
      background: none; border: none; font-size: 18px; padding: 0;
    }
    .filters { display: flex; gap: 4px; padding: 8px 12px; flex-wrap: wrap;
      border-bottom: 1px solid rgba(148,163,184,0.12); }
    .chip {
      background: transparent; color: #94a3b8;
      border: 1px solid rgba(148,163,184,0.3);
      border-radius: 999px; padding: 3px 8px;
      font-size: 11px; cursor: pointer;
    }
    .chip.active { background: #10b981; color: #052e1f; border-color: #10b981; }
    .list { flex: 1; overflow-y: auto; padding: 10px 12px;
      display: flex; flex-direction: column; gap: 8px; }
    .list .empty { color: #64748b; font-size: 12px; padding: 20px 0; text-align: center; }
    .card {
      background: rgba(30,41,59,0.5);
      border: 1px solid rgba(148,163,184,0.15);
      border-radius: 8px; padding: 10px 12px;
      animation: pulse 600ms ease-out;
    }
    .card .meta {
      display: flex; align-items: center; gap: 6px;
      font-size: 10px; color: #10b981; text-transform: uppercase;
      letter-spacing: 0.5px; font-weight: 600; margin-bottom: 4px;
    }
    .card .meta .ago { color: #64748b; margin-left: auto; font-weight: 400; text-transform: none; }
    .card .answer { color: #f1f5f9; margin-bottom: 4px; line-height: 1.4; }
    .card .followup { color: #cbd5e1; font-style: italic; line-height: 1.4; }
    .footer { padding: 8px 12px; border-top: 1px solid rgba(148,163,184,0.12);
      font-size: 11px; color: #64748b; text-align: center; }
    .footer a { color: #10b981; text-decoration: none; }
    @keyframes pulse {
      0% { background: rgba(16,185,129,0.18); }
      100% { background: rgba(30,41,59,0.5); }
    }
  `;
  root.appendChild(style);

  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.type = 'button';
  const btnLabel = document.createElement('span');
  btnLabel.textContent = 'Athena';
  badgeEl = document.createElement('span');
  badgeEl.className = 'badge';
  badgeEl.textContent = '0';
  btn.appendChild(btnLabel);
  btn.appendChild(badgeEl);
  btn.addEventListener('click', () => toggle());
  root.appendChild(btn);

  panelEl = document.createElement('div');
  panelEl.className = 'panel';

  const header = document.createElement('header');
  const h2 = document.createElement('h2');
  h2.textContent = 'Coach prompts';
  const close = document.createElement('button');
  close.className = 'close';
  close.type = 'button';
  close.textContent = '\u2715';
  close.addEventListener('click', () => toggle(false));
  header.appendChild(h2);
  header.appendChild(close);
  panelEl.appendChild(header);

  const filters = document.createElement('div');
  filters.className = 'filters';
  const filterValues: Array<{ key: Filter; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'ask_next', label: 'Ask' },
    { key: 'answer', label: 'Answer' },
    { key: 'coach', label: 'Coach' },
    { key: 'risk', label: 'Risk' },
  ];
  for (const f of filterValues) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (state.filter === f.key ? ' active' : '');
    chip.dataset.filter = f.key;
    chip.textContent = f.label;
    chip.addEventListener('click', () => setFilter(f.key));
    filters.appendChild(chip);
  }
  panelEl.appendChild(filters);

  listEl = document.createElement('div');
  listEl.className = 'list';
  panelEl.appendChild(listEl);

  const footer = document.createElement('div');
  footer.className = 'footer';
  const link = document.createElement('a');
  link.textContent = 'Open meeting in Athena \u2192';
  link.href = '#';
  link.addEventListener('click', (e) => {
    e.preventDefault();
    void chrome.runtime.sendMessage({ type: 'panel.openInAthena' }).catch(() => undefined);
  });
  footer.appendChild(link);
  panelEl.appendChild(footer);

  root.appendChild(panelEl);
}

function setFilter(f: Filter): void {
  state.filter = f;
  if (!shadow) return;
  shadow.querySelectorAll('.chip').forEach((c) => {
    const el = c as HTMLElement;
    el.classList.toggle('active', el.dataset.filter === f);
  });
  render();
}

function toggle(force?: boolean): void {
  state.open = force ?? !state.open;
  panelEl?.classList.toggle('open', state.open);
}

function fmtAgo(receivedAt?: number): string {
  if (!receivedAt) return '';
  const diff = Date.now() - receivedAt;
  if (diff < 10_000) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3600_000)}h ago`;
}

function labelFor(s: PanelSuggestion): string {
  if (s.rationale?.startsWith('[proactive:capture_start]')) return 'Opener';
  if (s.rationale?.startsWith('[proactive:rep_silence]')) return 'Next question';
  if (s.rationale?.startsWith('[proactive:stage_transition]')) return 'Stage cue';
  if (s.type === 'ask_next') return 'Ask next';
  if (s.type === 'answer') return 'Answer';
  if (s.type === 'risk') return 'Risk';
  if (s.type === 'coach') return 'Coach';
  return 'Suggestion';
}

function hasSpeakableText(s: PanelSuggestion): boolean {
  return Boolean(
    (s.answerText && s.answerText.trim().length > 0) ||
      (s.followupText && s.followupText.trim().length > 0),
  );
}

function render(): void {
  if (!listEl || !badgeEl) return;
  listEl.replaceChildren();
  // Drop suggestions with no speakable body — these are server-side
  // suppressed entries (urgency below threshold, policy violation, etc).
  // They're forwarded so the SW counter stays accurate but rendering an
  // empty COACH card is just noise to the rep.
  const visible = state.history.filter(hasSpeakableText);
  const filtered = visible.filter((s) =>
    state.filter === 'all' ? true : s.type === state.filter,
  );
  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent =
      visible.length === 0
        ? 'No suggestions yet. Start speaking to trigger the coach.'
        : 'No suggestions match this filter.';
    listEl.appendChild(empty);
  } else {
    for (const s of filtered) {
      const card = document.createElement('div');
      card.className = 'card';
      const meta = document.createElement('div');
      meta.className = 'meta';
      const tag = document.createElement('span');
      tag.textContent = labelFor(s);
      const ago = document.createElement('span');
      ago.className = 'ago';
      ago.textContent = fmtAgo(s.receivedAt);
      meta.appendChild(tag);
      meta.appendChild(ago);
      card.appendChild(meta);
      if (s.answerText) {
        const a = document.createElement('div');
        a.className = 'answer';
        a.textContent = s.answerText;
        card.appendChild(a);
      }
      if (s.followupText) {
        const f = document.createElement('div');
        f.className = 'followup';
        f.textContent = `\u2192 ${s.followupText}`;
        card.appendChild(f);
      }
      listEl.appendChild(card);
    }
  }
  badgeEl.textContent = String(state.history.length);
}

async function persist(): Promise<void> {
  if (!state.meetingId) return;
  try {
    await chrome.storage.local.set({
      [storageKey(state.meetingId)]: state.history.slice(0, MAX_HISTORY),
    });
  } catch (err) {
    log.warn('[athena-panel] persist failed', err);
  }
}

async function hydrate(meetingId: string): Promise<void> {
  state.meetingId = meetingId;
  try {
    const r = await chrome.storage.local.get(storageKey(meetingId));
    const stored = r[storageKey(meetingId)] as PanelSuggestion[] | undefined;
    state.history = Array.isArray(stored) ? stored : [];
  } catch (err) {
    log.warn('[athena-panel] hydrate failed', err);
    state.history = [];
  }
  ensureHost();
  render();
}

/** Add a fresh suggestion to the panel. Called whenever the SW relays an
 *  `overlay.suggestion` message into the content script. */
export function add(s: PanelSuggestion): void {
  ensureHost();
  const enriched: PanelSuggestion = { ...s, receivedAt: Date.now() };
  state.history = [enriched, ...state.history].slice(0, MAX_HISTORY);
  render();
  void persist();
}

/** Bind the panel to the active meeting. Call when the content script
 *  resolves the meetingId from the URL — drives storage namespacing and
 *  hydration. Safe to call repeatedly with the same id. */
export function attach(meetingId: string): void {
  if (state.meetingId === meetingId && shadow) return;
  void hydrate(meetingId);
}
