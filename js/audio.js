/* SanGuide — audio pacing & voice (Q4 timing, R1 voice fallback).
 *
 * Clicks are scheduled against the Web Audio clock (AudioContext.currentTime),
 * NOT setInterval, so the metronome cadence stays accurate (< 50 ms/min drift)
 * even when the timer that tops up the schedule jitters or the tab is
 * backgrounded. The CPR state machine (cpr.js) tops up the schedule; this module
 * owns the sound primitives and the voice/fallback decision.
 *
 * Voice (R1/D5): speechSynthesis is primary. If no German voice resolves — the
 * silent-offline failure mode on some Android devices — every cue degrades to a
 * distinct synthesized tone so the responder is still guided without a network.
 * Mute state is not reliably detectable on the web, so we also vibrate on every
 * cue and the UI shows a persistent "Sprache/Ton prüfen" hint during CPR.
 */

import { CUES } from './schema.js';

let ctx = null;
let master = null;
let voice = null;          // chosen SpeechSynthesisVoice, or null
let voiceProbed = false;
const hasSpeech = typeof globalThis.speechSynthesis !== 'undefined';

/* Distinct fallback tone per cue: sequences of { freq(Hz), dur(s) }. */
const TONE_VOCAB = {
  CALL_HELP:   [{ freq: 880, dur: 0.12 }, { freq: 880, dur: 0.12 }],
  CPR_INTRO:   [{ freq: 660, dur: 0.14 }, { freq: 990, dur: 0.20 }],
  VENTILATE:   [{ freq: 620, dur: 0.16 }, { freq: 620, dur: 0.16 }],
  RESUME:      [{ freq: 520, dur: 0.10 }, { freq: 780, dur: 0.16 }],
  ROTATE:      [{ freq: 700, dur: 0.14 }, { freq: 560, dur: 0.14 }, { freq: 440, dur: 0.20 }],
  CHECK_VITALS:[{ freq: 500, dur: 0.22 }, { freq: 500, dur: 0.22 }],
  KEEP_WARM:   [{ freq: 590, dur: 0.18 }],
  RECOVERY:    [{ freq: 700, dur: 0.14 }, { freq: 590, dur: 0.20 }],
  REPEAT_SCHEMA:[{ freq: 500, dur: 0.22 }, { freq: 500, dur: 0.22 }, { freq: 640, dur: 0.22 }],
  END_TONE:    [{ freq: 990, dur: 0.30 }],
};

/* Vibration pattern per cue (ms on/off), used everywhere Vibration is supported. */
const VIBRATE_VOCAB = {
  CALL_HELP:   [120, 80, 120],
  CPR_INTRO:   [200],
  VENTILATE:   [150, 100, 150],
  RESUME:      [200],
  ROTATE:      [120, 80, 120, 80, 120],
  CHECK_VITALS:[250, 120, 250],
  KEEP_WARM:   [200],
  RECOVERY:    [150, 100, 150],
  REPEAT_SCHEMA:[250, 120, 250, 120, 250],
  CLICK:       [20],
};

function ensureCtx() {
  if (ctx) return ctx;
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  return ctx;
}

function pickVoice() {
  if (!hasSpeech) return null;
  const voices = speechSynthesis.getVoices() || [];
  // Prefer a German voice; local/offline voices sort first where the flag exists.
  const german = voices.filter((v) => (v.lang || '').toLowerCase().startsWith('de'));
  german.sort((a, b) => Number(b.localService) - Number(a.localService));
  return german[0] || null;
}

/* Resolve a German voice, retrying once voices load asynchronously. */
function probeVoice() {
  if (!hasSpeech) { voiceProbed = true; return; }
  voice = pickVoice();
  if (!voice && !voiceProbed) {
    speechSynthesis.addEventListener('voiceschanged', () => {
      voice = pickVoice();
      voiceProbed = true;
    }, { once: true });
  } else {
    voiceProbed = true;
  }
}

/* ---- Public API ----------------------------------------------------------- */

export function init() {
  probeVoice();
}

/* Must run inside a user gesture (start button): unlocks audio + speech on iOS. */
export function unlock() {
  ensureRunning();
  if (hasSpeech) {
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u); // primes the queue within the gesture
    } catch (_) { /* ignore */ }
    if (!voice) probeVoice();
  }
}

export function isVoiceReady() {
  return !!voice;
}

export function audioTime() {
  const c = ensureCtx();
  return c ? c.currentTime : 0;
}

export function audioAvailable() {
  return !!ensureCtx();
}

/* Resume the AudioContext (idempotent). MUST be called inside a user gesture on
 * the CPR-start path: a suspended context has a frozen currentTime, which stalls
 * the metronome scheduler and produces no beep even while speech still plays. */
export function ensureRunning() {
  const c = ensureCtx();
  if (!c) return 'unavailable';
  if (c.state === 'suspended') c.resume().catch(() => {});
  return c.state;
}

export function contextState() {
  return ctx ? ctx.state : 'none';
}

/* Schedule one metronome beep at Web Audio time `time` (seconds). ~70 ms, loud,
 * with an accented (higher-pitched) downbeat for the first of the 30. */
export function scheduleClick(time, strong = false) {
  const c = ensureCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'square';
  osc.frequency.value = strong ? 1400 : 1000;
  const t = Math.max(time, c.currentTime);
  const peak = strong ? 0.95 : 0.8;
  const dur = 0.07;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.004);
  gain.gain.setValueAtTime(peak, t + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function playPattern(steps, startAt, peak = 0.5) {
  const c = ensureCtx();
  if (!c) return;
  let t = Math.max(startAt || c.currentTime, c.currentTime) + 0.01;
  for (const step of steps) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = step.freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + step.dur);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + step.dur + 0.03);
    t += step.dur + 0.06;
  }
}

export function vibrate(pattern) {
  if (navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch (_) { /* ignore */ }
  }
}

/* Speak a cue by key (see CUES). Uses German speech when available, otherwise a
 * distinct tone. Always vibrates the matching pattern (US-5/S4). */
export function speak(cueKey, { atAudioTime, loud = false } = {}) {
  vibrate(loud ? [400, 150, 400] : (VIBRATE_VOCAB[cueKey] || VIBRATE_VOCAB.CLICK));
  const text = CUES[cueKey];
  if (voice && hasSpeech && text) {
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice;
      u.lang = voice.lang || 'de-DE';
      u.rate = 1.0;
      u.volume = 1.0;
      speechSynthesis.speak(u);
      return;
    } catch (_) { /* fall through to tone */ }
  }
  playPattern(TONE_VOCAB[cueKey] || TONE_VOCAB.CHECK_VITALS, atAudioTime, loud ? 0.9 : 0.5);
}

/* Non-verbal end tone for the breathing countdown (US-3/S1). */
export function endTone() {
  vibrate(VIBRATE_VOCAB.CHECK_VITALS);
  playPattern(TONE_VOCAB.END_TONE);
}

/* Cancel any queued speech (e.g. leaving the CPR screen). */
export function cancelSpeech() {
  if (hasSpeech) {
    try { speechSynthesis.cancel(); } catch (_) { /* ignore */ }
  }
}
