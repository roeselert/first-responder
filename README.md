# SanGuide — First Responder Guide

Offline-first PWA that guides a **trained first responder** through emergency
treatment schemas. See [`CLAUDE.md`](./CLAUDE.md) for the architecture spine,
vision, quality goals and context.

> **Status: F1 + F2 implemented (Phase 3).** The full "unconscious patient →
> assessment → CPR" flow works offline: guided assessment, audio-paced 30:2 CPR,
> a timestamped journal and share. A second schema guides the treatment of a
> **responsive** patient (DLRG San A, S. 82). UI and cues are in German.

## What's in this iteration

- Static, no-build **PWA shell**: `index.html`, `css/`, `js/` (ES modules, no
  toolchain).
- **Offline-first** service worker (`service-worker.js`) that precaches the shell
  so it opens with zero runtime network calls (quality goal Q1).
- **Web app manifest** (`manifest.webmanifest`) for home-screen install.
- **App icon**: a rounded red medical plus on a warm yellow field
  (`icons/`). Original mark — deliberately *not* the Geneva-cross emblem — to
  stay clear of protected Red Cross / DLRG trademarks.

### F1 — unconscious patient: assessment → CPR

One-tap start guides the responder through scene safety, responsiveness, a bounded
10 s breathing check, the emergency call / AED prompt, and audio-paced CPR at a
fixed 110/min in a 30:2 rhythm with a hands-free ventilation window and a
helper-rotation prompt every five cycles. The **breathing-normal branch** leads
through the recovery position, emergency call and warmth (each skippable) into a
recurring 3-minute monitoring loop; a permanent **"Atmet nicht mehr"** action
escalates straight back into CPR without repeating the assessment. Every confirmed
action is written to a local, crash-resilient journal (IndexedDB) with absolute
timestamps and shared as plain text for EMS handover. The guidance content lives as reviewable data in
`js/schema.js`; the state machine, persistence, audio and journal are separate
ES modules (`js/cpr.js`, `js/store.js`, `js/audio.js`, `js/journal.js`,
`js/wakelock.js`). Spoken cues use `speechSynthesis` and fall back to distinct
synthesized tones when no offline German voice is available (no runtime network,
Q1/Q6).

### F2 — responsive patient (DLRG San A, Schema S. 82)

The assessment branches at **"Anschauen – Ansprechen – Anfassen"**: "Reagiert
nicht" (primary) continues into F1, a secondary **"Reagiert"** enters the
responsive-patient schema. Its left-hand questions are worked through in
sequence — patient endangered, life-threatening bleeding (with tourniquet
time logging), cervical-spine suspicion, airway obstruction, oxygen indication,
blood pressure/pulse, shock signs (with visible contraindications), restricted
movement (axial handling), acute abdomen — and every "Ja" opens the matching
measure step with an on-demand how-to. The loop ends in a care/monitoring
screen that re-runs the whole schema every 3 minutes; a permanent **"Reagiert
nicht mehr"** action switches to schema II (call for help → breathing check →
CPR or recovery position). All findings and measures land in the same journal.

## Run locally

No toolchain, no dependencies. Serve the folder over HTTP (a service worker
needs an origin, so opening `index.html` via `file://` won't register it):

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploy

Pure static assets served from the repository root — hosted on **GitHub Pages**.

Deployment is automated by [`.github/workflows/static.yml`](./.github/workflows/static.yml),
which publishes on every push to `main`. To enable it once: in the repository,
go to **Settings → Pages → Build and deployment** and set the **Source** to
**GitHub Actions**.

The site is served from a project subpath (`https://<owner>.github.io/<repo>/`).
All asset, manifest and service-worker references are relative (`./…`) and a
`.nojekyll` file disables Jekyll processing, so the shell works unchanged under
that subpath.

## Regenerating icons

The PNG icons are produced from a small stdlib-only script (no image libraries):

```sh
python3 icons/gen_icons.py
```

## Design notes

Scandinavian, light and calm: warm off-white surfaces, generous whitespace,
system font stack, rescue-inspired yellow/red used sparingly as accents. Touch
targets and type are sized for glanceable, one-handed use under stress (Q2).
The palette is original and does not reproduce any trademark.
