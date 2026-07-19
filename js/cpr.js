/* SanGuide — CPR 30:2 state machine (US-5, US-6).
 *
 * Compression clicks are scheduled on the Web Audio clock via audio.scheduleClick
 * with a short look-ahead (the "two clocks" pattern): a 25 ms top-up timer only
 * decides WHICH clicks to enqueue, while their exact sounding times come from the
 * audio clock — so cadence accuracy (Q4) is independent of timer jitter and tab
 * backgrounding.
 *
 * Cadence: 30 clicks @110/min (D1) → 5 s hands-free ventilation window (D2,
 * announced "2 Beatmungen", closed by a "Weiter" cue) → next 30. After 5
 * completed cycles (D4) a "Helferwechsel" cue plays OVER the running clicks
 * (never pausing them, US-6/S2) and CYCLE_COMPLETED is emitted. Paused time never
 * advances the cycle counter (US-6/S4); CPR elapsed is derived from wall-clock
 * timestamps, not an in-memory tick count (US-7/S2).
 */

import { CONFIG, CLICK_INTERVAL_MS } from './schema.js';
import * as audio from './audio.js';

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_S = 0.15;
const INTERVAL_S = CLICK_INTERVAL_MS / 1000;
const VENT_WINDOW_S = CONFIG.VENTILATION_WINDOW_MS / 1000;

export function createCprEngine({ onCycle } = {}) {
  let timer = null;
  let running = false;

  let phase = 'compressions';       // 'compressions' | 'ventilation'
  let compressionCount = 0;         // within the current set of 30
  let cyclesInBlock = 0;            // completed 30:2 cycles since last rotation
  let rotationNumber = 0;

  let nextClickTime = 0;            // Web Audio seconds
  let cprStartedWall = 0;
  let blockStartWall = 0;
  let handsOffTotalMs = 0;
  let pauseStartWall = 0;
  const pendingCueTimers = new Set();

  function speakAligned(cueKey, targetAudioTime) {
    const delayMs = Math.max(0, (targetAudioTime - audio.audioTime()) * 1000);
    const id = setTimeout(() => {
      pendingCueTimers.delete(id);
      audio.speak(cueKey);
    }, delayMs);
    pendingCueTimers.add(id);
  }

  function clearPendingCues() {
    for (const id of pendingCueTimers) clearTimeout(id);
    pendingCueTimers.clear();
  }

  function processClick() {
    const clickTime = nextClickTime;

    if (phase === 'compressions') {
      audio.scheduleClick(clickTime, compressionCount === 0);
      compressionCount += 1;

      if (compressionCount >= CONFIG.COMPRESSIONS_PER_CYCLE) {
        // Enter the fixed hands-free ventilation window (D2).
        phase = 'ventilation';
        speakAligned('VENTILATE', clickTime);
        nextClickTime = clickTime + VENT_WINDOW_S;
      } else {
        nextClickTime = clickTime + INTERVAL_S;
      }
      return;
    }

    // phase === 'ventilation': window has elapsed → resume with the next set.
    speakAligned('RESUME', clickTime);
    cyclesInBlock += 1;

    // Rotation prompt after a full block, spoken over the resuming clicks.
    if (cyclesInBlock >= CONFIG.CYCLES_PER_BLOCK) {
      rotationNumber += 1;
      const elapsedMs = Date.now() - blockStartWall;
      speakAligned('ROTATE', clickTime + 0.4);
      if (onCycle) onCycle(rotationNumber, elapsedMs);
      cyclesInBlock = 0;
      blockStartWall = Date.now();
    }

    phase = 'compressions';
    audio.scheduleClick(clickTime, true); // downbeat of the new set
    compressionCount = 1;
    nextClickTime = clickTime + INTERVAL_S;
  }

  function tick() {
    if (!running) return;
    const horizon = audio.audioTime() + SCHEDULE_AHEAD_S;
    let guard = 0;
    while (nextClickTime < horizon && guard < 64) {
      processClick();
      guard += 1;
    }
  }

  function startLoop() {
    nextClickTime = audio.audioTime() + 0.12;
    timer = setInterval(tick, LOOKAHEAD_MS);
  }

  function stopLoop() {
    if (timer) { clearInterval(timer); timer = null; }
    clearPendingCues();
  }

  /* ---- Public engine API -------------------------------------------------- */

  return {
    start() {
      running = true;
      phase = 'compressions';
      compressionCount = 0;
      cyclesInBlock = 0;
      rotationNumber = 0;
      handsOffTotalMs = 0;
      cprStartedWall = Date.now();
      blockStartWall = cprStartedWall;
      audio.speak('CPR_INTRO');
      startLoop();
    },

    pause() {
      if (!running) return;
      running = false;
      stopLoop();
      audio.cancelSpeech();
      pauseStartWall = Date.now();
    },

    resume() {
      if (running) return;
      const pauseDur = Date.now() - pauseStartWall;
      handsOffTotalMs += pauseDur;
      blockStartWall += pauseDur;      // elapsed measures hands-on time only
      // A pause during the ventilation window resumes with a fresh set.
      if (compressionCount >= CONFIG.COMPRESSIONS_PER_CYCLE) compressionCount = 0;
      phase = 'compressions';
      running = true;
      startLoop();
    },

    stop() {
      running = false;
      stopLoop();
      audio.cancelSpeech();
    },

    isRunning() { return running; },

    getState() {
      const paused = !running;
      const nowHandsOff = paused && pauseStartWall
        ? handsOffTotalMs + (Date.now() - pauseStartWall)
        : handsOffTotalMs;
      const cprElapsedMs = cprStartedWall
        ? (Date.now() - cprStartedWall) - nowHandsOff
        : 0;
      return {
        running,
        phase,
        compressionCount,
        cycleInBlock: cyclesInBlock,
        rotationNumber,
        handsOffMs: nowHandsOff,
        cprElapsedMs: Math.max(0, cprElapsedMs),
      };
    },
  };
}
