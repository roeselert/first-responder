/* SanGuide — screen wake lock (US-1/S1, US-1/S4).
 *
 * Keeps the screen awake during guidance, re-acquiring after the tab is hidden
 * and shown again. Degrades to a silent no-op when the platform lacks or denies
 * the API: audio pacing remains authoritative and no error is shown to the user.
 */

let sentinel = null;
let wanted = false;

async function request() {
  if (!('wakeLock' in navigator)) return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => { sentinel = null; });
  } catch (_) {
    sentinel = null; // denied — ignore, audio stays authoritative
  }
}

function onVisibility() {
  if (wanted && !sentinel && document.visibilityState === 'visible') {
    request();
  }
}

export async function acquire() {
  wanted = true;
  document.addEventListener('visibilitychange', onVisibility);
  await request();
}

export async function release() {
  wanted = false;
  document.removeEventListener('visibilitychange', onVisibility);
  if (sentinel) {
    try { await sentinel.release(); } catch (_) { /* ignore */ }
    sentinel = null;
  }
}
