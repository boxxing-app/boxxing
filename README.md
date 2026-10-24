# Hand tracker

Live 3D hand tracking from one phone camera. The camera view shows the tracked points on your hands; the 3D view shows both hands, with every finger, where they are in front of the phone. Hold your hands close to the phone (roughly 20–80 cm).

**Open:** https://boxxing-app.github.io/boxxing/ (Android Chrome; the camera needs HTTPS)

Everything runs on the phone. Nothing is uploaded.

## Use

1. Open the page. The front camera starts. If the browser asks for a tap, tap **Start camera**.
2. Show both hands, open, for a second: the app measures your finger lengths from the first frames.
3. Drag the 3D view to look around, pinch to zoom, double-tap to go back to the phone's view and measure the fingers again.

Green is your right hand, blue your left. The status line shows each hand's distance from the phone (for example `R 42 cm · L 45 cm`). The 3D view stays level with the floor when the phone can report its tilt; on iPhone, tap the screen once to allow it. The front camera is shown mirrored, like a mirror; the data is never flipped.

The distance is estimated from the camera image: browsers do not give web pages access to a phone's depth sensor. If hands look too near or too far when you orbit the 3D view, adjust `fov`.

### URL settings

| Parameter | Values | Default |
|---|---|---|
| `camera` | `rear` | front |
| `res` | `640x480`, `1280x960`, `1920x1440` (4:3, whole sensor); `1280x720`, `1920x1080` (16:9, cropped) | `1280x960` |
| `fov` | the camera's field of view across the long side of the picture, in degrees (20–150). Only sets the depth scale. | `70` |
| `minCutoff`, `beta`, `dCutoff` | smoothing of the hand shape (remembered on the phone) | `1`, `5`, `2` |
| `debug=1` | white raw landmarks on the 3D hands, camera size, inference time, handedness scores, phone pitch/roll | off |
| `demo=1` | synthetic hands, no camera | off |

Example: `…/boxxing/?camera=rear&debug=1`

## Develop

Node 22.12+.

```sh
npm ci
npm run assets   # downloads the MediaPipe hand model, copies the WASM
npm run dev      # http://localhost:4173 (a phone needs HTTPS)
npm test
npm run build
BASE_PATH=/boxxing/ npm run build && node scripts/check-ui.mjs   # browser check (needs Playwright + Chromium)
```

Pushing to `main` deploys to GitHub Pages (`.github/workflows/pages.yml`).

Licences: see `THIRD_PARTY_NOTICES.md`.
