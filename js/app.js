/* SanGuide — F1 controller.
 *
 * Owns service-worker registration, the screen router and all wiring between the
 * step data (schema.js), persistence (store.js), audio pacing (audio.js/cpr.js),
 * the wake lock and the journal. Every confirmed action is persisted BEFORE the
 * UI advances (US-7/S1); on launch a recent unclosed session is resumed (US-1/S2).
 */

import { getStep, FIRST_STEP_ID } from './schema.js';
import * as store from './store.js';
import * as audio from './audio.js';
import * as wakelock from './wakelock.js';
import { createCprEngine } from './cpr.js';
import { renderJournalText, shareJournal, computeCprDurationMs } from './journal.js';

/* ---- Tiny DOM helper ------------------------------------------------------ */
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return n;
}

const screenEl = () => document.getElementById('screen');
const warningEl = () => document.getElementById('warning');

/* ---- Module state --------------------------------------------------------- */
let session = null;
let cprEngine = null;
let breathingTimer = null;
let recoveryTimer = null;
let monitorReprompt = null;
let cprTicker = null;

/* ---- Formatting ----------------------------------------------------------- */
function fmtClock(totalSec) {
  const s = Math.max(0, Math.round(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
const fmtMs = (ms) => fmtClock(ms / 1000);

/* ---- Journal helpers ------------------------------------------------------ */
async function logEvent(type, detail = null) {
  const event = await store.appendEvent(session.id, type, detail);
  session.events.push(event);
  return event;
}

async function goToStep(id, { announce = true } = {}) {
  session.currentStepId = id;
  await store.setCurrentStep(session.id, id);
  const step = getStep(id);
  if (announce && step && step.onEnter) await logEvent(step.onEnter);
  render({ announce });
}

/* ---- Transient teardown between screens ----------------------------------- */
function teardownTransient() {
  if (breathingTimer) { clearInterval(breathingTimer); breathingTimer = null; }
  if (recoveryTimer) { clearInterval(recoveryTimer); recoveryTimer = null; }
  if (monitorReprompt) { clearInterval(monitorReprompt); monitorReprompt = null; }
  if (cprTicker) { clearInterval(cprTicker); cprTicker = null; }
}

/* ---- Persistent warning banner (R1: honest audio/voice hint) -------------- */
function setWarning(text) {
  const w = warningEl();
  if (!w) return;
  w.textContent = text;
  w.hidden = !text;
}
const clearWarning = () => setWarning('');

/* ---- Reusable widgets ----------------------------------------------------- */
function confirmButton(label, confirmLabel, onConfirm, cls = 'btn btn-ghost') {
  const btn = el('button', { class: cls, type: 'button' }, label);
  let armed = false;
  let t = null;
  btn.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      btn.textContent = confirmLabel;
      btn.classList.add('is-armed');
      t = setTimeout(() => { armed = false; btn.textContent = label; btn.classList.remove('is-armed'); }, 4000);
    } else {
      clearTimeout(t);
      onConfirm();
    }
  });
  return btn;
}

/* ========================================================================== */
/* Screens                                                                    */
/* ========================================================================== */

function renderStart() {
  clearWarning();
  screenEl().replaceChildren(
    el('section', { class: 'screen screen-start' },
      el('div', { class: 'lead' },
        el('span', { class: 'eyebrow' }, 'Bereit'),
        el('h1', {}, 'Notfall?'),
      ),
      el('div', { class: 'actions' },
        el('button', { class: 'btn btn-primary btn-xl', type: 'button', onclick: onStartIncident },
          'Notfall starten'),
      ),
      el('p', { class: 'fineprint' },
        'Informationshilfe für ausgebildete Ersthelfer. Ersetzt weder Ausbildung noch Notruf.'),
    ),
  );
}

function renderResume(open) {
  clearWarning();
  const since = new Date(open.startedAt).toLocaleTimeString('de-DE', { hour12: false, hour: '2-digit', minute: '2-digit' });
  screenEl().replaceChildren(
    el('section', { class: 'screen screen-start' },
      el('div', { class: 'lead' },
        el('span', { class: 'eyebrow' }, 'Laufender Einsatz'),
        el('h1', {}, `Seit ${since}`),
        el('p', { class: 'sub' }, 'Ein Einsatz läuft noch. Fortsetzen oder neu beginnen?'),
      ),
      el('div', { class: 'actions' },
        el('button', { class: 'btn btn-primary btn-xl', type: 'button', onclick: () => onResumeIncident(open) },
          'Einsatz fortsetzen'),
        confirmButton('Neuer Einsatz', 'Neu bestätigen', () => onNewOverExisting(open), 'btn btn-secondary'),
      ),
    ),
  );
}

function renderInstruction(step, announce) {
  clearWarning();
  if (announce && step.cue) audio.speak(step.cue);
  const opts = step.options || [];
  screenEl().replaceChildren(
    el('section', { class: 'screen screen-step' },
      el('div', { class: 'step-body' },
        el('h1', { class: 'step-title' }, step.title),
        step.hint ? el('p', { class: 'step-hint' }, step.hint) : null,
      ),
      el('div', { class: 'actions' },
        ...opts.map((opt, i) => el('button', {
          class: 'btn btn-xl ' + (i === 0 ? 'btn-primary' : 'btn-secondary'),
          type: 'button',
          onclick: () => chooseOption(opt),
        }, opt.label)),
      ),
      el('p', { class: 'source' }, step.source),
    ),
  );
}

async function chooseOption(opt) {
  if (opt.logs) await logEvent(opt.logs);
  await goToStep(opt.next);
}

function renderBreathing(step) {
  clearWarning();
  const total = step.timerSeconds;
  const R = 54;
  const CIRC = 2 * Math.PI * R;

  const ringHtml =
    `<svg class="ring" viewBox="0 0 128 128" aria-hidden="true">
       <circle class="ring-track" cx="64" cy="64" r="${R}"></circle>
       <circle class="ring-progress" cx="64" cy="64" r="${R}"
         stroke-dasharray="${CIRC.toFixed(2)}" stroke-dashoffset="0"></circle>
     </svg>`;
  const ringWrap = el('div', { class: 'ring-wrap', html: ringHtml });
  const numEl = el('span', { class: 'ring-num' }, String(total));
  ringWrap.appendChild(numEl);
  const progress = ringWrap.querySelector('.ring-progress');
  const reprompt = el('p', { class: 'step-hint reprompt', hidden: 'hidden' }, 'Zeit abgelaufen – Frage beantworten.');

  const start = Date.now();
  breathingTimer = setInterval(() => {
    const elapsed = (Date.now() - start) / 1000;
    const remaining = Math.max(0, total - elapsed);
    numEl.textContent = String(Math.ceil(remaining));
    if (progress) progress.setAttribute('stroke-dashoffset', (CIRC * (1 - remaining / total)).toFixed(2));
    if (remaining <= 0) {
      clearInterval(breathingTimer); breathingTimer = null;
      numEl.textContent = '0';
      reprompt.hidden = false;         // US-3/S5 — no auto-advance, re-prompt
      audio.endTone();
    }
  }, 100);

  const opts = step.options;
  screenEl().replaceChildren(
    el('section', { class: 'screen screen-step' },
      el('div', { class: 'step-body' },
        el('h1', { class: 'step-title' }, step.title),
        el('p', { class: 'step-hint danger' }, step.hint), // Schnappatmung, always visible
        ringWrap,
        reprompt,
      ),
      el('div', { class: 'actions' },
        el('button', { class: 'btn btn-xl btn-danger', type: 'button', onclick: () => chooseOption(opts[1]) },
          opts[1].label),
        el('button', { class: 'btn btn-xl btn-secondary', type: 'button', onclick: () => chooseOption(opts[0]) },
          opts[0].label),
      ),
      el('p', { class: 'source' }, step.source),
    ),
  );
}

function renderAlarm(step) {
  clearWarning();
  const confirmRow = el('div', { class: 'confirm-row' });
  for (const conf of step.confirmations) {
    const btn = el('button', { class: 'btn btn-secondary', type: 'button' }, conf.label);
    btn.addEventListener('click', async () => {
      if (btn.classList.contains('is-done')) return;
      await logEvent(conf.logs);
      const t = new Date().toLocaleTimeString('de-DE', { hour12: false });
      btn.classList.add('is-done');
      btn.disabled = true;
      btn.textContent = `${conf.label} ✓ ${t}`;
    });
    confirmRow.appendChild(btn);
  }

  screenEl().replaceChildren(
    el('section', { class: 'screen screen-step' },
      el('div', { class: 'step-body' },
        el('h1', { class: 'step-title' }, step.title),
        el('p', { class: 'step-hint' }, step.hint),
        confirmRow,
      ),
      el('div', { class: 'actions' },
        el('button', { class: 'btn btn-xl btn-primary', type: 'button', onclick: () => goToStep(step.primary.next) },
          step.primary.label),
      ),
      el('p', { class: 'source' }, step.source),
    ),
  );
}

function renderCpr(step) {
  const running = cprEngine && cprEngine.isRunning();
  const havePaused = cprEngine && !cprEngine.isRunning();

  setWarning(audio.isVoiceReady()
    ? 'Ton prüfen: Lautstärke hoch, Stummschalter aus.'
    : 'Sprache/Ton prüfen: Ansagen laufen als Signaltöne.');

  const elapsedEl = el('span', { class: 'metric-val', id: 'cpr-elapsed' }, '0:00');
  const handsOffEl = el('span', { class: 'metric-val', id: 'cpr-handsoff' }, '0:00');
  const cycleEl = el('span', { class: 'metric-val', id: 'cpr-cycle' }, '0 / 5');

  let primary;
  if (running) {
    primary = el('button', { class: 'btn btn-xl btn-warn', type: 'button', onclick: pauseCpr }, 'Pause');
  } else if (havePaused) {
    primary = el('button', { class: 'btn btn-xl btn-primary', type: 'button', onclick: resumeCpr }, 'Fortsetzen');
  } else {
    primary = el('button', { class: 'btn btn-xl btn-primary', type: 'button', onclick: startCpr }, 'HLW starten');
  }

  screenEl().replaceChildren(
    el('section', { class: 'screen screen-cpr' },
      el('div', { class: 'cpr-status' + (havePaused ? ' is-paused' : '') },
        el('div', { class: 'metric' }, el('span', { class: 'metric-label' }, 'HLW-Zeit'), elapsedEl),
        el('div', { class: 'metric' }, el('span', { class: 'metric-label' }, 'Hands-off'), handsOffEl),
        el('div', { class: 'metric' }, el('span', { class: 'metric-label' }, 'Zyklus'), cycleEl),
      ),
      el('p', { class: 'cpr-cadence' }, running ? '30 : 2 · 110/min' : (havePaused ? 'Pausiert' : 'Bereit')),
      el('div', { class: 'actions' },
        primary,
        el('button', { class: 'btn btn-xl btn-secondary', type: 'button', onclick: signsOfLife }, 'Lebenszeichen'),
        confirmButton('Einsatz beenden', 'Beenden bestätigen', endIncident, 'btn btn-ghost'),
      ),
    ),
  );
  startCprTicker();
}

function startCprTicker() {
  if (cprTicker) clearInterval(cprTicker);
  cprTicker = setInterval(() => {
    if (!cprEngine) return;
    const s = cprEngine.getState();
    const a = document.getElementById('cpr-elapsed');
    const b = document.getElementById('cpr-handsoff');
    const c = document.getElementById('cpr-cycle');
    if (a) a.textContent = fmtMs(s.cprElapsedMs);
    if (b) b.textContent = fmtMs(s.handsOffMs);
    if (c) c.textContent = `${s.cycleInBlock} / 5`;
  }, 250);
}

async function startCpr() {
  audio.ensureRunning();          // resume the audio clock inside the gesture
  if (!cprEngine) {
    cprEngine = createCprEngine({
      onCycle: (n, ms) => { logEvent('CYCLE_COMPLETED', `Rotation ${n}, ${fmtMs(ms)}`); },
    });
  }
  await logEvent('CPR_STARTED');
  cprEngine.start();
  renderCpr(getStep('cpr'));
}

async function pauseCpr() {
  cprEngine.pause();
  await logEvent('CPR_PAUSED');
  renderCpr(getStep('cpr'));
}

async function resumeCpr() {
  audio.ensureRunning();
  cprEngine.resume();
  await logEvent('CPR_RESUMED');
  renderCpr(getStep('cpr'));
}

async function signsOfLife() {
  const o = getStep('cpr').signsOfLife;
  if (cprEngine) { cprEngine.stop(); cprEngine = null; }
  if (o.logs) await logEvent(o.logs);
  clearWarning();
  await goToStep(o.next);
}

/* Permanent red escalation present on every recovery/monitor screen (US-10/S1):
 * breathing stopped → straight into CPR, no re-assessment, same journal. */
function escalateButton() {
  return el('button', { class: 'btn btn-xl btn-danger', type: 'button', onclick: escalateToCpr },
    'Atmet nicht mehr');
}

async function escalateToCpr() {
  teardownTransient();
  await logEvent('NO_NORMAL_BREATHING');
  await goToStep('cpr'); // announce=true → auto startCpr, no reassessment
}

/* One recovery-position step: confirm or skip (US-8). */
function renderRecoveryStep(step, announce) {
  clearWarning();
  if (announce && step.enterCue) audio.speak(step.enterCue);

  const alreadyDone = step.alreadyLogged &&
    session.events.some((e) => e.type === step.alreadyLogged);

  let primary;
  if (alreadyDone) {
    // US-8/S3 — do not ask twice; show confirmed with time and a one-tap Weiter.
    const at = session.events.filter((e) => e.type === step.alreadyLogged).slice(-1)[0];
    const t = new Date(at.at).toLocaleTimeString('de-DE', { hour12: false });
    primary = el('button', { class: 'btn btn-xl btn-secondary is-done', type: 'button',
      onclick: () => goToStep(step.confirm.next) }, `${step.confirm.label} ✓ ${t} — Weiter`);
  } else {
    primary = el('button', { class: 'btn btn-xl btn-primary', type: 'button',
      onclick: async () => { await logEvent(step.confirm.logs); await goToStep(step.confirm.next); } },
      step.confirm.label);
  }

  const skip = el('button', { class: 'btn btn-secondary', type: 'button',
    onclick: async () => { await logEvent('STEP_SKIPPED', step.skip.detail); await goToStep(step.skip.next); } },
    'Übersprungen');

  screenEl().replaceChildren(
    el('section', { class: 'screen screen-step' },
      el('div', { class: 'step-body' },
        el('h1', { class: 'step-title' }, step.title),
        el('p', { class: 'step-hint' }, step.hint),
      ),
      el('div', { class: 'actions' },
        primary,
        skip,
        escalateButton(),
        confirmButton('Einsatz beenden', 'Beenden bestätigen', endIncident, 'btn btn-ghost'),
      ),
      el('p', { class: 'source' }, step.source),
    ),
  );
}

/* Recurring 3-min monitoring loop (US-9). */
function renderMonitor(step, announce) {
  clearWarning();
  if (announce) audio.speak(step.reminderCue);

  const total = step.reminderSeconds;
  let remaining = total;
  let due = false;
  let repromptCount = 0;

  const countdown = el('span', { class: 'metric-val' }, fmtClock(total));
  const body = el('div', { class: 'step-body' });
  const actions = el('div', { class: 'actions' });

  function paintCountdown() {
    body.replaceChildren(
      el('h1', { class: 'step-title' }, step.title),
      el('p', { class: 'step-hint' }, step.hint),
      el('div', { class: 'metric metric-inline' },
        el('span', { class: 'metric-label' }, 'Nächste Kontrolle in'), countdown),
    );
    actions.replaceChildren(escalateButton(),
      confirmButton('Einsatz beenden', 'Beenden bestätigen', endIncident, 'btn btn-ghost'));
  }

  function paintQuestion() {
    body.replaceChildren(
      el('h1', { class: 'step-title' }, step.question),
      el('p', { class: 'step-hint danger' }, 'Schnappatmung zählt als keine normale Atmung.'),
    );
    actions.replaceChildren(
      el('button', { class: 'btn btn-xl btn-primary', type: 'button', onclick: onUnchanged }, 'Unverändert'),
      el('button', { class: 'btn btn-xl btn-danger', type: 'button', onclick: onWorsened }, 'Verschlechtert'),
      escalateButton(),
    );
  }

  async function onUnchanged() {
    await logEvent('VITALS_CHECKED', 'unverändert');
    due = false; repromptCount = 0; remaining = total;
    if (monitorReprompt) { clearInterval(monitorReprompt); monitorReprompt = null; }
    paintCountdown();
  }

  async function onWorsened() {
    if (monitorReprompt) { clearInterval(monitorReprompt); monitorReprompt = null; }
    await logEvent('VITALS_WORSENED');
    await goToStep('breathing'); // US-10/S2 — re-run the timed check, then branch
  }

  function fireReminder() {
    due = true;
    repromptCount = 0;
    audio.speak(step.reminderCue);
    paintQuestion();
    // US-9/S3 — unanswered: repeat every 30 s, louder once, logging nothing.
    monitorReprompt = setInterval(() => {
      if (!due) return;
      repromptCount += 1;
      audio.speak(step.reminderCue, { loud: repromptCount >= 1 });
    }, 30000);
  }

  recoveryTimer = setInterval(() => {
    if (due) return;
    remaining -= 1;
    countdown.textContent = fmtClock(Math.max(0, remaining));
    if (remaining <= 0) fireReminder();
  }, 1000);

  paintCountdown();
  screenEl().replaceChildren(
    el('section', { class: 'screen screen-step' }, body, actions,
      el('p', { class: 'source' }, step.source)),
  );
}

async function renderEnded() {
  clearWarning();
  session = await store.getSession(session.id); // fresh, complete journal
  const durEl = fmtMs(computeCprDurationMs(session.events));
  const preview = el('pre', { class: 'journal-preview', hidden: 'hidden' });

  const shareBtn = el('button', { class: 'btn btn-xl btn-primary', type: 'button' }, 'Teilen');
  const feedback = el('p', { class: 'share-feedback', hidden: 'hidden' });
  shareBtn.addEventListener('click', async () => {
    const res = await shareJournal(session);
    if (res.method === 'clipboard') { feedback.textContent = 'In die Zwischenablage kopiert.'; feedback.hidden = false; }
    if (res.method === 'display') { feedback.textContent = 'Teilen nicht verfügbar – Text unten.'; feedback.hidden = false; }
    preview.textContent = res.text;
    preview.hidden = false;
  });

  screenEl().replaceChildren(
    el('section', { class: 'screen screen-step' },
      el('div', { class: 'step-body' },
        el('span', { class: 'eyebrow' }, 'Einsatz beendet'),
        el('h1', { class: 'step-title' }, 'Protokoll'),
        el('div', { class: 'metric metric-inline' },
          el('span', { class: 'metric-label' }, 'HLW-Dauer'),
          el('span', { class: 'metric-val' }, durEl)),
        feedback,
        preview,
      ),
      el('div', { class: 'actions' },
        shareBtn,
        el('button', { class: 'btn btn-xl btn-secondary', type: 'button', onclick: bootFresh }, 'Neuer Einsatz'),
      ),
    ),
  );
}

/* ---- Router --------------------------------------------------------------- */
function render({ announce = true } = {}) {
  teardownTransient();
  const step = getStep(session.currentStepId);
  if (!step) { renderStart(); return; }
  switch (step.kind) {
    case 'instruction': renderInstruction(step, announce); break;
    case 'breathing': renderBreathing(step); break;
    case 'alarm': renderAlarm(step); break;
    case 'cpr':
      if (announce && (!cprEngine || !cprEngine.isRunning())) startCpr();
      else renderCpr(step);
      break;
    case 'recovery-step': renderRecoveryStep(step, announce); break;
    case 'monitor': renderMonitor(step, announce); break;
    default: renderStart();
  }
}

/* ---- Top-level flows ------------------------------------------------------ */
async function onStartIncident() {
  audio.unlock();               // must be inside the gesture (iOS)
  session = await store.createSession('LIVE');
  await wakelock.acquire();
  render({ announce: true });
}

async function onResumeIncident(open) {
  audio.unlock();
  session = open;
  await wakelock.acquire();
  render({ announce: false });  // do not re-log onEnter / auto-start CPR
}

async function onNewOverExisting(open) {
  await store.endSession(open.id); // resume prompt is the only place old is cleared (D7)
  await onStartIncident();
}

async function endIncident() {
  if (cprEngine) { cprEngine.stop(); cprEngine = null; }
  teardownTransient();
  await store.endSession(session.id);
  audio.cancelSpeech();
  await wakelock.release();
  await renderEnded();
}

async function bootFresh() {
  session = null;
  await wakelock.release();
  renderStart();
}

/* ---- Boot ----------------------------------------------------------------- */
async function boot() {
  audio.init();
  try {
    const open = await store.getOpenSession();
    if (open) renderResume(open);
    else renderStart();
  } catch (_) {
    renderStart(); // storage unavailable — still allow a (non-persisted) start
  }
}

/* ---- Service worker + offline status (kept from bootstrap) ---------------- */
function setOffline(ready, text) {
  const s = document.getElementById('offline-status');
  const t = document.getElementById('offline-status-text');
  if (s) s.setAttribute('data-ready', ready ? 'true' : 'false');
  if (t) t.textContent = text;
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) { setOffline(false, 'Offline-Modus nicht unterstützt'); return; }
  navigator.serviceWorker.register('./service-worker.js')
    .then((reg) => {
      if (reg.active) setOffline(true, 'Offline bereit');
      else { setOffline(false, 'Offline-Modus wird eingerichtet…'); navigator.serviceWorker.ready.then(() => setOffline(true, 'Offline bereit')); }
    })
    .catch(() => setOffline(false, 'Offline-Modus nicht verfügbar'));
}

window.addEventListener('load', () => {
  registerServiceWorker();
  boot();
});
