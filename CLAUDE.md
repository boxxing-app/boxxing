# Boxxing · phone position finder

Mobile web app (Vite + TypeScript, MediaPipe Tasks Vision `PoseLandmarker` in a worker, Three.js). One screen to find the best phone position for shadow boxing: camera + 2D skeleton, 3D avatar copying the user, a Match % field and "Save this position". Later goal: a 3D avatar that copies moves live from one phone camera and shows mistakes. The user is orthodox and trains at ~45° to the phone (phone on their front-right diagonal).

## Run, test, deploy

- Node 22.12+. `npm ci`, `npm run assets` (models from storage.googleapis.com + WASM into `public/`, git-ignored), `npm run dev`, `npm test`, `npm run build`.
- Browser check: `BASE_PATH=/boxxing/ npm run build && node scripts/check-ui.mjs [outDir]`. Uses the global Playwright and Chromium's fake camera; checks portrait/landscape `?demo=1`, no scrolling, no extras, no console errors, avatar moves, mirror, save/export, and the camera path.
- Deploy: push to `main` → `.github/workflows/pages.yml` builds with `BASE_PATH=/<repo>/` and publishes `dist/` to https://boxxing-app.github.io/boxxing/ (Settings → Pages → Source: GitHub Actions).

## Files

- `main.ts` the screen; `style.css`; `config.ts` URL parameters; `capture.ts` the saved record; `storage.ts` IndexedDB `boxxing-positions`.
- `tracker.ts`, `pose.worker.ts`, `asset-loader.ts`, `camera-access.ts`, `wasm-bootstrap.ts`: camera + model loading (kept from the prototype; they work).
- `rig.ts` avatar + solver; `viewer.ts` 3D scene; `motion.ts` floor, tilt, root position; `filter.ts` One Euro; `math.ts`; `demo.ts` synthetic poses for tests and `?demo=1`.

## Decisions (keep unless the user changes them)

- One screen only. Allowed extras: one quiet status line (loading, errors, FPS) and a tiny "Export (n)" link. No other UI. Settings only through URL parameters (`camera=rear`, `model`, `res`, `minCutoff`/`beta`/`dCutoff`, `debug=1`, `demo=1`).
- Layout: landscape = camera left, 3D right; portrait = camera top, 3D below; both as large as possible (watched from 2–3 m). Camera image is letterboxed (`contain`); the 3D view uses the phone's vertical field of view and fills its pane.
- Front camera: mirror the display only (CSS `scaleX(-1)` on both views); never flip data. Rear camera is not mirrored. Orbit drags are flipped when mirrored.
- Save: Match % required → 10 one-per-second beeps (the only sound) → 5 s hold recorded → double beep → one IndexedDB record (time, Match %, body angle, phone pitch/roll, camera facing/label/resolution, model, median FPS, p95 inference, pose %, key-joint visibility, raw jitter in mm, the raw 2D + world landmarks). Tilt permission is requested on the first press where needed (iOS). Shows "Saved #n · body angle N°" for 3 s.
- Body angle: torso facing vs the direction to the camera; positive = phone to the front-right. Corrected for being off the lens axis.
- Privacy: no backend, no analytics, no uploads. The worker blocks external fetch/XHR; CSP `connect-src 'self'` lives in `index.html` (GitHub Pages ignores `public/_headers`). Every runtime URL uses Vite's `BASE_URL` (the site lives under `/boxxing/`).
- Rig conventions: `V(p)=(x,-y,-z)`; MediaPipe's left is +x; limbs are aimed exactly along landmark directions (keep this solver). Pelvis from the hip line, chest (child of pelvis) from the shoulder line, neck aimed shoulder-mid → ear-mid, head from ears + nose. Rotations are solved relative to the mesh, so the parent group can move/level it.
- Smoothing: separate world (metres; default minCutoff 1.5, beta 5, dCutoff 2) and image (0–1; beta 12) settings. URL values are stored under `boxxing.smoothing.world.v2`; old `motion-*` keys are deleted.
- Root motion: MediaPipe world points are hip-centred. Height = lowest foot point (27–32) on the floor every frame (levelled by phone tilt if available). Floor position = pinhole from the torso scale vs a still start (nominal d0 = 3 m, f = s0·d0, Z = d0·s0/s, X = (u−cx)·Z/f), paraperspective-corrected, slower filter. Re-measured after Save, after a double-tap, and after 2 s with no pose.
- Tests (`tests/`): bone directions within 1° at 0/45/90° with twist/duck/slip; feet within 2 cm of the floor in a duck; steps within 5 cm; head moves vs chest in a slip; 45 cm 150 ms jab ≥ 90% at 20 fps.
