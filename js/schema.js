/* SanGuide — F1 schema (content as data, Q3).
 *
 * This module is DATA, not logic: the step graph, the German cue/label text and
 * the timing constants all live here so a medical reviewer can change guidance
 * wording or timing without touching the state machine. Every step carries a
 * `source` citation back to San A 2021. Guideline changes require no code change.
 *
 * Sources (San A 2021): "Auffinden eines Notfallpatienten II", "Atemkontrolle",
 * "Herz-Lungen-Wiederbelebung (HLW)". Exact wording is pending a review pass by
 * the training officer (Q3 open point) — the citations name the source chapter.
 */

/* ---- Timing / rate constants (D1, D2, D4; US-1/S2, US-3) ------------------ */

export const CONFIG = Object.freeze({
  COMPRESSION_RATE_BPM: 110,     // D1 — fixed, not configurable
  COMPRESSIONS_PER_CYCLE: 30,    // 30:2
  VENTILATIONS_PER_CYCLE: 2,
  VENTILATION_WINDOW_MS: 5000,   // D2 — fixed hands-free window
  CYCLES_PER_BLOCK: 5,           // D4 — 5×30:2 then rotation prompt
  BREATHING_CHECK_SECONDS: 10,   // US-3 — bounded breathing check
  RECOVERY_REMINDER_SECONDS: 180, // US-3/S2 — recurring 3-min check
  RESUME_WINDOW_MS: 4 * 60 * 60 * 1000, // US-1/S2 — resume a session < 4 h old
});

/* Derived: milliseconds between two compression clicks at the fixed rate. */
export const CLICK_INTERVAL_MS = 60000 / CONFIG.COMPRESSION_RATE_BPM; // ≈ 545.45

/* ---- Spoken cues (German). Keys are stable; text is reviewable data. ------ */
/* Each key also maps to a distinct fallback tone in audio.js (R1 mitigation). */

export const CUES = Object.freeze({
  CALL_HELP:   'Um Hilfe rufen',
  CPR_INTRO:   '30 Kompressionen, 5 bis 6 Zentimeter tief',
  VENTILATE:   '2 Beatmungen',
  RESUME:      'Weiter',
  ROTATE:      'Helferwechsel',
  CHECK_LIFE:  'Lebensfunktionen prüfen',
});

/* ---- Journal labels (German) for the handover text (US-7/S3). ------------- */

export const EVENT_LABELS = Object.freeze({
  SESSION_STARTED:      'Einsatz gestartet',
  UNRESPONSIVE:         'Keine Reaktion',
  RESPONSIVE:           'Reaktion vorhanden',
  NO_NORMAL_BREATHING:  'Keine normale Atmung',
  BREATHING_NORMAL:     'Normale Atmung',
  EMERGENCY_CALL_PLACED:'Notruf abgesetzt',
  AED_REQUESTED:        'AED angefordert',
  CPR_STARTED:          'HLW begonnen',
  CPR_PAUSED:           'HLW pausiert',
  CPR_RESUMED:          'HLW fortgesetzt',
  CYCLE_COMPLETED:      'Zyklus abgeschlossen – Helferwechsel',
  SIGNS_OF_LIFE:        'Lebenszeichen',
  RECOVERY_POSITION:    'Stabile Seitenlage',
  SESSION_ENDED:        'Einsatz beendet',
});

/* ---- Step graph ----------------------------------------------------------- *
 * kind:
 *   'instruction' — title + hint + navigation options (each may log one event)
 *   'breathing'   — bounded timed check with two answers (US-3)
 *   'alarm'       — in-place log buttons + always-present "HLW starten" (US-4)
 *   'cpr'         — audio-paced CPR engine screen (US-5/US-6)
 *   'recovery'    — recovery-position path with a recurring reminder (US-3/S2)
 * option: { label, logs?, next }  — logs is persisted BEFORE navigation (US-7/S1)
 */

export const FIRST_STEP_ID = 'safety';

export const STEPS = Object.freeze({
  safety: {
    id: 'safety',
    kind: 'instruction',
    title: 'Eigengefährdung?',
    hint: 'Erst die Lage sichern – dann zum Patienten.',
    options: [
      { label: 'Sicher – weiter', next: 'consciousness' },
    ],
    source: 'San A 2021 – Auffinden eines Notfallpatienten II',
  },

  consciousness: {
    id: 'consciousness',
    kind: 'instruction',
    title: 'Anschauen – Ansprechen – Anfassen',
    // D6: no "Reagiert" branch in F1; single warning line + single action.
    hint: 'Nur fortfahren, wenn keine Reaktion.',
    options: [
      { label: 'Reagiert nicht', logs: 'UNRESPONSIVE', next: 'callHelp' },
    ],
    source: 'San A 2021 – Auffinden eines Notfallpatienten II',
  },

  callHelp: {
    id: 'callHelp',
    kind: 'instruction',
    title: 'Um Hilfe rufen',
    hint: 'Umstehende gezielt ansprechen.',
    cue: 'CALL_HELP',
    options: [
      { label: 'Weiter zur Atemkontrolle', next: 'breathing' },
    ],
    source: 'San A 2021 – Auffinden eines Notfallpatienten II',
  },

  breathing: {
    id: 'breathing',
    kind: 'breathing',
    title: 'Kopf überstrecken, Kinn anheben – Atmung prüfen: sehen, hören, fühlen',
    // US-3/S4 — permanent, safety-critical: gasping/seizure = NOT normal.
    hint: 'Schnappatmung und Krämpfe zählen als KEINE normale Atmung.',
    timerSeconds: CONFIG.BREATHING_CHECK_SECONDS,
    options: [
      { label: 'Atmet normal', logs: 'BREATHING_NORMAL', next: 'recovery' },
      { label: 'Atmet nicht normal (auch Schnappatmung)',
        logs: 'NO_NORMAL_BREATHING', next: 'alarm' },
    ],
    source: 'San A 2021 – Atemkontrolle',
  },

  alarm: {
    id: 'alarm',
    kind: 'alarm',
    title: '112 veranlassen – AED holen lassen',
    hint: 'Blockiert nie: HLW kann sofort gestartet werden.',
    // In-place confirmations (log, then show the time) — never block CPR.
    confirmations: [
      { label: 'Notruf abgesetzt', logs: 'EMERGENCY_CALL_PLACED' },
      { label: 'AED holen lassen', logs: 'AED_REQUESTED' },
    ],
    // Always-present primary — CPR start is one tap away (US-4/S1/S3).
    primary: { label: 'HLW starten', next: 'cpr' },
    source: 'San A 2021 – Herz-Lungen-Wiederbelebung (HLW)',
  },

  cpr: {
    id: 'cpr',
    kind: 'cpr',
    title: 'HLW läuft – 30:2',
    source: 'San A 2021 – Herz-Lungen-Wiederbelebung (HLW)',
    // Options rendered as large targets during pacing.
    signsOfLife: { label: 'Lebenszeichen', logs: 'SIGNS_OF_LIFE', next: 'recovery' },
  },

  recovery: {
    id: 'recovery',
    kind: 'recovery',
    title: 'Stabile Seitenlage',
    hint: 'Atmung fortlaufend kontrollieren.',
    // Entering this path records the position; recurring reminder every 3 min.
    onEnter: 'RECOVERY_POSITION',
    reminderSeconds: CONFIG.RECOVERY_REMINDER_SECONDS,
    reminderCue: 'CHECK_LIFE',
    steps: [
      'In stabile Seitenlage bringen',
      'Notruf 112 sicherstellen',
      'Wärmeerhalt – zudecken',
      'Atmung & Lebensfunktionen alle 3 Minuten prüfen',
    ],
    source: 'San A 2021 – Auffinden eines Notfallpatienten II',
  },
});

export function getStep(id) {
  return STEPS[id];
}
