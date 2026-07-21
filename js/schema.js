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
  CALL_HELP:    'Um Hilfe rufen',
  CPR_INTRO:    '30 Kompressionen, 5 bis 6 Zentimeter tief',
  VENTILATE:    '2 Beatmungen',
  RESUME:       'Weiter',
  ROTATE:       'Helferwechsel',
  RECOVERY:     'Stabile Seitenlage. Lebensfunktionen überwachen.',
  KEEP_WARM:    'Wärmeerhalt. Decke oder Rettungsdecke.',
  CHECK_VITALS: 'Lebensfunktionen prüfen. Atmung? Bewusstsein?',
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
  WARMTH_MAINTAINED:    'Wärmeerhalt',
  STEP_SKIPPED:         'Schritt übersprungen',
  VITALS_CHECKED:       'Lebensfunktionen geprüft',
  VITALS_WORSENED:      'Zustand verschlechtert',
  SESSION_ENDED:        'Einsatz beendet',
});

/* ---- Step graph ----------------------------------------------------------- *
 * kind:
 *   'instruction' — title + hint + navigation options (each may log one event)
 *   'breathing'   — bounded timed check with two answers (US-3)
 *   'alarm'       — in-place log buttons + always-present "HLW starten" (US-4)
 *   'cpr'          — audio-paced CPR engine screen (US-5/US-6)
 *   'recovery-step'— one recovery-position step: confirm or skip (US-8)
 *   'monitor'      — recurring 3-min vital-sign check loop (US-9)
 * Every recovery-step and monitor screen also carries a permanent red
 * "Atmet nicht mehr" escalation into CPR (US-10).
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
      { label: 'Atmet normal', logs: 'BREATHING_NORMAL', next: 'recovery_position' },
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
    signsOfLife: { label: 'Lebenszeichen', logs: 'SIGNS_OF_LIFE', next: 'recovery_position' },
  },

  /* ---- Recovery-position branch (US-8) — one instruction per screen -------- */
  recovery_position: {
    id: 'recovery_position',
    kind: 'recovery-step',
    title: 'Stabile Seitenlage',
    hint: 'Atemwege freihalten – auf die Seite drehen.',
    enterCue: 'RECOVERY',
    confirm: { label: 'Seitenlage hergestellt', logs: 'RECOVERY_POSITION', next: 'recovery_call' },
    skip: { detail: 'Seitenlage', next: 'recovery_call' },
    // On-demand how-to (kept as reviewable data, Q3). Wording pending San A review.
    info: {
      label: 'Wie geht die stabile Seitenlage?',
      title: 'Stabile Seitenlage – Schritt für Schritt',
      steps: [
        'Neben dem Patienten knien, beide Beine des Patienten gestreckt.',
        'Nahen Arm rechtwinklig nach oben abwinkeln, Handfläche nach oben.',
        'Fernen Arm über die Brust führen, Handrücken an die nahe Wange legen.',
        'Fernes Bein am Knie anwinkeln, Fuß auf dem Boden aufstellen.',
        'Am fernen Knie fassen und den Patienten zu sich auf die Seite drehen.',
        'Oberes Bein so ausrichten, dass Hüfte und Knie im rechten Winkel liegen.',
        'Kopf überstrecken, Mund leicht nach unten – Atemwege bleiben frei.',
        'Atmung fortlaufend kontrollieren.',
      ],
    },
    source: 'San A 2021 – Auffinden eines Notfallpatienten II',
  },

  recovery_call: {
    id: 'recovery_call',
    kind: 'recovery-step',
    title: 'Notruf 112 – AED holen lassen',
    hint: 'Falls noch nicht geschehen: Notruf absetzen lassen.',
    // If EMERGENCY_CALL_PLACED is already in the journal, the controller shows a
    // confirmed row with its time and a one-tap "Weiter" (US-8/S3).
    alreadyLogged: 'EMERGENCY_CALL_PLACED',
    confirm: { label: 'Notruf abgesetzt', logs: 'EMERGENCY_CALL_PLACED', next: 'recovery_warmth' },
    skip: { detail: 'Notruf', next: 'recovery_warmth' },
    source: 'San A 2021 – Auffinden eines Notfallpatienten II',
  },

  recovery_warmth: {
    id: 'recovery_warmth',
    kind: 'recovery-step',
    title: 'Wärmeerhalt',
    hint: 'Decke oder Rettungsdecke – Auskühlung vermeiden.',
    enterCue: 'KEEP_WARM',
    confirm: { label: 'Wärmeerhalt hergestellt', logs: 'WARMTH_MAINTAINED', next: 'monitor' },
    skip: { detail: 'Wärmeerhalt', next: 'monitor' },
    source: 'San A 2021 – Auffinden eines Notfallpatienten II',
  },

  /* ---- Monitoring loop (US-9) --------------------------------------------- */
  monitor: {
    id: 'monitor',
    kind: 'monitor',
    title: 'Überwachen',
    hint: 'Lebensfunktionen alle 3 Minuten prüfen.',
    question: 'Atmung? Bewusstsein?',
    reminderSeconds: CONFIG.RECOVERY_REMINDER_SECONDS,
    reminderCue: 'CHECK_VITALS',
    source: 'San A 2021 – Auffinden eines Notfallpatienten II',
  },
});

export function getStep(id) {
  return STEPS[id];
}
