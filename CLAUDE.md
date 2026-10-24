# Hand tracker

Mobile web app (Vite + TypeScript, MediaPipe Tasks Vision `HandLandmarker` in a worker, Three.js): live 3D hand tracking, fingers from the wrist up, from one phone camera held close (about 20–80 cm, bare hands). The goal is accurate tracking. It started as a shadow-boxing body tracker (repo name `boxxing`); the boxing niche and full-body tracking were dropped on purpose and the code deleted (still in git history before `57195e0`).

## Run, test, deploy

- Node 22.12+. `npm ci`, `npm run assets` (hand model from storage.googleapis.com + WASM into `public/`, git-ignored except `public/models/manifest.json`), `npm run dev`, `npm test`, `npm run build`.
- Browser check: `BASE_PATH=/boxxing/ npm run build && node scripts/check-ui.mjs [outDir]`. Uses the global Playwright and Chromium's fake camera; checks portrait/landscape `?demo=1`, no scrolling, nothing extra, no console errors, 3D hands move, mirror, and that the camera path loads the model.
- Deploy: push to `main` → `.github/workflows/pages.yml` builds with `BASE_PATH=/<repo>/` and publishes `dist/` to https://boxxing-app.github.io/boxxing/. The repo lives in the `boxxing-app` organization because the owner's personal `github.io` redirects to an unrelated custom domain.

## Files

- `main.ts` the screen; `style.css`; `config.ts` URL parameters; `hands.ts` geometry (focal length, pinhole position solve, fixed finger lengths, handedness); `viewer.ts` 3D scene; `demo.ts` synthetic hands for tests and `?demo=1`; `filter.ts` One Euro; `math.ts`.
- `tracker.ts`, `hand.worker.ts`, `asset-loader.ts`, `camera-access.ts`, `wasm-bootstrap.ts`: camera + model loading (kept from the prototype; they work).

## Decisions (keep unless the user changes them)

- One screen, two views, nothing else but one quiet status line (loading, errors, FPS, hand count). Landscape = camera left, 3D right; portrait = camera top, 3D below. Settings only through URL parameters (`camera=rear`, `res`, `fov`, `minCutoff`/`beta`/`dCutoff`, `debug=1`, `demo=1`).
- Camera: default `1280x960` (4:3 = whole sensor; 16:9 crops it) with `resizeMode: none`, and zoom set to its minimum where exposed. The rear camera prefers a lens labelled wide/0.5.
- Front camera: mirror the display only (CSS `scaleX(-1)` on both views); never flip data. Rear camera is not mirrored. Orbit drags are flipped when mirrored.
- Handedness: MediaPipe labels hands as if the image were mirrored; frames are never mirrored, so `sideOf()` swaps the label. If both hands get the same label, the less certain one becomes the other side. Right = green, left = blue.
- Position: each hand's origin is placed by an exact linear pinhole solve of its 3D world landmarks against its image points (`solveTranslation`), with f from `?fov` (default 70° across the long side). The 3D camera sits at the phone (origin, looking −z) with the camera image's field of view and shows exactly its frame (letterboxed like the image), so hands line up with the camera view. `fov` only scales depth.
- Shape: fixed bone lengths per hand = median of the first 30 frames; each bone aimed exactly along its landmark direction, built out from the wrist (`HandShape`). Double-tap re-measures.
- Smoothing: hand shape (metres, relative to the hand centre) minCutoff 1.5, beta 5, dCutoff 2, per hand; position has its own steadier filter (1, 2, 1). URL smoothing is stored under `hands.smoothing.v1`; older keys are deleted.
- Privacy: no backend, no analytics, no uploads. The worker blocks external fetch/XHR; CSP `connect-src 'self'` lives in `index.html` (GitHub Pages ignores `public/_headers`). Every runtime URL uses Vite's `BASE_URL` (the site lives under `/boxxing/`).
- `V(p)=(x,-y,-z)` converts MediaPipe camera axes (x right, y down, z forward) to Three.js.
