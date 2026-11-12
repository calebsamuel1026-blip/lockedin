# lockedin

A free focus timer that uses on-device computer vision to notice when you pick up your phone, doze off or zone out, and rewards you for staying focused.

Live: **https://calebsamuel1026-blip.github.io/lockedin/**

## Why

Ordinary focus timers trust you: the clock keeps running while you scroll your phone. lockedin watches for the real distractions through the webcam, entirely in the browser, so the focus score reflects what actually happened. No camera frame ever leaves the device.

## How it works

```
webcam --> vision.js (MediaPipe, on device) --> signals --> engine.js (1 state per second) --> app.js UI, rewards, clips
           face landmarks every 200 ms             phone in hand, head down, eyes closed,   focused / phone / chat /
           object detector every 1.2 s             yawns, looking away, talking, others     down / sleepy / zoned
           body pose when the face is lost         in frame, tracking quality
```

- **Vision** (`vision.js`). MediaPipe Tasks Vision runs three models in the browser: Face Landmarker for head pose, eyes and jaw; an EfficientDet-Lite2 object detector for phones and other people; and a lite Pose Landmarker that takes over when you look down so far that the face tracker loses you. There is no calibration step: it learns your "work zone" from the middle 80% of your recent head poses, saves your head pose whenever a phone is detected in your hand as an example of "you on your phone", and takes "Not my phone" feedback as an exception.
- **Decision engine** (`engine.js`, pure logic, no DOM). Every second each candidate state gets an evidence score and the strongest wins. Drowsiness uses PERCLOS (share of the last minute with eyes shut). Returning to Focused needs two steady seconds so the status doesn't flicker, and the UI shows the reason for each decision. Because it has no DOM, the same code runs in the site and in a simulator used to tune thresholds.
- **Detection check** (`lab.html`, `lab.js`). A guided three-minute test that records what the camera measured during known poses, so detection can be tuned from real data. Results stay on the device unless you download them.
- **Rewards** (`rewards.js`). Keys (an in-app currency), a shop, daily streaks and a shareable "your week, wrapped" image.
- **Lock-out clips** (`clips.js`, opt-in). Short clips of the moments you got distracted, kept in memory and shown when the session ends. A clip leaves the device only if you share it as a link.
- **Storage and sync.** Everything lives in `localStorage` (and IndexedDB for a custom background photo). Optional sign-in syncs progress through Supabase with row-level security; `merge.js` holds pure merge rules (keep the max of every counter and the union of history) so progress is never lost when two devices both changed.
- **Analytics** (`analytics.js`). Nothing is sent until the visitor taps "Allow analytics". Camera data, clips, audio, face measurements and typed text are never sent.

## Key features

- Background focus timer with live status and a focus score
- On-device phone, head-down, drowsiness and looking-away detection
- Learns how you sit, no setup
- Streaks, keys, a shop and weekly recap images
- Opt-in lock-out clips and shareable clip links
- Works signed out and offline (service worker), installable as a PWA

## Tech stack

Vanilla JavaScript ES modules with no build step, MediaPipe Tasks Vision (WebAssembly + TFLite models), Canvas, IndexedDB, a service worker, Supabase (Auth, Postgres with row-level security), GitHub Pages.

## Run locally

The camera needs a secure context, and `localhost` counts:

```bash
python -m http.server 8000   # then open http://localhost:8000
```

`config.js` holds the public Supabase URL and publishable key; access is controlled by row-level security in the database.
