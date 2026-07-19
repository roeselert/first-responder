/* SanGuide bootstrap — no business logic yet.
 * Registers the service worker and reflects offline-readiness in the footer. */

(function () {
  'use strict';

  const statusEl = document.getElementById('offline-status');
  const statusText = document.getElementById('offline-status-text');

  function setStatus(ready, text) {
    if (statusEl) statusEl.setAttribute('data-ready', ready ? 'true' : 'false');
    if (statusText) statusText.textContent = text;
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./service-worker.js')
        .then(function (reg) {
          if (reg.active) {
            setStatus(true, 'Ready offline');
          } else {
            setStatus(false, 'Setting up offline mode…');
            navigator.serviceWorker.ready.then(function () {
              setStatus(true, 'Ready offline');
            });
          }
        })
        .catch(function () {
          setStatus(false, 'Offline mode unavailable');
        });
    });
  } else {
    setStatus(false, 'Offline mode not supported');
  }
})();
