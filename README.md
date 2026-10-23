# Boxxing · phone position finder

One screen for finding where to put your phone for shadow boxing. The camera view shows your 2D skeleton, the 3D view shows an avatar copying you. Move the phone, judge how well the avatar copies you, type a Match % and save the good positions.

**Open:** https://yabsramelaku62-a11y.github.io/boxxing/ (Android Chrome; the camera needs HTTPS)

Everything runs on the phone. Nothing is uploaded.

## Use

1. Open the page. The front camera starts. If the browser asks for a tap, tap **Start camera**.
2. Stand in your spot, still, with your whole body in view, until the status line stops saying "stand still to calibrate".
3. Box. Drag the 3D view to look around; double-tap it to go back to the phone's view.
4. To save a position: type your **Match %** (0–100), tap **Save this position**, walk back during the 10 beeps, hold your fighting stance for 5 seconds until the double beep. It shows "Saved #n · body angle …°".
5. **Export (n)** downloads every saved position as one JSON file.

The front camera is shown mirrored, like a mirror. The saved data is never flipped.

### URL settings

| Parameter | Values | Default |
|---|---|---|
| `camera` | `rear` | front |
| `model` | `lite`, `full`, `heavy` | `full` |
| `res` | `640x480`, `1280x720`, `1920x1080` | `1280x720` |
| `minCutoff`, `beta`, `dCutoff` | smoothing of the 3D points (remembered on the phone) | `1.5`, `5`, `2` |
| `debug=1` | green raw skeleton on the avatar, inference time, wrist visibility | off |
| `demo=1` | synthetic poses, no camera | off |

Example: `…/boxxing/?camera=rear&model=heavy&debug=1`

## Develop

Node 22.12+.

```sh
npm ci
npm run assets   # downloads the MediaPipe models, copies the WASM
npm run dev      # http://localhost:4173 (a phone needs HTTPS)
npm test
npm run build
BASE_PATH=/boxxing/ npm run build && node scripts/check-ui.mjs   # browser check (needs Playwright + Chromium)
```

Pushing to `main` deploys to GitHub Pages (`.github/workflows/pages.yml`).

Licences: see `THIRD_PARTY_NOTICES.md`.
