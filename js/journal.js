/* SanGuide — journal rendering & handover (US-7/S3, US-7/S4).
 *
 * Turns the persisted event list into a short, chronological plain-text protocol
 * for EMS: a header (start time + total CPR duration), one "HH:MM:SS — event"
 * line per event, and a footer noting the app is a guidance aid. Sharing goes
 * through the OS share sheet (the only data-out interface, I-2); where the Web
 * Share API is missing it degrades to a clipboard copy with the full text shown
 * on screen so it can be read aloud or photographed.
 */

import { EVENT_LABELS } from './schema.js';

function hhmmss(ts) {
  return new Date(ts).toLocaleTimeString('de-DE', { hour12: false });
}

/* Absolute date + time, e.g. "19.07.2026, 21:58:01" — anchors the protocol to a
 * day so the running per-event clock below is unambiguous (US-7/S3). */
function fullDateTime(ts) {
  return new Date(ts).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

/* Hands-on CPR duration reconstructed from timestamps (paused spans removed). */
export function computeCprDurationMs(events) {
  let total = 0;
  let onStart = null;
  let pausedAt = null;
  for (const e of events) {
    switch (e.type) {
      case 'CPR_STARTED':
        onStart = e.at; pausedAt = null; break;
      case 'CPR_PAUSED':
        if (onStart != null && pausedAt == null) pausedAt = e.at; break;
      case 'CPR_RESUMED':
        pausedAt = null; break;
      case 'SIGNS_OF_LIFE':
      case 'SESSION_ENDED':
        if (onStart != null) {
          const end = pausedAt != null ? pausedAt : e.at;
          total += end - onStart;
          onStart = null; pausedAt = null;
        }
        break;
      default:
        break;
    }
  }
  return total;
}

function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, '0')} min`;
}

export function renderJournalText(session) {
  const lines = [];
  lines.push('SanGuide — Einsatzprotokoll');
  const firstAt = session.events.length ? session.events[0].at : session.startedAt;
  lines.push('Einsatzbeginn: ' + fullDateTime(firstAt));
  if (session.endedAt) lines.push('Einsatzende:   ' + hhmmss(session.endedAt));
  lines.push('HLW-Dauer (Hands-on): ' + formatDuration(computeCprDurationMs(session.events)));
  lines.push('');

  for (const e of session.events) {
    const label = EVENT_LABELS[e.type] || e.type;
    lines.push(`${hhmmss(e.at)} — ${label}${e.detail ? ' (' + e.detail + ')' : ''}`);
  }

  lines.push('');
  lines.push('Hinweis: SanGuide ist eine Hilfe zur Ablaufführung und ersetzt');
  lines.push('weder die Ausbildung noch den Notruf. Zeiten sind Gerätezeiten.');
  return lines.join('\n');
}

/* Returns { method: 'share' | 'clipboard' | 'display', text }. */
export async function shareJournal(session) {
  const text = renderJournalText(session);
  if (navigator.share) {
    try {
      await navigator.share({ title: 'SanGuide Einsatzprotokoll', text });
      return { method: 'share', text };
    } catch (err) {
      if (err && err.name === 'AbortError') return { method: 'share', text };
      // fall through to clipboard on real failure
    }
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return { method: 'clipboard', text };
    } catch (_) { /* fall through */ }
  }
  return { method: 'display', text };
}
