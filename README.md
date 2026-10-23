# Boxxxing Motion Lab

A private, on-device experiment for Android Chrome: one camera → a tracker skeleton and a rigged humanoid. Find a useful camera position for shadow boxing.

## Start

1. Open the published site in Chrome. Use the same phone and browser for all tests.
2. Tap **Start placement test**, then **Use next test**.
3. Mark your spot and punch line with tape. Follow the floor guide.
4. Tap **Enable camera**. Pick a lens if Chrome lists more than one. Let the rig calibrate while your whole body is visible.
5. Face the punch line with arms down for the angle check. Extend both arms and take one step each way. Tick the space check.
6. Test the voice. Enable tilt if your phone supports it.
7. Start. Follow the text, speech and beeps. Each session takes about 3 minutes including cue changes.
8. Check Results, then continue the suggested stage. Export JSON regularly.

Camera permission is requested only when you tap. Audio recording is never requested. Video recording is off by default. A poor view can still be measured with **Test this view anyway**; that override is recorded.

Model loading shows download progress and reuses complete model/runtime files cached on this device. Active downloads have no overall time limit. Stalls retry up to three times after 1, 2 and 4 seconds, with inactivity limits of 30, 60, 120 and 240 seconds. HTTP access failures and invalid login-page responses stop immediately with a specific message. A stalled startup retries with doubled stage timeouts, up to three worker attempts; a GPU startup failure switches to CPU. **Stop camera / cancel loading** cancels immediately, including during a retry wait.

If iPhone Chrome shows no camera prompt, check **Settings → Privacy & Security → Camera → Chrome** and the site's camera permission using the camera icon beside Chrome's address bar, when shown. Open the published URL in a full browser tab; an embedded preview may not have camera permission. **Camera help** displays the current page's access checks. A denied request is not retried automatically. Unavailable saved lens settings fall back once to automatic selection. On iPhone the initial lens stays open; choose another lens manually after access is granted. The camera preview appears before model loading completes. Stop also cancels a pending permission request in the app, and any stream returned after cancellation is immediately closed. iPhone camera and tracking behavior still require testing on a real device.

## Local development

Use Node 22.12+ (Node 24 recommended).

```sh
npm ci
node scripts/assets.mjs
npm run dev
```

Open the address Vite prints. A desktop may use localhost for camera access. A phone needs a valid HTTPS address: a plain LAN HTTP address will not work.

```sh
npm test
npm run build
```

`dist/` is the static production site. The source download omits large model and WASM files; `scripts/assets.mjs` restores them. It fetches fixed model revision 1, splits large files into 8 MB pieces and records SHA-256 checksums. The app checks the model hash before loading it.

Dependencies checked on 23 October 2026: MediaPipe Tasks Vision **1.1.1**, Three.js **0.186.1**, Vite **8.3.5**, Vitest **5.0.5**. TypeScript **6.0.3** is pinned because TypeScript 7's native compiler cannot run in the restricted build host. See the lockfile for exact dependencies.

## Experiment stages

- A: six angles, 0.9 m high, 3 m away, landscape, Full.
- B: the two best A angles, four heights.
- C: the best B angle and height, four distances.
- D: both orientations × all three models.
- Repeat: the top three combinations, three total sessions each.

Identical combinations already measured in an earlier stage count toward the next stage. The guide uses complete, real sessions with the same stance, lens, camera direction, requested resolution and filter settings. It always uses default score weights. Missing scores can block advancement; repeat an unscored view or run a manual combination. Results weights only change the results ranking.

The floor guide uses forward = distance × cos(angle), sideways = distance × sin(angle). Chest side is right for orthodox and left for southpaw. Closed side reverses that. Heights refer to the lens, not the phone's base. Distance is horizontal floor distance.

## What is recorded

Each processed camera frame stores time, current cue, raw 2D and world points, visibility/presence when supplied by MediaPipe, smoothed points, local rig quaternions, solved rig joints, approximate image projections, inference time, tracking FPS, pipeline time, camera frame counter and sensor angles. Frames with no pose are also stored. World points use MediaPipe's hip-centred coordinates, in estimated metres. Rig points are converted back to the same axes. Quaternions are local Three.js rotations, in x/y/z/w order.

Each session stores requested settings, actual camera settings, browser user agent, delegate, rig calibration, cue boundaries, completion status and notes. User agents may not reveal the exact phone model. Cue intervals exclude the three-second preparation before each movement. A backgrounded page stops and saves a partial session to protect timing.

Sessions use IndexedDB. JSON contains all frames and cue times. CSV contains whole-session and per-cue measurements. Video is a separate local Blob: use its own download button. JSON import does not include video. Imported measurements are recalculated. Demo data is always labelled synthetic and excluded from the real experiment.

Local browser storage can be evicted. Export files you want to keep. The app shows a rescue download if saving fails.

## Avatar and licence

**Boxxxing Lab Mannequin v1** is original procedural geometry made for this project. It uses Three.js `SkinnedMesh`, `Skeleton`, `Bone`, skin indices and skin weights. It is included under the **MIT licence**, along with the application code. No downloaded character or VRM is used. The model definition and solver are in `src/rig.ts`; it can be regenerated from that code.

The rig calibrates symmetric limb lengths using the median of 30 visible setup frames, then holds them fixed during a session. Bone rotations follow smoothed landmark directions. It has a rigid stylized mesh, not a detailed anatomical or production character. No finger, wrist twist or facial tracking is claimed.

The green skeleton directly displays raw tracker points. The white mannequin uses the rig. Drag the 3D view to orbit, or overlay both views. Saved sessions can replay their raw and smoothed landmarks with the saved rig dimensions.

Third-party notices: `THIRD_PARTY_NOTICES.md` and `public/licenses/`. MediaPipe and its bundled pose models: Apache 2.0. Three.js: MIT. Model licence source: Google's BlazePose GHUM 3D model card.

## Metrics

Measurements require visibility ≥ 0.5 on their relevant joints. Missing values are `null` / “—”, never a perfect score. Holds skip their first second; known poses skip their first 0.75 seconds.

| Measurement | Meaning and limit |
| --- | --- |
| Median FPS | Processed tracking frames per second, based on frame pickup times. Not display refresh rate. |
| Inference p95 | 95th percentile of time inside the worker's detection call. |
| Frames not tracked | Percentage of presented camera frames not processed. Uses `presentedFrames`, where available. Not sensor hardware drop rate. |
| Pipeline p95 | Frame pickup → render submission. Includes transfer, inference, filtering and solving. GPU/display completion is not measurable here. |
| Capture latency | Capture → render submission only when the browser exposes `captureTime`; otherwise unavailable. |
| Pose found | Percentage of processed frames with 33 world landmarks. |
| Joint visibility | Percentage of all processed frames where that joint has visibility ≥ 0.5. |
| Possible swaps | Consecutive shoulder/hip labels fit the opposite side much better than the same side. A heuristic: fast real turns can trigger it; arm-only swaps may be missed. |
| Stillness jitter | Mean frame-to-frame displacement of visible nose, wrists, elbows and shoulders, in estimated mm. Raw and smoothed, separately. Depends on FPS. |
| Bone variation | Sample standard deviation ÷ mean length × 100. Upper arms, forearms, thighs, shins and shoulder width. |
| Known-pose errors | Elbow difference from 180°, shoulder from 90°, and arm direction from the tape-derived direction. T arms use the perpendicular to the punch line. Real pose execution errors also affect this metric. |
| Body-angle error | Neutral torso normal versus entered signed angle. Uses shoulder and hip lines. Tilt and monocular depth error affect it. |
| Punches | Peak detection with a 12 cm prominence and a refractory interval. Straight punches use wrist travel along the entered punch line; hooks use shoulder–wrist distance; uppercuts use vertical travel. This is a rough detector. |
| Extension | Maximum elbow angle near each detected punch, plus overall maximum and mean peak extension. Slow straight punches are compared with a 165° target. Fast loss is slow mean minus fast mean. |
| Head movement | 5th–95th percentile sideways/downward range in the initial body axes, relative to the hips; peaks estimate counts. Hip-centred landmarks do not measure absolute travel through a room. |
| Rig reprojection | Mean image distance as a percentage of pixel-space shoulder width. Fits a uniform scale and translation using torso joints only. Weak perspective; no lens calibration. |
| Rig angle error | Mean difference from raw landmark elbow, knee and shoulder angles. Includes retargeting and smoothing. |
| Guard shift | Change in mean nose/wrist positions between opening and closing guard. Real posture changes are included; not pure tracker drift. |

Performance and head metrics are reported but are not in the requested default total. Image projections are stored in normalized x/y coordinates. Calculations correct for the actual image aspect ratio.

## Scores

This is an experimental, unvalidated consistency score. It does not measure real 3D accuracy.

All components are clamped to 0–100. For an error `e` and limit `L`, the component is `100 × clamp(1 − e/L, 0, 1)`.

| Category | Weight | Normalization |
| --- | ---: | --- |
| Rig | 20 | Mean of reprojection (L = 50% shoulder width) and angle error (L = 30°) |
| Punch | 20 | Mean count agreement, slow extension from 90° to 165°, and fast extension loss (L = 45°) |
| Bone stability | 15 | Mean bone coefficient of variation, L = 20% |
| Known poses | 15 | Mean absolute known-pose angle/direction error, L = 45° |
| Reliability | 15 | Mean of pose-found percentage and mean joint-visible percentage |
| Jitter | 10 | Raw stillness jitter, L = 30 mm per processed frame |
| Body angle | 5 | Neutral body-angle error, L = 45° |

Editable weights are normalized by their sum. A required missing component means no total score. A zero weight excludes that component. Complete scored sessions determine winners. Repeats are grouped by placement, model, camera, resolution, stance and smoothing. Spread is **sample standard deviation**, not a confidence interval. “Too close to call” appears when both top groups have repeats and their means differ by no more than the sum of their standard deviations. Single runs are provisional.

Charts are descriptive averages over available sessions. Because this is a staged search, they are not controlled estimates of the independent effect of each variable.

## Privacy

No backend, analytics, accounts or upload endpoint. Scripts, WASM and models are served from this same site. MediaPipe's package notice says it can send usage/performance metrics; this app blocks external fetch/XHR requests in its worker, uses a restrictive Content Security Policy, and supplies response headers for static hosts that support them. The app makes no data submission requests. Camera frames are transferred only to a local worker. Speech selects an installed **local English voice**; remote voices are not used. If none is installed, you get beeps and text.

The site host still handles normal page/model downloads and any host-level access control. “Local only” refers to camera input and experiment records. Clearing browser data removes records. Loading models requires a connection; a full offline PWA is not included.

## Known limits and verification

- No mocap ground truth, camera intrinsics or validated boxing technique model.
- A single camera can lose fast or hidden wrists, confuse body sides, and estimate incorrect depth. The tracker skeleton is not physical truth.
- Phone tilt is recorded (alpha/beta/gamma and screen orientation); it is not used as an extrinsic calibration. Angle and arm-direction comparisons are approximate, especially for floor/head placements.
- Hip-centred tracking keeps the avatars near their origin. Room translation is not recovered. Head ranges are hip-relative, not total duck/step distance.
- Local inference uses a worker, prefers GPU and falls back to CPU. Devices without worker/OffscreenCanvas/WASM/WebGL support may not work. Heavy can be slow and use substantial memory.
- Lens names and availability depend on the browser. A browser may ignore requested resolution; the actual values are stored.
- Readiness checks cannot prove future reach or stepping space. The manual sweep check is required for a green Ready label. Sensors may be missing.
- Every processed frame is stored, not every camera frame. Smoothing trades jitter for delay. Low FPS can make jitter look worse and miss fast punches.
- Speech depends on an installed local English voice and browser speech support. The cue schedule does not wait for speech to finish.
- Hooks, uppercuts and head repetition counts use simple heuristics, not validated classifiers.
- Tests cover geometry, filters, fixed rig lengths, calibration restore, staged search, score normalization, missing data, synthetic sessions, import validation, long downloads, exponential backoff, cache validation, GPU fallback and cancellation. A real Android camera/boxing session is still needed to evaluate tracking quality and phone performance.

## Deploy elsewhere

The requested site is hosted with ChatGPT Sites. To move it:

1. Run `npm ci`, `node scripts/assets.mjs`, then `npm run build`.
2. In Netlify, deploy `dist/`, or connect this repository with build command `npm run build` and publish directory `dist` (ensure assets have been generated).
3. Keep HTTPS enabled. `_headers` contains the privacy policy for compatible static hosts.

For GitHub Pages under a repository subpath, adjust Vite `base` and all root-relative model/worker/help links first. Netlify at the domain root needs no path changes.

## References checked

- [MediaPipe Web guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)
- [Pose models](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker)
- [BlazePose GHUM model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf)
- [Three.js SkinnedMesh](https://threejs.org/docs/pages/SkinnedMesh.html)
- [One Euro Filter](https://github.com/casiez/OneEuroFilter)
- [Video frame callback specification](https://wicg.github.io/video-rvfc/)
