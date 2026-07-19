/* SanGuide — persistence (Q5 journal integrity).
 *
 * IndexedDB, one object store `sessions` keyed by id; each session document
 * carries its own events array. Writes are append-on-write inside a single
 * readwrite transaction, so every event is durable the moment it is logged —
 * the controller awaits the write BEFORE advancing the UI (US-7/S1). After a
 * crash the session resumes with a complete journal, at most one event lost.
 *
 * No data ever leaves the device (Q6): this is the only persistence and it is
 * local. CPR elapsed time is reconstructed from these timestamps, never from an
 * in-memory counter (US-7/S2).
 */

import { CONFIG, FIRST_STEP_ID } from './schema.js';

const DB_NAME = 'sanguide';
const DB_VERSION = 1;
const STORE = 'sessions';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    let result;
    Promise.resolve(fn(store)).then((r) => { result = r; }).catch(reject);
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }));
}

function reqAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function newId() {
  if (globalThis.crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'sess-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/* ---- Public API ----------------------------------------------------------- */

export async function createSession(mode = 'LIVE') {
  const session = {
    id: newId(),
    startedAt: Date.now(),
    endedAt: null,
    mode,
    currentStepId: FIRST_STEP_ID,
    events: [],
  };
  session.events.push({ at: session.startedAt, type: 'SESSION_STARTED', detail: null });
  await tx('readwrite', (store) => store.put(session));
  return session;
}

/* Atomic append: read the doc, push the event, put it back in one transaction. */
export async function appendEvent(sessionId, type, detail = null) {
  const event = { at: Date.now(), type, detail };
  await tx('readwrite', async (store) => {
    const session = await reqAsPromise(store.get(sessionId));
    if (!session) throw new Error('appendEvent: unknown session ' + sessionId);
    session.events.push(event);
    store.put(session);
  });
  return event;
}

export async function setCurrentStep(sessionId, stepId) {
  await tx('readwrite', async (store) => {
    const session = await reqAsPromise(store.get(sessionId));
    if (!session) throw new Error('setCurrentStep: unknown session ' + sessionId);
    session.currentStepId = stepId;
    store.put(session);
  });
}

export async function endSession(sessionId) {
  await tx('readwrite', async (store) => {
    const session = await reqAsPromise(store.get(sessionId));
    if (!session) throw new Error('endSession: unknown session ' + sessionId);
    session.endedAt = Date.now();
    session.events.push({ at: session.endedAt, type: 'SESSION_ENDED', detail: null });
    store.put(session);
  });
}

export function getSession(sessionId) {
  return tx('readonly', (store) => reqAsPromise(store.get(sessionId)));
}

/* Most recent session that is not ended and started < RESUME_WINDOW_MS ago
 * (US-1/S2). Returns null if none — the app then shows the fresh start screen. */
export async function getOpenSession() {
  const all = await tx('readonly', (store) => reqAsPromise(store.getAll()));
  const now = Date.now();
  const open = (all || [])
    .filter((s) => !s.endedAt && (now - s.startedAt) < CONFIG.RESUME_WINDOW_MS)
    .sort((a, b) => b.startedAt - a.startedAt);
  return open[0] || null;
}
