/**
 * Content script — runs in the Meet tab. Watches the URL + page title and
 * emits `meet.detected` when both stabilize. Also observes Meet's caption
 * region (only when the user has captions on AND has opted in via the popup
 * settings) and emits one `meet.caption` per finalized line.
 */
import { MEET_RE, type RuntimeMessage } from '../shared/types.js';
import * as panel from './panel.js';

let lastReportedId: string | null = null;

function emit(): void {
  const m = MEET_RE.exec(window.location.href);
  if (!m || !m[1]) return;
  const meetingId = m[1];
  const title = document.title?.replace(/^Meet\s*[-–]\s*/i, '').trim() || null;
  if (lastReportedId === meetingId) return;
  lastReportedId = meetingId;
  // Hydrate the in-Meet panel from chrome.storage so the rep can see prior
  // suggestions even after a tab reload mid-call.
  panel.attach(meetingId);
  const msg: RuntimeMessage = {
    type: 'meet.detected',
    tabId: -1, // background fills it from sender.tab.id
    meetingUrl: `https://meet.google.com/${meetingId}`,
    meetingId,
    title,
    detectedAt: new Date().toISOString(),
  };
  void chrome.runtime.sendMessage(msg);
}

emit();

// Title can mutate after the Meet UI initializes — observe + re-emit.
const titleEl = document.querySelector('title');
if (titleEl) {
  new MutationObserver(() => emit()).observe(titleEl, { childList: true, subtree: true });
}

// SPA-style URL changes: poll cheaply.
let lastHref = window.location.href;
setInterval(() => {
  if (window.location.href !== lastHref) {
    lastHref = window.location.href;
    emit();
  }
}, 1000);

window.addEventListener('beforeunload', () => {
  const m = MEET_RE.exec(window.location.href);
  const meetingId = m?.[1] ?? lastReportedId;
  if (!meetingId) return;
  const msg: RuntimeMessage = { type: 'meet.left', tabId: -1, meetingId };
  void chrome.runtime.sendMessage(msg);
});

// ─── Real-time suggestion overlay ──────────────────────────────────────────
//
// The SW relays `suggestion.generated` events from the gateway WS into the
// Meet tab via chrome.tabs.sendMessage. We render a minimal floating card
// in the corner of Meet so the rep can see suggestions during the call
// without leaving Meet or refreshing the dashboard.

interface OverlaySuggestion {
  type?: string;
  answerText?: string | null;
  followupText?: string | null;
  confidenceScore?: number;
  rationale?: string;
  sources?: Array<{ documentName?: string | null }>;
}

const OVERLAY_ID = 'athena-overlay-root';
const OVERLAY_STYLE_ID = 'athena-overlay-style';
// PRD F6: max 2 concurrent suggestions, 15s auto-dismiss.
const MAX_VISIBLE = 2;
const HIDE_AFTER_MS = 15_000;

const TYPE_TAG_COLOR: Record<string, string> = {
  answer: '#34D399',
  ask_next: '#60A5FA',
  coach: '#FBBF24',
  risk: '#F87171',
};

const TYPE_TAG_LABEL: Record<string, string> = {
  answer: 'Answer',
  ask_next: 'Ask next',
  coach: 'Coach',
  risk: 'Risk',
};

function injectOverlayStyles(): void {
  if (document.getElementById(OVERLAY_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = OVERLAY_STYLE_ID;
  style.textContent = `
    @keyframes athena-card-in {
      from { opacity: 0; transform: translateY(-6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes athena-card-out {
      from { opacity: 1; transform: scale(1); }
      to   { opacity: 0; transform: scale(0.98); }
    }
    @keyframes athena-progress {
      from { transform: scaleX(1); }
      to   { transform: scaleX(0); }
    }
    @media (prefers-reduced-motion: reduce) {
      .athena-card { animation: athena-card-in 1ms linear !important; }
      .athena-card.athena-exiting { animation: athena-card-out 1ms linear !important; }
      .athena-progress { animation: none !important; transform: scaleX(0) !important; }
    }
  `;
  document.documentElement.appendChild(style);
}

function ensureOverlayRoot(): HTMLDivElement {
  let root = document.getElementById(OVERLAY_ID) as HTMLDivElement | null;
  if (root) return root;
  injectOverlayStyles();
  root = document.createElement('div');
  root.id = OVERLAY_ID;
  // role=status + aria-live=polite so suggestions are announced without
  // interrupting active screen-reader speech (PRD F6 a11y).
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  root.style.cssText = [
    'position:fixed',
    'top:24px',
    'left:50%',
    'transform:translateX(-50%)',
    'max-height:15vh',
    'max-width:min(560px,60vw)',
    'width:max-content',
    // Recording pill sits at 2147483647; stack lives one layer below so the
    // privacy pill always wins at the same coordinates.
    'z-index:2147483646',
    'display:flex',
    'flex-direction:column-reverse',
    'gap:10px',
    'overflow:hidden',
    // Container is click-through; only buttons inside cards opt back in.
    'pointer-events:none',
    'font-family:Inter,-apple-system,system-ui,sans-serif',
  ].join(';');
  document.documentElement.appendChild(root);
  return root;
}

function renderSuggestion(s: OverlaySuggestion): void {
  const root = ensureOverlayRoot();
  // Container is column-reverse, so the visually-oldest card is the last DOM
  // child. Drop oldest when we're already at MAX_VISIBLE.
  while (root.children.length >= MAX_VISIBLE) {
    root.lastElementChild?.remove();
  }

  const card = document.createElement('div');
  card.className = 'athena-card';
  card.style.cssText = [
    // Frosted glass — 42% slate-900 + 28px blur keeps the speaker readable.
    'background:rgba(17,24,39,0.42)',
    'backdrop-filter:blur(28px) saturate(160%)',
    '-webkit-backdrop-filter:blur(28px) saturate(160%)',
    'color:#F8FAFC',
    'border:1px solid rgba(255,255,255,0.14)',
    'border-radius:16px',
    'padding:14px 16px',
    'box-shadow:0 12px 40px rgba(0,0,0,0.28),inset 0 1px 0 rgba(255,255,255,0.08)',
    'font-size:14px',
    'line-height:1.45',
    // Card body is click-through; only buttons opt in to pointer events.
    'pointer-events:none',
    'animation:athena-card-in 240ms cubic-bezier(0.22,1,0.36,1)',
    'position:relative',
    'overflow:hidden',
    // Insurance contrast over arbitrary video background.
    'text-shadow:0 1px 2px rgba(0,0,0,0.4)',
  ].join(';');

  const typeKey = s.type ?? 'answer';
  const tagColor = TYPE_TAG_COLOR[typeKey] ?? TYPE_TAG_COLOR.answer;
  const tagLabel = TYPE_TAG_LABEL[typeKey] ?? 'Suggestion';

  const meta = document.createElement('div');
  meta.style.cssText =
    'display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:11px;color:rgba(248,250,252,0.72);font-weight:600;letter-spacing:0.4px';

  const tag = document.createElement('span');
  tag.textContent = tagLabel.toUpperCase();
  tag.style.cssText = `color:${tagColor};text-transform:uppercase;letter-spacing:0.6px`;
  meta.appendChild(tag);

  if (typeof s.confidenceScore === 'number') {
    const conf = document.createElement('span');
    conf.textContent = `· ${s.confidenceScore.toFixed(2)}`;
    conf.style.cssText = 'opacity:0.65;font-weight:500';
    meta.appendChild(conf);
  }

  const spacer = document.createElement('span');
  spacer.style.cssText = 'flex:1';
  meta.appendChild(spacer);

  let removed = false;
  const dismiss = (): void => {
    if (removed) return;
    removed = true;
    card.classList.add('athena-exiting');
    card.style.animation = 'athena-card-out 200ms cubic-bezier(0.4,0,0.2,1) forwards';
    setTimeout(() => card.remove(), 220);
  };

  const close = document.createElement('button');
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss suggestion');
  close.textContent = '\u2715';
  close.style.cssText =
    'pointer-events:auto;cursor:pointer;background:transparent;border:none;color:rgba(248,250,252,0.78);font-size:13px;padding:2px 6px;border-radius:6px;line-height:1;transition:background 150ms ease';
  close.addEventListener('mouseenter', () => {
    close.style.background = 'rgba(255,255,255,0.10)';
  });
  close.addEventListener('mouseleave', () => {
    close.style.background = 'transparent';
  });
  close.addEventListener('click', dismiss);
  meta.appendChild(close);
  card.appendChild(meta);

  if (s.answerText) {
    const a = document.createElement('div');
    a.textContent = s.answerText;
    a.style.cssText = 'color:#F8FAFC;font-weight:500;margin-bottom:6px';
    card.appendChild(a);
  }
  if (s.followupText) {
    const f = document.createElement('div');
    f.textContent = `\u2192 Ask next: ${s.followupText}`;
    f.style.cssText =
      'color:rgba(248,250,252,0.78);font-style:italic;font-size:12px;margin-bottom:4px';
    card.appendChild(f);
  }
  if (s.sources && s.sources.length > 0) {
    const src = document.createElement('div');
    src.style.cssText = 'margin-top:6px;font-size:10px;color:rgba(248,250,252,0.55)';
    src.textContent = `Source · ${s.sources.map((x) => x.documentName ?? '?').join(', ')}`;
    card.appendChild(src);
  }

  // 2px drain bar pinned to bottom edge — visual countdown to auto-dismiss.
  const progress = document.createElement('div');
  progress.className = 'athena-progress';
  progress.style.cssText = [
    'position:absolute',
    'left:0',
    'right:0',
    'bottom:0',
    'height:2px',
    `background:${tagColor}`,
    'opacity:0.7',
    'transform-origin:left center',
    `animation:athena-progress ${HIDE_AFTER_MS}ms linear forwards`,
  ].join(';');
  card.appendChild(progress);

  root.appendChild(card);
  setTimeout(dismiss, HIDE_AFTER_MS);
}

chrome.runtime.onMessage.addListener((msg: { type?: string; suggestion?: OverlaySuggestion }) => {
  if (msg?.type === 'panel.toggle') {
    return; // panel.ts handles via its own message listener if needed
  }
  if (msg?.type !== 'overlay.suggestion' || !msg.suggestion) return;
  try {
    // Always add to history panel — even rationale-only entries are useful
    // for the rep to scroll back through. Toast only renders when there's
    // something speakable on the card; otherwise we'd flash an empty box.
    panel.add(msg.suggestion);
    if (msg.suggestion.answerText || msg.suggestion.followupText) {
      renderSuggestion(msg.suggestion);
    }
  } catch (err) {
    console.warn('[athena-content] overlay render failed', err);
  }
});

// ─── Always-visible "● Athena recording" privacy pill ─────────────────────
//
// Required for trust + light-touch compliance. Pill appears whenever a live
// capture is active, disappears within 1s of stop. Driven off
// chrome.storage.local.capture (set by the background SW).

const PILL_ID = 'athena-recording-pill';

function ensurePillRoot(): void {
  let pill = document.getElementById(PILL_ID);
  if (pill) return;
  pill = document.createElement('div');
  pill.id = PILL_ID;
  pill.style.cssText = [
    'position:fixed',
    'top:24px',
    'right:24px',
    'z-index:2147483647',
    // Same frosted glass as suggestion cards; red dot carries the signal.
    'background:rgba(17,24,39,0.42)',
    'backdrop-filter:blur(28px) saturate(160%)',
    '-webkit-backdrop-filter:blur(28px) saturate(160%)',
    'color:#F8FAFC',
    'border:1px solid rgba(255,255,255,0.14)',
    'padding:6px 12px 6px 10px',
    'border-radius:999px',
    'font:600 11px Inter,-apple-system,system-ui,sans-serif',
    'letter-spacing:0.4px',
    'box-shadow:0 12px 40px rgba(0,0,0,0.28),inset 0 1px 0 rgba(255,255,255,0.08)',
    'text-shadow:0 1px 2px rgba(0,0,0,0.4)',
    'pointer-events:none',
    'display:flex',
    'align-items:center',
    'gap:8px',
  ].join(';');
  const dot = document.createElement('span');
  dot.style.cssText =
    'width:8px;height:8px;border-radius:999px;background:#F87171;box-shadow:0 0 8px rgba(248,113,113,0.7);animation:athena-pulse 1.5s infinite';
  pill.appendChild(dot);
  pill.appendChild(document.createTextNode('Rocket recording'));
  document.documentElement.appendChild(pill);

  // Pulse keyframes — appended once per page.
  if (!document.getElementById('athena-pill-style')) {
    const style = document.createElement('style');
    style.id = 'athena-pill-style';
    style.textContent = '@keyframes athena-pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }';
    document.documentElement.appendChild(style);
  }
}

function removePill(): void {
  document.getElementById(PILL_ID)?.remove();
}

function syncPillFromStorage(): void {
  void chrome.storage.local.get(['capture']).then((s) => {
    const cap = (s.capture ?? null) as { closed?: boolean } | null;
    if (cap && !cap.closed) ensurePillRoot();
    else removePill();
  });
}

syncPillFromStorage();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.capture) return;
  syncPillFromStorage();
});

// ─── Caption observer ──────────────────────────────────────────────────────
//
// Meet renders captions inside an aria-labelled region. Each caption line is
// a node containing speaker name + text. We track per-node text; once a node
// stops mutating for ~1.5s OR is removed, we treat its current text as final
// and emit one `meet.caption` for it.

interface PendingCaption {
  text: string;
  speaker: string | null;
  lastSeenAt: number;
  emitted: boolean;
}

const pendingCaptions = new WeakMap<Element, PendingCaption>();
const CAPTION_FINALIZE_MS = 1500;

function findCaptionRegion(): Element | null {
  // Meet ships multiple caption-related elements. We want the live text
  // container, NOT the "Turn captions on" button. Try several strategies in
  // order of specificity. The exact CSS classes mutate frequently, so we
  // bias toward semantic markers (role + aria-label) and known jsname tags.
  const strategies: Array<() => Element | null> = [
    // 1. Modern Meet (2024+): role="region" + aria-label containing "caption"
    () => document.querySelector('[role="region"][aria-label*="aption" i]'),
    () => document.querySelector('[role="region"][aria-label*="ubtitle" i]'),
    // 2. Known stable jsname attributes for the caption surface
    () => document.querySelector('div[jsname="dsyhDe"]'),
    () => document.querySelector('div[jsname="tgaKEf"]'),
    // 3. aria-live polite container — but ONLY if it ALSO has an aria-label
    //    mentioning captions/subtitles. Without that constraint we match the
    //    participant announcer or other live regions.
    () => {
      const live = document.querySelectorAll<HTMLElement>('[aria-live="polite"]');
      for (const el of Array.from(live)) {
        if (el.getAttribute('role') === 'button') continue;
        const label = (el.getAttribute('aria-label') ?? '').toLowerCase();
        if (!label.includes('caption') && !label.includes('subtitle')) continue;
        return el;
      }
      return null;
    },
    // 4. Class-name heuristic — Meet's caption surface often has a class
    //    containing "caption" (e.g. nMcdL, but also a11y-friendly classes).
    () => {
      const byClass = document.querySelectorAll<HTMLElement>('div[class*="caption" i], div[class*="Caption"]');
      for (const el of Array.from(byClass)) {
        const txt = (el.textContent ?? '').trim();
        if (txt.length > 4 && el.querySelectorAll('button').length === 0) return el;
      }
      return null;
    },
    // 4. Fallback: any aria-labeled element whose label mentions captions and
    //    is NOT a button.
    () => {
      const labelled = document.querySelectorAll<HTMLElement>('[aria-label]');
      for (const el of Array.from(labelled)) {
        const label = el.getAttribute('aria-label')?.toLowerCase() ?? '';
        if (!label.includes('caption') && !label.includes('subtitle')) continue;
        if (el.getAttribute('role') === 'button') continue;
        if (el.tagName === 'BUTTON') continue;
        return el;
      }
      return null;
    },
  ];
  for (const s of strategies) {
    try {
      const found = s();
      if (found) return found;
    } catch {
      /* keep trying */
    }
  }
  return null;
}

/**
 * Polling text differ — fallback for when MutationObserver misses Meet's
 * caption updates (e.g. when Meet rerenders the entire region instead of
 * mutating a child node). Captures a rolling snapshot of caption text and
 * emits everything new since the last snapshot once it's been stable for
 * >=1.5s. This works regardless of the internal DOM shape — as long as
 * findCaptionRegion() returns *some* element whose textContent grows when
 * captions update, we ship.
 */
function startCaptionPoller(region: Element, getMeetingId: () => string | null): void {
  let lastText = '';
  let lastChangeAt = Date.now();
  let lastEmittedTail = '';
  setInterval(() => {
    const meetingId = getMeetingId();
    if (!meetingId) return;
    const current = (region.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!current) return;
    if (current !== lastText) {
      lastText = current;
      lastChangeAt = Date.now();
      return;
    }
    if (Date.now() - lastChangeAt < 1500) return;
    // Region has been stable >=1.5s. Ship any text that's new since the
    // last emission.
    let toEmit = current;
    if (lastEmittedTail && current.includes(lastEmittedTail)) {
      const idx = current.lastIndexOf(lastEmittedTail);
      toEmit = current.slice(idx + lastEmittedTail.length).trim();
    }
    if (!toEmit) return;
    // Split on sentence boundaries so we ship one objection per message
    // instead of a multi-sentence blob.
    const sentences = toEmit.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [toEmit];
    for (const s of sentences) {
      const text = s.trim();
      if (text.length < 3) continue;
      const msg: RuntimeMessage = {
        type: 'meet.caption',
        meetingId,
        text,
        speakerLabel: null,
        capturedAt: new Date().toISOString(),
      };
      void chrome.runtime.sendMessage(msg);
    }
    // Keep last ~80 chars as the "tail" so the next snapshot can dedupe.
    lastEmittedTail = current.slice(-80);
    lastChangeAt = Date.now();
  }, 800);
}

function extractSpeaker(node: Element): string | null {
  // Speaker name is usually a leaf with class containing "speaker" or sits
  // adjacent to an avatar. Heuristic: first text-bearing child that's <16
  // chars and ends without sentence punctuation.
  const candidate = node.querySelector('[data-self-name], [data-participant-id]');
  if (candidate?.textContent) return candidate.textContent.trim();
  const t = node.firstElementChild?.textContent?.trim() ?? null;
  if (t && t.length > 0 && t.length < 40 && !/[.!?]\s*$/.test(t)) return t;
  return null;
}

function emitFinal(meetingId: string, line: PendingCaption): void {
  if (line.emitted) return;
  if (!line.text) return;
  line.emitted = true;
  const msg: RuntimeMessage = {
    type: 'meet.caption',
    meetingId,
    text: line.text,
    speakerLabel: line.speaker,
    capturedAt: new Date().toISOString(),
  };
  void chrome.runtime.sendMessage(msg);
}

function observeCaptions(): void {
  const region = findCaptionRegion();
  if (!region) return;
  const observer = new MutationObserver((records) => {
    const meetingId = lastReportedId;
    if (!meetingId) return;
    for (const rec of records) {
      // Newly added line nodes
      for (const node of Array.from(rec.addedNodes)) {
        if (!(node instanceof Element)) continue;
        if (!node.textContent?.trim()) continue;
        pendingCaptions.set(node, {
          text: node.textContent.trim(),
          speaker: extractSpeaker(node),
          lastSeenAt: Date.now(),
          emitted: false,
        });
      }
      // Removed line nodes — finalize them.
      for (const node of Array.from(rec.removedNodes)) {
        if (!(node instanceof Element)) continue;
        const line = pendingCaptions.get(node);
        if (line) emitFinal(meetingId, line);
      }
      // Mutation on an existing line — refresh text + lastSeen.
      if (rec.target instanceof Element) {
        const line = pendingCaptions.get(rec.target);
        if (line) {
          line.text = rec.target.textContent?.trim() ?? line.text;
          line.lastSeenAt = Date.now();
        }
      }
    }
  });
  observer.observe(region, { childList: true, subtree: true, characterData: true });

  // Sweeper: emit caption lines that have been quiet for >1.5s.
  setInterval(() => {
    const meetingId = lastReportedId;
    if (!meetingId) return;
    const now = Date.now();
    region.querySelectorAll('*').forEach((el) => {
      const line = pendingCaptions.get(el);
      if (!line || line.emitted) return;
      if (now - line.lastSeenAt > CAPTION_FINALIZE_MS) emitFinal(meetingId, line);
    });
  }, 500);
}

// Caption-DOM scraping is parked. Production Meet capture flows through the
// chrome.tabCapture audio path (see apps/chrome-extension/src/offscreen) →
// gateway WS → Deepgram STT. The DOM helpers above are kept for a future
// no-audio-permission fallback but are NOT invoked at runtime. To re-enable
// the legacy scraper, uncomment the captionPoll block at the bottom of this
// file.
/*
let captionAttempts = 0;
let lastDiagAt = 0;
const captionPoll = setInterval(() => {
  captionAttempts += 1;
  if (captionAttempts > 360) {
    clearInterval(captionPoll);
    return;
  }
  const region = findCaptionRegion();
  if (captionAttempts % 12 === 0 && Date.now() - lastDiagAt > 5000) {
    lastDiagAt = Date.now();
    const diag = {
      attempts: captionAttempts,
      regionFound: !!region,
      regionTagPreview: region ? `${region.tagName}[${region.getAttribute('aria-label') ?? region.getAttribute('jsname') ?? ''}]` : null,
      strategyHits: {
        roleRegionCaption: document.querySelectorAll('[role="region"][aria-label*="aption" i]').length,
        roleRegionSubtitle: document.querySelectorAll('[role="region"][aria-label*="ubtitle" i]').length,
        jsnameDsyhDe: document.querySelectorAll('div[jsname="dsyhDe"]').length,
        jsnameTgaKEf: document.querySelectorAll('div[jsname="tgaKEf"]').length,
        ariaLivePolite: document.querySelectorAll('[aria-live="polite"]').length,
      },
      ariaLabelledCandidates: [...document.querySelectorAll<HTMLElement>('[aria-label]')]
        .filter((e) => {
          const x = (e.getAttribute('aria-label') ?? '').toLowerCase();
          return (x.includes('caption') || x.includes('subtitle')) && e.tagName !== 'BUTTON' && e.getAttribute('role') !== 'button';
        })
        .slice(0, 5)
        .map((e) => ({
          tag: e.tagName,
          aria: e.getAttribute('aria-label'),
          role: e.getAttribute('role'),
          jsname: e.getAttribute('jsname'),
          textPreview: (e.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 100),
        })),
    };
    // eslint-disable-next-line no-console
    console.log('[athena-content] caption diag', diag);
  }
  if (region) {
    clearInterval(captionPoll);
    // eslint-disable-next-line no-console
    console.log('[athena-content] caption region attached', { aria: region.getAttribute('aria-label'), jsname: region.getAttribute('jsname') });
    observeCaptions();
    startCaptionPoller(region, () => lastReportedId);
  }
}, 500);
*/
