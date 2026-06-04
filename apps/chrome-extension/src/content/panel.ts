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

interface LiveStatus {
  /** Whether the rep has live capture running right now. Drives the
   *  off-vs-listening base state. */
  capturing: boolean;
  /** Most recent customer-side STT finalization. When `null`, we've never
   *  heard the customer in this session. */
  lastCustomerTurn: { text: string; at: number } | null;
  /** Coach's in-progress streamed answer (replaced on every token delta).
   *  Cleared when the final `suggestion.generated` lands. */
  draftingAnswer: string | null;
  draftingFollowup: string | null;
  draftingStartedAt: number | null;
  /** When the last fully-formed suggestion was committed. Drives the
   *  "Delivered ✓" flash before fading back to idle. */
  lastDeliveredAt: number | null;
}

interface PanelState {
  meetingId: string | null;
  history: PanelSuggestion[];
  filter: Filter;
  open: boolean;
  live: LiveStatus;
}

const state: PanelState = {
  meetingId: null,
  history: [],
  filter: 'all',
  open: false,
  live: {
    capturing: false,
    lastCustomerTurn: null,
    draftingAnswer: null,
    draftingFollowup: null,
    draftingStartedAt: null,
    lastDeliveredAt: null,
  },
};

let shadow: ShadowRoot | null = null;
let listEl: HTMLDivElement | null = null;
let badgeEl: HTMLSpanElement | null = null;
let panelEl: HTMLDivElement | null = null;
let liveEl: HTMLDivElement | null = null;
let liveTickInterval: number | null = null;

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
  // Tokens shared with the top-stack overlay (see content/index.ts):
  //   --athena-glass-bg, --athena-glass-blur, --athena-glass-border,
  //   --athena-text-primary, --athena-text-secondary, --athena-tag-answer.
  // Kept inline here because the Shadow DOM is isolated from the page styles.
  style.textContent = `
    :host { all: initial; }
    .btn {
      position: fixed; bottom: 24px; right: 24px;
      background: rgba(17,24,39,0.42);
      backdrop-filter: blur(28px) saturate(160%);
      -webkit-backdrop-filter: blur(28px) saturate(160%);
      color: #F8FAFC;
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 999px; padding: 10px 14px;
      font: 600 13px Inter, -apple-system, system-ui, sans-serif;
      letter-spacing: 0.2px;
      cursor: pointer;
      box-shadow: 0 12px 40px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.08);
      text-shadow: 0 1px 2px rgba(0,0,0,0.4);
      display: flex; align-items: center; gap: 8px;
      pointer-events: auto;
      transition: background 150ms ease, transform 150ms ease;
    }
    .btn:hover { background: rgba(17,24,39,0.55); }
    .badge {
      background: #34D399; color: #052e1f;
      border-radius: 999px; font-size: 10px;
      padding: 1px 6px; font-weight: 700;
      min-width: 16px; text-align: center;
      text-shadow: none;
    }
    .panel {
      position: fixed; top: 0; right: 0; bottom: 0; width: 340px;
      background: rgba(17,24,39,0.42);
      backdrop-filter: blur(28px) saturate(160%);
      -webkit-backdrop-filter: blur(28px) saturate(160%);
      color: #F8FAFC;
      border-left: 1px solid rgba(255,255,255,0.14);
      box-shadow: -12px 0 40px rgba(0,0,0,0.28), inset 1px 0 0 rgba(255,255,255,0.06);
      text-shadow: 0 1px 2px rgba(0,0,0,0.4);
      transform: translateX(100%); transition: transform 240ms cubic-bezier(0.22,1,0.36,1);
      display: flex; flex-direction: column;
      font: 13px Inter, -apple-system, system-ui, sans-serif;
      pointer-events: auto;
    }
    .panel.open { transform: translateX(0); }
    .panel header {
      padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,0.10);
      display: flex; align-items: center; gap: 8px;
    }
    .panel header h2 { margin: 0; font-size: 14px; font-weight: 600; letter-spacing: 0.2px; }
    .panel header .close {
      margin-left: auto; cursor: pointer; color: rgba(248,250,252,0.78);
      background: none; border: none; font-size: 18px; padding: 2px 6px;
      border-radius: 6px; line-height: 1;
      transition: background 150ms ease;
    }
    .panel header .close:hover { background: rgba(255,255,255,0.10); }
    .filters {
      display: flex; gap: 6px; padding: 10px 14px; flex-wrap: wrap;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .chip {
      background: transparent; color: rgba(248,250,252,0.72);
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 999px; padding: 3px 10px;
      font: 600 11px Inter, -apple-system, system-ui, sans-serif;
      letter-spacing: 0.3px;
      cursor: pointer;
      transition: background 150ms ease, color 150ms ease, border-color 150ms ease;
    }
    .chip:hover { background: rgba(255,255,255,0.06); color: #F8FAFC; }
    .chip.active { background: #34D399; color: #052e1f; border-color: #34D399; text-shadow: none; }
    .list { flex: 1; overflow-y: auto; padding: 12px 14px;
      display: flex; flex-direction: column; gap: 10px; }
    .list .empty { color: rgba(248,250,252,0.55); font-size: 12px; padding: 24px 0; text-align: center; }
    .card {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.10);
      border-radius: 12px; padding: 12px 14px;
      animation: pulse 600ms ease-out;
    }
    .card .meta {
      display: flex; align-items: center; gap: 8px;
      font: 600 11px Inter, -apple-system, system-ui, sans-serif;
      color: #34D399; text-transform: uppercase;
      letter-spacing: 0.6px; margin-bottom: 6px;
    }
    .card .meta .ago {
      color: rgba(248,250,252,0.55); margin-left: auto;
      font-weight: 400; text-transform: none; letter-spacing: 0.2px;
    }
    .card .answer { color: #F8FAFC; margin-bottom: 6px; line-height: 1.5; font-weight: 500; font-size: 16px; }
    .card .followup { color: #F8FAFC; margin-bottom: 4px; line-height: 1.5; font-weight: 500; font-size: 16px; }
    /* Live coach status block — sits between filters and the history list so
     * the rep can see in real time what the coach is doing (listening,
     * thinking, drafting) instead of staring at a static history while
     * wondering if the engine is alive. */
    .live {
      padding: 12px 14px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      display: flex; flex-direction: column; gap: 8px;
    }
    .live .pill {
      display: inline-flex; align-items: center; gap: 6px;
      align-self: flex-start;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 999px;
      padding: 4px 10px;
      font: 600 11px Inter, -apple-system, system-ui, sans-serif;
      letter-spacing: 0.6px;
      text-transform: uppercase;
      color: rgba(248,250,252,0.78);
      transition: background 200ms ease, border-color 200ms ease, color 200ms ease;
    }
    .live .pill .dot {
      width: 6px; height: 6px; border-radius: 999px;
      background: rgba(248,250,252,0.55);
    }
    .live .pill.listening { color: #93C5FD; border-color: rgba(147,197,253,0.35); }
    .live .pill.listening .dot { background: #60A5FA; animation: pulse-dot 1.6s ease-in-out infinite; }
    .live .pill.heard { color: #FBBF24; border-color: rgba(251,191,36,0.35); }
    .live .pill.heard .dot { background: #FBBF24; }
    .live .pill.drafting { color: #FBBF24; border-color: rgba(251,191,36,0.35); }
    .live .pill.drafting .dot { background: #FBBF24; animation: pulse-dot 0.8s ease-in-out infinite; }
    .live .pill.delivered { color: #34D399; border-color: rgba(52,211,153,0.35); }
    .live .pill.delivered .dot { background: #34D399; }
    .live .pill.off { color: rgba(248,250,252,0.55); }
    .live .pill.off .dot { background: rgba(248,250,252,0.40); }
    .live .customer-turn {
      color: rgba(248,250,252,0.82);
      font-size: 13px; line-height: 1.45;
      max-height: 4.4em; overflow: hidden;
    }
    .live .customer-turn .label {
      display: block;
      font: 600 10px Inter, -apple-system, system-ui, sans-serif;
      letter-spacing: 0.6px; text-transform: uppercase;
      color: rgba(248,250,252,0.45);
      margin-bottom: 3px;
    }
    .live .draft {
      color: #F8FAFC;
      font-size: 14px; line-height: 1.5;
      font-weight: 500;
      max-height: 6em; overflow: hidden;
      padding-left: 8px;
      border-left: 2px solid rgba(251,191,36,0.55);
    }
    .live .draft .label {
      display: block;
      font: 600 10px Inter, -apple-system, system-ui, sans-serif;
      letter-spacing: 0.6px; text-transform: uppercase;
      color: rgba(251,191,36,0.85);
      margin-bottom: 3px;
    }
    @keyframes pulse-dot {
      0%, 100% { opacity: 1; transform: scale(1); }
      50%      { opacity: 0.45; transform: scale(0.85); }
    }
    .footer {
      padding: 10px 14px; border-top: 1px solid rgba(255,255,255,0.08);
      font-size: 11px; color: rgba(248,250,252,0.55); text-align: center;
    }
    .footer a { color: #34D399; text-decoration: none; font-weight: 600; }
    .footer a:hover { text-decoration: underline; }
    @keyframes pulse {
      0%   { background: rgba(52,211,153,0.20); }
      100% { background: rgba(255,255,255,0.06); }
    }
    @media (prefers-reduced-motion: reduce) {
      .panel { transition: none !important; }
      .card { animation: none !important; }
    }
  `;
  root.appendChild(style);

  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.type = 'button';
  const btnLabel = document.createElement('span');
  btnLabel.textContent = 'Rocket';
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

  liveEl = document.createElement('div');
  liveEl.className = 'live';
  panelEl.appendChild(liveEl);

  listEl = document.createElement('div');
  listEl.className = 'list';
  panelEl.appendChild(listEl);

  const footer = document.createElement('div');
  footer.className = 'footer';
  const link = document.createElement('a');
  link.textContent = 'Open meeting in Rocket \u2192';
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
        f.textContent = s.followupText;
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
  startLiveTick();
  render();
  renderLive();
}

/** Add a fresh suggestion to the panel. Called whenever the SW relays an
 *  `overlay.suggestion` message into the content script. */
export function add(s: PanelSuggestion): void {
  ensureHost();
  const enriched: PanelSuggestion = { ...s, receivedAt: Date.now() };
  state.history = [enriched, ...state.history].slice(0, MAX_HISTORY);
  state.live.lastDeliveredAt = Date.now();
  // Final suggestion landed — clear the in-flight draft.
  state.live.draftingAnswer = null;
  state.live.draftingFollowup = null;
  state.live.draftingStartedAt = null;
  render();
  renderLive();
  void persist();
}

/** Latest customer-side STT finalization. Drives the "heard customer →
 *  thinking" transition in the live status block. */
export function setCustomerTurn(text: string): void {
  ensureHost();
  state.live.lastCustomerTurn = { text: text.trim(), at: Date.now() };
  renderLive();
}

/** Streaming tokens from the coach — replaced on every delta. */
export function setDraft(answerText: string | null, followupText: string | null): void {
  ensureHost();
  state.live.draftingAnswer = answerText && answerText.trim().length > 0 ? answerText : null;
  state.live.draftingFollowup =
    followupText && followupText.trim().length > 0 ? followupText : null;
  if (state.live.draftingStartedAt === null && (state.live.draftingAnswer || state.live.draftingFollowup)) {
    state.live.draftingStartedAt = Date.now();
  }
  renderLive();
}

/** Capture lifecycle — driven by `chrome.storage.local.capture` changes
 *  observed in the content script. */
export function setCapturing(on: boolean): void {
  ensureHost();
  state.live.capturing = on;
  if (!on) {
    // Don't wipe lastCustomerTurn — the rep may want to read the last
    // thing they said even after capture stops. But the in-flight draft
    // is no longer truthful once the WS is closed.
    state.live.draftingAnswer = null;
    state.live.draftingFollowup = null;
    state.live.draftingStartedAt = null;
  }
  renderLive();
}

interface LivePillState {
  cls: 'off' | 'listening' | 'heard' | 'drafting' | 'delivered';
  label: string;
}

function derivePill(now: number): LivePillState {
  const l = state.live;
  if (!l.capturing) return { cls: 'off', label: 'Capture off' };
  if (l.draftingAnswer || l.draftingFollowup) {
    const elapsed = l.draftingStartedAt ? Math.round((now - l.draftingStartedAt) / 100) / 10 : 0;
    return { cls: 'drafting', label: `Drafting reply · ${elapsed.toFixed(1)}s` };
  }
  if (l.lastDeliveredAt && now - l.lastDeliveredAt < 2500) {
    return { cls: 'delivered', label: 'Delivered ✓' };
  }
  if (l.lastCustomerTurn && now - l.lastCustomerTurn.at < 2500) {
    return { cls: 'heard', label: 'Heard customer — thinking…' };
  }
  if (l.lastCustomerTurn && now - l.lastCustomerTurn.at < 30_000) {
    return { cls: 'listening', label: 'Listening for next turn…' };
  }
  return { cls: 'listening', label: 'Listening…' };
}

function renderLive(): void {
  if (!liveEl) return;
  const now = Date.now();
  const pill = derivePill(now);
  liveEl.replaceChildren();

  const pillEl = document.createElement('div');
  pillEl.className = `pill ${pill.cls}`;
  const dot = document.createElement('span');
  dot.className = 'dot';
  pillEl.appendChild(dot);
  pillEl.appendChild(document.createTextNode(pill.label));
  liveEl.appendChild(pillEl);

  if (state.live.lastCustomerTurn) {
    const turn = document.createElement('div');
    turn.className = 'customer-turn';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = `Customer · ${fmtAgo(state.live.lastCustomerTurn.at)}`;
    turn.appendChild(label);
    turn.appendChild(document.createTextNode(state.live.lastCustomerTurn.text));
    liveEl.appendChild(turn);
  }

  const draftText =
    state.live.draftingAnswer && state.live.draftingFollowup
      ? `${state.live.draftingAnswer}\n${state.live.draftingFollowup}`
      : state.live.draftingAnswer ?? state.live.draftingFollowup;
  if (draftText) {
    const draft = document.createElement('div');
    draft.className = 'draft';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = 'Coach drafting';
    draft.appendChild(label);
    draft.appendChild(document.createTextNode(draftText));
    liveEl.appendChild(draft);
  }
}

function startLiveTick(): void {
  if (liveTickInterval !== null) return;
  // 1Hz tick refreshes pill state + "Xs ago" timestamps so transitions
  // (heard → thinking → listening → idle) play out even when no new
  // WS frames are arriving. Visible only while the panel is mounted.
  liveTickInterval = window.setInterval(() => renderLive(), 1000);
}

/** Bind the panel to the active meeting. Call when the content script
 *  resolves the meetingId from the URL — drives storage namespacing and
 *  hydration. Safe to call repeatedly with the same id. */
export function attach(meetingId: string): void {
  if (state.meetingId === meetingId && shadow) return;
  void hydrate(meetingId);
}
