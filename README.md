---
title: SanGuide
emoji: ➕
colorFrom: yellow
colorTo: red
sdk: static
app_file: index.html
pinned: false
license: mit
---

# SanGuide — First Responder Guide

Offline-first PWA that guides a **trained first responder** through emergency
treatment schemas. See [`CLAUDE.md`](./CLAUDE.md) for the architecture spine,
vision, quality goals and context.

> **Status: bootstrap (Phase 1).** This iteration ships only the installable app
> shell and a "hello world" screen. No guidance logic — no metronome, journal or
> schemas yet.

## What's in this iteration

- Static, no-build **PWA shell**: `index.html`, `css/`, `js/`.
- **Offline-first** service worker (`service-worker.js`) that precaches the shell
  so it opens with zero runtime network calls (quality goal Q1).
- **Web app manifest** (`manifest.webmanifest`) for home-screen install.
- **App icon**: a rounded red medical plus on a warm yellow field
  (`icons/`). Original mark — deliberately *not* the Geneva-cross emblem — to
  stay clear of protected Red Cross / DLRG trademarks.

## Run locally

No toolchain, no dependencies. Serve the folder over HTTP (a service worker
needs an origin, so opening `index.html` via `file://` won't register it):

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploy

Pure static assets, served from the repository root — compatible with Hugging
Face Spaces (`sdk: static`), GitHub Pages, or any static host.

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
