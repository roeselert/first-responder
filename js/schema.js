/* SanGuide — schema content (content as data, Q3).
 *
 * This module is DATA, not logic: the step graphs, the German cue/label text and
 * the timing constants all live here so a medical reviewer can change guidance
 * wording or timing without touching the state machine. Every step carries a
 * `source` citation back to San A 2021. Guideline changes require no code change.
 *
 * Two schemas share one graph, branching at "Anschauen – Ansprechen – Anfassen":
 *  - F1 "Auffinden eines Notfallpatienten II" (unresponsive): callHelp → breathing
 *    → alarm → CPR / recovery position. Sources: "Auffinden eines Notfall-
 *    patienten II", "Atemkontrolle", "Herz-Lungen-Wiederbelebung (HLW)".
 *  - F2 "Auffinden eines ansprechbaren Notfallpatienten" (responsive): the r_*
 *    steps below. Source: DLRG Teilnehmerunterlage Sanitätsausbildung A,
 *    Schema S. 82 (Erläuterung S. 12–15). The left-hand questions are worked
 *    sequentially; every "Ja" triggers the measure on the right; the whole
 *    schema repeats every 3–5 minutes until EMS arrives (US-12).
 *
 * Exact wording is pending a review pass by the training officer (Q3 open
 * point) — the citations name the source chapter.
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
  SCHEMA_REPEAT_SECONDS: 180,    // F2/US-12 — re-run the schema every 3–5 min
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
  REPEAT_SCHEMA:'Kontrolle: Schema erneut durchlaufen. Blutdruck und Puls prüfen.',
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
  /* F2 — responsive patient (DLRG San A, Schema S. 82) */
  CONSCIOUSNESS_LOST:   'Bewusstsein verloren – Wechsel zu Schema II',
  PATIENT_ENDANGERED:   'Patient an Fundstelle gefährdet',
  PATIENT_RESCUED:      'Patient aus Gefahrenbereich gerettet',
  BLEEDING_DETECTED:    'Bedrohliche Blutung erkannt',
  BLEEDING_CONTROLLED:  'Blutung gestillt',
  TOURNIQUET_APPLIED:   'Tourniquet angelegt (Abbindezeitpunkt)',
  SPINE_SUSPECTED:      'Hinweis auf HWS-Verletzung',
  SPINE_IMMOBILIZED:    'HWS immobilisiert',
  AIRWAY_OBSTRUCTED:    'Atemwegsverlegung erkannt',
  AIRWAY_CLEARED:       'Atemwege freigemacht',
  OXYGEN_INDICATED:     'Luftnot / Brustschmerz / Schlaganfallzeichen',
  OXYGEN_GIVEN:         'Sauerstoff verabreicht',
  VITALS_MEASURED:      'Blutdruck und Puls gemessen',
  SHOCK_SUSPECTED:      'Schockanzeichen erkannt',
  SHOCK_POSITION:       'Schocklagerung hergestellt',
  SHOCK_CONTRAINDICATED:'Keine Schocklagerung (Kontraindikation) – Wärmeerhalt',
  MOVEMENT_IMPAIRED:    'Bewegung/Gefühl eingeschränkt – Wirbelsäulenverdacht',
  AXIAL_POSITIONING:    'Achsengerechte Lagerung',
  ABDOMEN_GUARDING:     'Abwehrspannung / akutes Abdomen erkannt',
  ABDOMEN_POSITION:     'Bauchdeckenentlastende Lagerung',
  SCHEMA_REPEATED:      'Schema erneut durchlaufen',
});

/* ---- Step graph ----------------------------------------------------------- *
 * kind:
 *   'instruction' — title + hint + navigation options (each may log one event)
 *   'breathing'   — bounded timed check with two answers (US-3)
 *   'alarm'       — in-place log buttons + always-present "HLW starten" (US-4)
 *   'cpr'          — audio-paced CPR engine screen (US-5/US-6)
 *   'recovery-step'— one measure step: confirm / alt / skip / extra log buttons
 *   'monitor'      — recurring reminder loop, data-driven due actions
 * Every recovery-step and monitor screen also carries a permanent red
 * escalation button (`escalate`, defaulting to ESCALATE_TO_CPR); instruction
 * steps may opt in via their own `escalate`.
 * option: { label, logs?, next }  — logs is persisted BEFORE navigation (US-7/S1)
 */

export const FIRST_STEP_ID = 'safety';

/* Default escalation (F1): breathing stopped → straight into CPR (US-10). */
export const ESCALATE_TO_CPR = Object.freeze({
  label: 'Atmet nicht mehr', logs: 'NO_NORMAL_BREATHING', next: 'cpr',
});

/* F2 escalation (US-12 Negativfall): patient loses consciousness → switch to
 * schema II ("Auffinden eines Notfallpatienten II"): call for help, then the
 * timed breathing check branches into CPR or recovery position. */
const ESCALATE_RESPONSIVE = Object.freeze({
  label: 'Reagiert nicht mehr', logs: 'CONSCIOUSNESS_LOST', next: 'callHelp',
});

const SRC_F2 = 'DLRG San A – Auffinden eines ansprechbaren Notfallpatienten (S. 82)';

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
    // Branch point of the two schemas. "Reagiert nicht" stays the primary
    // (first) action; "Reagiert" enters F2 (responsive patient).
    hint: 'Reaktion prüfen: laut ansprechen, vorsichtig an den Schultern fassen.',
    options: [
      { label: 'Reagiert nicht', logs: 'UNRESPONSIVE', next: 'callHelp' },
      { label: 'Reagiert', logs: 'RESPONSIVE', next: 'r_danger' },
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
    dueHint: 'Schnappatmung zählt als keine normale Atmung.',
    reminderSeconds: CONFIG.RECOVERY_REMINDER_SECONDS,
    reminderCue: 'CHECK_VITALS',
    // A due action without `next` resets the countdown (stay in the loop).
    dueActions: [
      { label: 'Unverändert', style: 'primary', logs: 'VITALS_CHECKED', detail: 'unverändert' },
      { label: 'Verschlechtert', style: 'danger', logs: 'VITALS_WORSENED', next: 'breathing' },
    ],
    source: 'San A 2021 – Auffinden eines Notfallpatienten II',
  },

  /* ======================================================================== *
   * F2 — "Auffinden eines ansprechbaren Notfallpatienten" (DLRG San A S. 82) *
   * Left-hand questions in sequence; "Ja" triggers the measure on the right; *
   * the loop (r_monitor) re-runs the whole schema every 3–5 min (US-12).     *
   * ======================================================================== */

  /* US-02 — patient endangered at the scene? */
  r_danger: {
    id: 'r_danger',
    kind: 'instruction',
    title: 'Patient gefährdet?',
    hint: 'Gefährden Fundstelle oder Auffindeposition den Patienten? Sonst bleibt er in der Auffindeposition.',
    options: [
      { label: 'Ja – gefährdet', logs: 'PATIENT_ENDANGERED', next: 'r_rescue' },
      { label: 'Nein – weiter', next: 'r_call' },
    ],
    escalate: ESCALATE_RESPONSIVE,
    source: SRC_F2,
  },

  r_rescue: {
    id: 'r_rescue',
    kind: 'recovery-step',
    title: 'Retten',
    hint: 'Unter Beachtung des Eigenschutzes aus dem Gefahrenbereich retten – ggf. weitere Kräfte nachalarmieren.',
    confirm: { label: 'Patient gerettet', logs: 'PATIENT_RESCUED', next: 'r_call' },
    skip: { detail: 'Rettung', next: 'r_call' },
    escalate: ESCALATE_RESPONSIVE,
    source: SRC_F2,
  },

  /* US-03 — emergency call, at the latest here. */
  r_call: {
    id: 'r_call',
    kind: 'recovery-step',
    title: 'Notruf 112',
    hint: 'Spätestens jetzt: Notruf absetzen oder veranlassen.',
    alreadyLogged: 'EMERGENCY_CALL_PLACED',
    confirm: { label: 'Notruf abgesetzt', logs: 'EMERGENCY_CALL_PLACED', next: 'r_bleeding' },
    skip: { detail: 'Notruf', next: 'r_bleeding' },
    escalate: ESCALATE_RESPONSIVE,
    source: SRC_F2,
  },

  /* US-04 — life-threatening bleeding. */
  r_bleeding: {
    id: 'r_bleeding',
    kind: 'instruction',
    title: 'Bedrohliche Blutung?',
    hint: 'Starke, spritzende oder anhaltende Blutung?',
    options: [
      { label: 'Ja – Blutung', logs: 'BLEEDING_DETECTED', next: 'r_bleeding_control' },
      { label: 'Nein – weiter', next: 'r_spine' },
    ],
    escalate: ESCALATE_RESPONSIVE,
    source: SRC_F2,
  },

  r_bleeding_control: {
    id: 'r_bleeding_control',
    kind: 'recovery-step',
    title: 'Blutung stillen',
    hint: 'Hinlegen, verletztes Körperteil hochhalten. Arm/Bein/Kopf: Druckverband. Hals/Rumpf: Wundauflagen aufdrücken.',
    confirm: { label: 'Blutung gestillt', logs: 'BLEEDING_CONTROLLED', next: 'r_spine' },
    skip: { detail: 'Blutstillung', next: 'r_spine' },
    // US-04/S2 — tourniquet time is documented by the tap timestamp itself.
    extras: [
      { label: 'Tourniquet angelegt', logs: 'TOURNIQUET_APPLIED' },
    ],
    infos: [
      {
        label: 'Wie lege ich einen Druckverband an?',
        title: 'Druckverband anlegen – Schritt für Schritt',
        steps: [
          'Patienten hinlegen, verletztes Körperteil hochhalten.',
          'Sterile Wundauflage auf die Wunde legen.',
          'Wundauflage mit zwei bis drei Bindegängen fixieren.',
          'Druckkörper (z. B. ein zweites, verpacktes Verbandpäckchen) direkt über der Wunde auf die Wundauflage legen.',
          'Druckkörper mit weiteren Bindegängen unter kräftigem Zug fixieren, Bindenende feststecken oder verknoten.',
          'Blutet es durch: nicht abwickeln – zweiten Druckverband darüber anlegen.',
          'Körperteil weiter hochhalten; Finger/Zehen auf Durchblutung kontrollieren.',
        ],
      },
      {
        label: 'Wie stille ich die Blutung?',
        title: 'Blutstillung – Kurzschema',
        steps: [
          'Patienten hinlegen, verletztes Körperteil hochhalten.',
          'Arm, Bein oder Kopf: Druckverband anlegen (alternativ Notverband).',
          'Hals oder Rumpf: mehrere sterile Wundauflagen fest aufdrücken, am Rumpf wenn möglich Druckverband.',
          'Amputation: Auflagen aufpressen, Druckverband, ggf. Tourniquet; Amputat versorgen.',
          'Tourniquet nur, wenn keine andere Blutstillung möglich und die Lage lebensbedrohlich ist: oberhalb der Blutung anlegen, Knebel drehen bis die Blutung steht, fixieren.',
          'Abbindezeitpunkt dokumentieren – Button „Tourniquet angelegt“ antippen.',
          'Begleitend: Schockbekämpfung, Wärmeerhalt, ständige Vitalkontrolle.',
        ],
      },
    ],
    escalate: ESCALATE_RESPONSIVE,
    source: SRC_F2 + ' · Blutstillung',
  },

  /* US-05 — cervical spine. */
  r_spine: {
    id: 'r_spine',
    kind: 'instruction',
    title: 'Hinweis auf HWS-Verletzung?',
    hint: 'Kopfverletzung, Unfallhergang, Schmerzen an der Halswirbelsäule, Lähmungserscheinungen?',
    options: [
      { label: 'Ja – Verdacht', logs: 'SPINE_SUSPECTED', next: 'r_spine_immob' },
      { label: 'Nein – weiter', next: 'r_airway' },
    ],
    escalate: ESCALATE_RESPONSIVE,
    source: SRC_F2,
  },

  r_spine_immob: {
    id: 'r_spine_immob',
    kind: 'recovery-step',
    title: 'HWS immobilisieren',
    hint: 'Manuell in Neutralposition halten (InLine-Stabilisierung) oder Stützkragen – danach nicht mehr unterbrechen.',
    confirm: { label: 'HWS immobilisiert', logs: 'SPINE_IMMOBILIZED', next: 'r_airway' },
    skip: { detail: 'HWS-Immobilisation', next: 'r_airway' },
    escalate: ESCALATE_RESPONSIVE,
    source: SRC_F2,
  },

  /* US-06 — airway obstruction. */
  r_airway: {
    id: 'r_airway',
    kind: 'instruction',
    title: 'Atemwege verlegt?',
    hint: 'Schnarchendes Atemgeräusch? Ruckartige Atemzüge mit wenig Brustkorbbewegung?',
    options: [
      { label: 'Ja – verlegt', logs: 'AIRWAY_OBSTRUCTED', next: 'r_airway_clear' },
      { label: 'Nein – weiter', next: 'r_oxygen' },
    ],
    escalate: ESCALATE_RESPONSIVE,
    source: SRC_F2,
  },

  r_airway_clear: {
    id: 'r_airway_clear',
    kind: 'recovery-step',
    title: 'Atemwege freimachen',
    hint: 'Kopf überstrecken (in den Nacken neigen), Unterkiefer anheben.',
    confirm: { label: 'Atemwege frei', logs: 'AIRWAY_CLEARED', next: 'r_oxygen' },
    skip: { detail: 'Atemwege freimachen', next: 'r_oxygen' },
    infos: [
      {
        label: 'Wie mache ich die Atemwege frei?',
        title: 'Atemweg freimachen – Kurzschema',
        steps: [
          'Mund-Rachenraum inspizieren, Mundhöhle ggf. säubern.',
          'Kopf überstrecken (in den Nacken neigen) und Unterkiefer anheben.',
          'Atemwege ggf. mit Guedeltubus sichern.',
          'Danach Atmung kontrollieren.',
          'Bei Fremdkörperverlegung mit Bewusstsein: siehe „Rückenschläge und Heimlich-Griff“.',
        ],
      },
      {
        label: 'Fremdkörper: Rückenschläge und Heimlich-Griff',
        title: 'Fremdkörperverlegung beheben – Schritt für Schritt',
        steps: [
          'Patienten zum kräftigen Husten auffordern.',
          'Reicht Husten nicht: Oberkörper nach vorn beugen, mit dem Handballen bis zu 5-mal kräftig zwischen die Schulterblätter klopfen.',
          'Nach jedem Schlag prüfen, ob sich der Fremdkörper gelöst hat.',
          'Ohne Erfolg: Heimlich-Griff (Oberbauchkompressionen) – hinter den Patienten stellen, Oberkörper vorbeugen lassen.',
          'Eine Faust zwischen Nabel und unterem Brustbeinende legen, mit der anderen Hand umfassen.',
          'Bis zu 5-mal kräftig ruckartig nach innen und oben ziehen.',
          'Im Wechsel fortsetzen: 5 Rückenschläge, 5 Oberbauchkompressionen – bis der Fremdkörper gelöst ist.',
          'Nach jedem Heimlich-Griff: ärztliche Abklärung wegen möglicher innerer Verletzungen.',
          'Wird der Patient bewusstlos: rot eskalieren – „Reagiert nicht mehr“.',
        ],
      },
    ],
    escalate: ESCALATE_RESPONSIVE,
    source: SRC_F2 + ' · Atemweg freimachen',
  },

  /* US-07 — oxygen on dyspnoea / chest pain / stroke signs. */
  r_oxygen: {
    id: 'r_oxygen',
    kind: 'instruction',
    title: 'Luftnot, Brustschmerz oder Schlaganfallzeichen?',
    hint: 'Fragen und beobachten – z. B. hängender Mundwinkel, Sprachstörung.',
    options: [
      { label: 'Ja – Sauerstoff geben', logs: 'OXYGEN_INDICATED', next: 'r_oxygen_give' },
      { label: 'Nein – weiter', next: 'r_vitals' },
    ],
    escalate: ESCALATE_RESPONSIVE,
    source: SRC_F2,
  },

  r_oxygen_give: {
    id: 'r_oxygen_give',
    kind: 'recovery-step',
    title: 'Sauerstoff geben',
    hint: 'Sauerstoffgabe sofort beginnen.',
    confirm: { label: 'Sauerstoff verabreicht', logs: 'OXYGEN_GIVEN', next: 'r_vitals' },
    skip: { detail: 'Sauerstoffgabe', next: 'r_vitals' },
    escalate: ESCALATE_RESPONSIVE,
    source: SRC_F2,
  },

  /* US-08 — blood pressure and pulse. */
  r_vitals: {
    id: 'r_vitals',
    kind: 'recovery-step',
    title: 'Blutdruck messen, Puls fühlen',
    hint: 'Werte erfassen und dokumentieren – Kreislaufzustand objektiv festhalten.',
    confirm: { label: 'Gemessen und dokumentiert', logs: 'VITALS_MEASURED', next: 'r_shock' },
    skip: { detail: 'RR/Puls-Messung', next: 'r_shock' },
    escalate: ESCALATE_RESPONSIVE,
    source: SRC_F2,
  },

  /* US-09 — shock position. */
  r_shock: {
    id: 'r_shock',
    kind: 'instruction',
    title: 'Schockanzeichen?',
    hint: 'Blässe, kalte feuchte Haut, Puls über 100/min, RR systolisch unter 100 mmHg, beschleunigte Atmung?',
    options: [
      { label: 'Ja – Schockanzeichen', logs: 'SHOCK_SUSPECTED', next: 'r_shock_position' },
      { label: 'Nein – weiter', next: 'r_movement' },
    ],
    escalate: ESCALATE_RESPONSIVE,
    source: SRC_F2,
  },

  r_shock_position: {
    id: 'r_shock_position',
    kind: 'recovery-step',
    title: 'Schocklagerung',
    hint: 'Patient flach hinlegen, Beine erhöht lagern.',
    // US-09/S2 — contraindications, always visible.
    dangerHint: 'NICHT bei: Frakturen an Wirbelsäule/Becken/Beinen, Schädel-Hirn-Trauma, Atemnot/Herzerkrankung, Brust-/Bauchverletzung.',
    confirm: { label: 'Schocklagerung hergestellt', logs: 'SHOCK_POSITION', next: 'r_movement' },
    alt: { label: 'Kontraindikation – keine Schocklagerung', logs: 'SHOCK_CONTRAINDICATED', next: 'r_movement' },
    skip: { detail: 'Schocklagerung', next: 'r_movement' },
    info: {
      label: 'Wie geht die Schocklagerung?',
      title: 'Schocklagerung – Kurzschema',
      steps: [
        'Patient flach hinlegen, Beine erhöht lagern.',
        'Beruhigender Zuspruch, Blutungen stillen.',
        'Wärmeerhalt, ggf. Sauerstoffgabe.',
        'Ständige Vitalkontrolle.',
        'Bei Kontraindikation: keine Schocklagerung – Wärmeerhalt und ständige Vitalkontrolle.',
      ],
    },
    escalate: ESCALATE_RESPONSIVE,
    source: SRC_F2 + ' · Schocklagerung',
  },

  /* US-10 — axial handling on suspected spinal injury. */
  r_movement: {
    id: 'r_movement',
    kind: 'instruction',
    title: 'Bewegung eingeschränkt oder Gefühlsstörungen?',
    hint: 'Patient Finger und Zehen bewegen lassen. Weitere Hinweise: z. B. Einnässen.',
    options: [
      { label: 'Ja – eingeschränkt', logs: 'MOVEMENT_IMPAIRED', next: 'r_axial' },
      { label: 'Nein – weiter', next: 'r_abdomen' },
    ],
    escalate: ESCALATE_RESPONSIVE,
    source: SRC_F2,
  },

  r_axial: {
    id: 'r_axial',
    kind: 'recovery-step',
    title: 'Nur achsengerecht lagern',
    hint: 'Patient ausschließlich achsengerecht bewegen und lagern.',
    confirm: { label: 'Achsengerecht gelagert', logs: 'AXIAL_POSITIONING', next: 'r_abdomen' },
    skip: { detail: 'Achsengerechte Lagerung', next: 'r_abdomen' },
    escalate: ESCALATE_RESPONSIVE,
    source: SRC_F2,
  },

  /* US-11 — acute abdomen. */
  r_abdomen: {
    id: 'r_abdomen',
    kind: 'instruction',
    title: 'Bauchdecke hart oder starke Bauchschmerzen?',
    hint: 'Alle vier Quadranten vorsichtig drücken. Bereits erhobene Befunde nicht erneut untersuchen.',
    options: [
      { label: 'Ja – Abwehrspannung', logs: 'ABDOMEN_GUARDING', next: 'r_abdomen_position' },
      { label: 'Nein – weiter', next: 'r_monitor' },
    ],
    escalate: ESCALATE_RESPONSIVE,
    source: SRC_F2,
  },

  r_abdomen_position: {
    id: 'r_abdomen_position',
    kind: 'recovery-step',
    title: 'Bauchdeckenentlastende Lagerung',
    hint: 'Rückenlage, Beine angezogen oder unterpolstert (Knierolle) – nach Wunsch/Schonhaltung des Patienten.',
    dangerHint: 'Verbot von Essen, Trinken, Rauchen.',
    confirm: { label: 'Lagerung hergestellt', logs: 'ABDOMEN_POSITION', next: 'r_monitor' },
    skip: { detail: 'Bauchdeckenentlastende Lagerung', next: 'r_monitor' },
    info: {
      label: 'Wie geht die Lagerung?',
      title: 'Bauchdeckenentlastende Lagerung – Kurzschema',
      steps: [
        'Rückenlage, Beine angezogen bzw. mit Knierolle unterpolstert – Bauchmuskulatur entspannt.',
        'Lagerung nach Wunsch/Schonhaltung des Patienten.',
        'Verbot von Essen, Trinken, Rauchen.',
        'Wärmeerhalt, beruhigender Zuspruch, ständige Vitalkontrolle.',
      ],
    },
    escalate: ESCALATE_RESPONSIVE,
    source: SRC_F2 + ' · Bauchdeckenentlastende Lagerung',
  },

  /* US-12 — care, monitoring, and the 3–5-minute schema loop. */
  r_monitor: {
    id: 'r_monitor',
    kind: 'monitor',
    title: 'Betreuen und überwachen',
    hint: 'Zuspruch, Wärmeerhalt, RR/Puls wiederholt messen. Schema alle 3–5 Minuten erneut durchlaufen.',
    question: 'Kontrolle fällig: Schema erneut durchlaufen',
    dueHint: 'RR und Puls erneut messen und dokumentieren.',
    reminderSeconds: CONFIG.SCHEMA_REPEAT_SECONDS,
    reminderCue: 'REPEAT_SCHEMA',
    allowEarly: true, // the re-run is also offered during the countdown
    dueActions: [
      { label: 'Schema jetzt durchlaufen', style: 'primary', logs: 'SCHEMA_REPEATED', next: 'safety' },
    ],
    escalate: ESCALATE_RESPONSIVE,
    source: SRC_F2,
  },
});

export function getStep(id) {
  return STEPS[id];
}
