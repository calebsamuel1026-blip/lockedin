// On-device attention detection with MediaPipe. Frames never leave the browser.
//
// No setup step: lockedin learns how you sit while you use it.
//  - Work zone: where your head normally points. Built from the middle 80% of your head poses over
//    the last ~10 minutes (people spend most of their time looking at their work), skipping moments
//    when a phone is around or you're tipped down. It follows you if you move the laptop.
//  - Phone pose: whenever the phone detector sees a phone in your hand, your head pose at that moment
//    is saved as an example of "you on your phone". This sharpens phone detection over time.
//  - Feedback: "Not my phone" adds your current pose to the work zone.
// Signals exposed to the app: phone in hand, phone call, phone posture, head down, head on the desk, eyes closed,
// yawns, looking off-screen, turned sideways, talking (not chewing), other people in frame, and tracking quality.
const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1";
const FACE_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const OBJ_MODEL = "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite";
const FACE_EVERY_MS = 200;
const OBJ_EVERY_MS = 1200;
const LEARN_EVERY_MS = 1000;   // one learning sample per second
const WORK_BUF = 600;          // ~10 minutes of samples
const MIN_TO_JUDGE = 15;       // ~15 seconds of learning before judging
const DEG = 180 / Math.PI;

// Detection thresholds. Defaults were picked by tests/tune.mjs against thousands of simulated users.
export const TUNE = {eyeMove: 0.05, marginPitch: 8, marginYaw: 14, marginEye: 5, phoneNear: 0.95, downDeg: 12, downRatio: 0.1, eyeDown: 8, matchDeg: 5,
  sideExtra: 4,       // degrees past the work zone's side edge (plus margin) that count as "turned away"
  deskHits: 0.15,     // face found in under this share of recent frames after eyes shut = head on the desk
  talkSd: 0.05, talkOpen: 0.18, chewRhythm: 0.6, // jaw spread, widest opening, and how clock-like the jaw can be and still be speech
  callCy: 0.42, callHoldMs: 12000};  // a phone seen this high in frame (at your ear) while you talk = phone call

// Try the graphics card first. If that fails, retry on the CPU with a fresh runtime, because a failed
// GPU start can leave the shared one unusable.
let cpuFallback = false;   // reported as the "backend" in analytics
async function makeTask(Cls, fileset, path, extra, FilesetResolver) {
  const opts = d => ({baseOptions: {modelAssetPath: path, delegate: d}, runningMode: "VIDEO", ...extra});
  try { return await Cls.createFromOptions(fileset, opts("GPU")); }
  catch (err) {
    console.warn("GPU vision failed, using CPU", err);
    cpuFallback = true;
    const fresh = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
    return await Cls.createFromOptions(fresh, opts("CPU"));
  }
}

// Your face is the biggest one in frame; anyone else is a second face.
function mainFaceIndex(r) {
  let best = 0, bestW = -1;
  r.faceLandmarks.forEach((L, i) => { const w = Math.hypot(L[33].x - L[263].x, L[33].y - L[263].y); if (w > bestW) { bestW = w; best = i; } });
  return best;
}

function measure(r, i) {
  const L = r.faceLandmarks[i];
  const nose = L[1], le = L[33], re = L[263], chin = L[152];
  const ex = (le.x + re.x) / 2, ey = (le.y + re.y) / 2;
  const eyeDist = Math.hypot(le.x - re.x, le.y - re.y) || 1e-6;
  const bs = {};
  (r.faceBlendshapes?.[i]?.categories || []).forEach(c => (bs[c.categoryName] = c.score));
  let pitch = null, yaw = null;
  const M = r.facialTransformationMatrixes?.[i]?.data;
  if (M && M.length >= 16) {
    pitch = Math.atan2(M[9], M[10]) * DEG;
    yaw = Math.atan2(-M[8], Math.hypot(M[9], M[10])) * DEG;
  }
  const ratio = (nose.y - ey) / ((chin.y - ey) || 1e-6); // grows as the head tips down
  if (pitch == null) { pitch = (ratio - 0.5) * 120; yaw = ((nose.x - ex) / eyeDist) * 60; }
  return {
    pitch, yaw, ratio,
    eyeDown: ((bs.eyeLookDownLeft || 0) + (bs.eyeLookDownRight || 0)) / 2,
    eyeUp: ((bs.eyeLookUpLeft || 0) + (bs.eyeLookUpRight || 0)) / 2,
    // Horizontal gaze: both eyes looking the same way (left eye out + right eye in = looking one side).
    gazeX: ((bs.eyeLookOutLeft || 0) - (bs.eyeLookInLeft || 0) + (bs.eyeLookInRight || 0) - (bs.eyeLookOutRight || 0)) / 2,
    blink: ((bs.eyeBlinkLeft || 0) + (bs.eyeBlinkRight || 0)) / 2,
    smile: ((bs.mouthSmileLeft || 0) + (bs.mouthSmileRight || 0)) / 2,
    brow: bs.browInnerUp || 0,
    jaw: bs.jawOpen || 0,
    size: eyeDist,
  };
}

const feat = m => [m.pitch, m.yaw, (m.eyeDown - m.eyeUp) * 30];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], (a[2] - b[2]) * 0.7);
// Typed-array sort is numeric and much faster than a comparator sort (this runs every few seconds).
const sorted = arr => Float64Array.from(arr).sort();
const at = (a, p) => a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))];
const pct = (arr, p) => at(sorted(arr), p);

// Build the model from learned samples. work: [{f, ratio}], phone: [f].
export function buildModel(work, phone) {
  const F = work.map(w => w.f);
  const cols = [0, 1, 2].map(k => sorted(F.map(f => f[k])));
  const min = cols.map(c => at(c, 0.1)), max = cols.map(c => at(c, 0.9));
  const ratioMax = pct(work.map(w => w.ratio), 0.9);
  const ph = phone.length >= 4 ? [0, 1, 2].map(k => pct(phone.map(f => f[k]), 0.5)) : null;
  const downSign = ph ? Math.sign(ph[0] - (min[0] + max[0]) / 2) || 0 : 0;
  const step = Math.max(1, Math.floor(F.length / 40));
  return {v: 3, work: F.filter((_, i) => i % step === 0).slice(-40), min, max, ratioMax, phone: ph, downSign, at: Date.now()};
}

export class Vision extends EventTarget {
  constructor(video, overlay, getSensitivity) {
    super();
    this.video = video; this.overlay = overlay; this.getSensitivity = getSensitivity;
    this.on = false; this.ready = false; this.failed = false; this.stream = null;
    this.face = null; this.obj = null; this.busy = false;
    this.faceAt = 0; this.phoneAt = 0; this.phoneHeldAt = 0; this.phoneBox = null; this.othersAt = 0;
    this.downEMA = 0; this.headDownEMA = 0; this.offEMA = 0; this.downAtLoss = false;
    this.model = null; this.last = null; this.lastAt = 0;
    this.workBuf = []; this.phoneBuf = []; this.recent = []; this.lastLearn = 0; this.lastBuild = 0;
    this.lastFace = 0; this.lastObj = 0; this.lastFrameAt = 0; this.lastVideoTime = -1;
    this.reader = null; this.useVideoElement = true; this.graceUntil = 0;
    this.jawHist = []; this.jawSlots = []; this.talkEMA = 0; this.talkAt = 0; this.sideEMA = 0; this.sideAtLoss = false; this.closedEMA = 0; this.callAt = 0;
    this.closedSince = 0; this.yawnSince = 0; this.yawns = [];
    this.hits = [];
  }

  msg(text) { this.dispatchEvent(new CustomEvent("message", {detail: text})); }
  // Start-up outcomes for analytics: {kind: "camera" | "model", ...}. Never images or measurements.
  status(detail) { this.dispatchEvent(new CustomEvent("status", {detail})); }
  changed() { this.dispatchEvent(new Event("change")); }

  // Saved learning from a previous visit seeds the buffers so detection is warm right away.
  get saved() { return {v: 3, work: this.workBuf.slice(-120), phone: this.phoneBuf.slice(-30), taught: (this.taught || []).slice(-12)}; }
  restore(data) {
    if (!data || data.v !== 3) return;
    this.workBuf = (data.work || []).filter(w => Array.isArray(w?.f)).slice(-120);
    this.phoneBuf = (data.phone || []).filter(Array.isArray).slice(-30);
    this.taught = (data.taught || []).filter(Array.isArray).slice(-12);
    if (this.workBuf.length >= MIN_TO_JUDGE) this.model = buildModel(this.workBuf, this.phoneBuf);
  }
  forget() { this.workBuf = []; this.phoneBuf = []; this.taught = []; this.model = null; this.dispatchEvent(new Event("learned")); this.changed(); }

  start() {
    if (this.on && this.ready) return Promise.resolve();
    if (this._starting) return this._starting;
    this._cancel = false; this.failed = false;
    this._starting = this._start().finally(() => { this._starting = null; });
    return this._starting;
  }

  async _start() {
    if (!navigator.mediaDevices?.getUserMedia) { this.failed = true; this.status({kind: "camera", result: "error", reason: "unsupported"}); this.msg("This browser can't use a camera here. Make sure the page is on https."); return; }
    this.msg("Starting camera…");
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({video: {width: {ideal: 960}, height: {ideal: 540}, facingMode: "user"}, audio: false});
    } catch (err) {
      this.failed = true;
      this.status({kind: "camera", result: err?.name === "NotAllowedError" ? "denied" : "error", reason: String(err?.name || "")});
      this.msg(err?.name === "NotAllowedError"
        ? "Camera is blocked. Click the camera icon in your address bar, allow it, then turn the camera on again."
        : err?.name === "NotFoundError" ? "No camera was found on this device." : "Couldn't start the camera. Is another app using it?");
      this.changed();
      return;
    }
    if (this._cancel) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; return; }
    this.video.srcObject = this.stream;
    try { await this.video.play(); } catch {}
    this.on = true; this.changed();
    this.status({kind: "camera", result: "granted"});

    if (!this.face) {
      this.msg("Loading the on-device vision models (first time takes a few seconds)…");
      const t0 = performance.now();
      try {
        const {FilesetResolver, FaceLandmarker, ObjectDetector} = await import(`${MP}/vision_bundle.mjs`);
        const fileset = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
        this.face = await makeTask(FaceLandmarker, fileset, FACE_MODEL, {numFaces: 3, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
          minFaceDetectionConfidence: 0.3, minFacePresenceConfidence: 0.3, minTrackingConfidence: 0.3}, FilesetResolver);
        this.obj = await makeTask(ObjectDetector, fileset, OBJ_MODEL, {scoreThreshold: 0.3, maxResults: 5, categoryAllowlist: ["cell phone", "person"]}, FilesetResolver);
        this.status({kind: "model", ok: true, backend: cpuFallback ? "cpu" : "gpu", ms: Math.round(performance.now() - t0)});
      } catch (err) {
        console.error(err);
        this.status({kind: "model", ok: false, reason: String(err?.name || "error")});
        this.failed = true;
        this.stream?.getTracks().forEach(t => t.stop());
        this.stream = null; this.video.srcObject = null; this.on = false;
        this.msg("Couldn't load the vision models. Check your internet connection, then turn the camera on again.");
        this.changed();
        return;
      }
    }
    if (!this.on || this._cancel) return;
    this.ready = true;
    this.startTrackReader();
    this.msg("");
    this.dispatchEvent(new Event("ready"));
    this.changed();
  }

  // Reading frames straight from the camera track keeps detection running when the tab is hidden.
  startTrackReader() {
    const track = this.stream?.getVideoTracks()[0];
    if (!track || typeof window.MediaStreamTrackProcessor !== "function") { this.useVideoElement = true; return; }
    try {
      const reader = new window.MediaStreamTrackProcessor({track}).readable.getReader();
      this.reader = reader; this.useVideoElement = false;
      (async () => {
        while (this.reader === reader) {
          let frame;
          try { ({value: frame} = await reader.read()); } catch { break; }
          if (!frame) break;
          try { this.process(frame, frame.displayWidth, frame.displayHeight); }
          catch (err) { console.warn("Frame path failed, using video element instead", err); this.useVideoElement = true; frame.close(); reader.cancel().catch(() => {}); break; }
          frame.close();
        }
      })();
    } catch { this.useVideoElement = true; }
  }

  tick() {
    if (!this.ready || !this.useVideoElement || this.video.readyState < 2) return;
    const ct = this.video.currentTime;
    if (ct === this.lastVideoTime) return; // frozen frame: don't re-judge stale pixels
    this.lastVideoTime = ct;
    this.process(this.video, this.video.videoWidth, this.video.videoHeight);
  }

  process(source, w, h) {
    const t = performance.now();
    this.diag ||= {frames: 0, faces: 0, src: ""};
    if (this.busy || t - this.lastFace < FACE_EVERY_MS) return;
    this.busy = true; this.lastFace = t; this.lastFrameAt = Date.now();
    try {
      try { this.onFrame?.(source, w, h); } catch {}
      const r = this.face.detectForVideo(source, t);
      const face = r.faceLandmarks?.length ? {m: measure(r, mainFaceIndex(r)), count: r.faceLandmarks.length} : null;
      this.diag.frames++; if (face) this.diag.faces++; this.diag.src = this.useVideoElement ? "video" : "track"; this.diag.size = [w, h];
      let det;
      if (t - this.lastObj > OBJ_EVERY_MS) {
        this.lastObj = t;
        const o = this.obj.detectForVideo(source, t + 0.5);
        const is = (d, name, min) => d.categories[0]?.categoryName === name && (d.categories[0]?.score || 0) >= min;
        const hit = o.detections.find(d => is(d, "cell phone", 0.38));
        // A person filling a good part of the frame = you're in your seat, even if your face is turned away.
        const person = o.detections.some(d => is(d, "person", 0.4) && d.boundingBox.width * d.boundingBox.height > 0.08 * w * h);
        det = {phone: hit ? {box: hit.boundingBox, cy: (hit.boundingBox.originY + hit.boundingBox.height / 2) / (h || 1)} : null, person};
      }
      this.ingest(face, det);
      if (det !== undefined) this.draw(w, h);
    } finally {
      this.busy = false;
    }
  }

  // One analysed frame. face: {m, count} or null. det: undefined (no phone check this frame), null (no phone), or {box, cy}.
  ingest(face, det) {
    const now = Date.now();
    this.hits.push(face ? 1 : 0); if (this.hits.length > 50) this.hits.shift();
    this.jawSlots.push(face ? face.m.jaw : null); if (this.jawSlots.length > 20) this.jawSlots.shift();
    if (!face) {
      // A missed frame is the tracker's fault, not a pause in speech, so talking fades slowly. Turned far to the side
      // is exactly when the tracker loses you, so sideEMA isn't faded at all (sideAtLoss carries it).
      this.offEMA *= 0.9; this.talkEMA *= 0.97; this.yawnSince = 0;
      if (now - this.faceAt > 1500) this.closedSince = 0; // only forget closed eyes if the face is really gone
    }
    else {
      const m = face.m;
      this.faceAt = now;
      if (face.count > 1) this.othersAt = now;
      this.last = m; this.lastAt = now;
      this.recent.push(feat(m)); if (this.recent.length > 15) this.recent.shift();
      this.trackTalking(m);
      this.trackGaze(m);
      this.trackExpression(m);
      this.trackEyes(m);
      // Eyes shut on most recent sightings (a blink is one frame, so it barely moves this).
      this.closedEMA = (this.closedEMA || 0) * 0.7 + (m.blink > 0.55 ? 0.3 : 0);
      if (this.model) this.judge(m);
      this.learn(m);
    }
    if (det === undefined) return;
    if (det.person) this.personAt = now;
    det = det.phone;
    if (det) {
      this.phoneHits = (this.phoneHits || []).filter(t => now - t < 6000); this.phoneHits.push(now);
      this.phoneAt = now; this.phoneBox = det.box || null;
      // Up by your ear while you talk: a phone call. Not a scrolling posture, so it's never self-taught.
      if (det.cy < TUNE.callCy && (this.talkEMA > 0.3 || this.talkedWithin(TUNE.callHoldMs))) this.callAt = now;
      else if (det.cy < 0.75) {
        this.phoneHeldAt = now;
        // Self-teaching: the detector just saw a phone in your hand, so this is what "you on your phone" looks like.
        // Only trust it if the phone was seen twice in a few seconds and you're not in your normal work posture,
        // so one stray detection can't teach "your work posture is your phone posture".
        const repeated = this.phoneHits.filter(t => now - t < 5000).length >= 2;
        if (repeated && this.last && now - this.lastAt < 500 && !this.inWorkZone(this.last)) { this.phoneBuf.push(feat(this.last)); if (this.phoneBuf.length > 60) this.phoneBuf.shift(); }
      }
    } else this.phoneBox = null;
  }

  // Add one sample per second to the work zone, unless something suggests you aren't working right now.
  learn(m) {
    const now = Date.now();
    if (now - this.lastLearn < LEARN_EVERY_MS) return;
    this.lastLearn = now;
    // Samples wait 3 seconds before they count. If you turn out to be distracted in that time, they're thrown away,
    // so the start of a phone check or a glance away never gets learned as "work".
    const busyElsewhere = this.phoneSeenWithin(8000) || this.headDownEMA > 0.25 || this.offEMA > 0.3 || this.talkEMA > 0.5 || m.blink > 0.5;
    if (busyElsewhere) this.pending = [];
    else (this.pending ||= []).push({f: feat(m), ratio: m.ratio, t: now});
    while (this.pending?.length && now - this.pending[0].t >= 3000) {
      const {f, ratio} = this.pending.shift();
      this.workBuf.push({f, ratio});
      if (this.workBuf.length > WORK_BUF) this.workBuf.shift();
    }
    if (this.workBuf.length >= MIN_TO_JUDGE && (now - this.lastBuild > 5000 || !this.model)) {
      const first = !this.model;
      this.model = buildModel(this.workBuf, this.phoneBuf);
      this.lastBuild = now;
      if (first) this.changed();
      if (first || now % 30000 < 5000) this.dispatchEvent(new Event("learned"));
    }
  }

  inWorkZone(m) {
    const M = this.model; if (!M) return false;
    const s = this.getSensitivity(), f = feat(m), margin = [TUNE.marginPitch / s, TUNE.marginYaw / s, TUNE.marginEye / s];
    return f.every((v, k) => v >= M.min[k] - margin[k] && v <= M.max[k] + margin[k]);
  }

  // Compare this frame to the learned work zone and phone pose.
  judge(m) {
    const M = this.model, s = this.getSensitivity(), f = feat(m);
    const margin = [TUNE.marginPitch / s, TUNE.marginYaw / s, TUNE.marginEye / s];
    const inWork = f.every((v, k) => v >= M.min[k] - margin[k] && v <= M.max[k] + margin[k]);
    const nearestWork = Math.min(...M.work.map(x => dist(f, x)));
    let phonePose;
    if (M.phone) phonePose = !inWork && dist(f, M.phone) < nearestWork * TUNE.phoneNear;
    else if (M.downSign) phonePose = (f[0] - (M.downSign > 0 ? M.max[0] : M.min[0])) * M.downSign > TUNE.downDeg / s;
    else phonePose = (m.ratio - M.ratioMax) > TUNE.downRatio / s;
    // Postures you've marked "Not my phone" (writing, reading notes) are work, unless it's clearly your phone pose.
    // (Only while no phone has been seen for a minute, because writing and a phone in your lap can look alike.)
    if (phonePose && !this.phoneSeenWithin(60000) && (this.taught || []).some(t => dist(f, t) < 8 / s) && !(M.phone && dist(f, M.phone) < 4)) phonePose = false;
    const eyesDown = !inWork && f[2] > M.max[2] + TUNE.eyeDown / s;
    // A close match to your learned phone pose specifically (used even in paper mode, where looking down is allowed).
    const phoneMatch = !!M.phone && !inWork && dist(f, M.phone) < Math.min(TUNE.matchDeg / s, nearestWork * 0.6);
    this.phoneMatchEMA = (this.phoneMatchEMA || 0) * 0.8 + (phoneMatch ? 0.2 : 0);
    this.headDownEMA = this.headDownEMA * 0.8 + (phonePose ? 0.2 : 0);
    this.downEMA = this.downEMA * 0.8 + (phonePose || eyesDown ? 0.2 : 0);
    // Off-screen: pointing outside your work zone in a direction that isn't "down at a phone".
    this.offEMA = this.offEMA * 0.85 + (!inWork && !phonePose && !eyesDown ? 0.15 : 0);
    // Turned sideways past the work zone (a friend, a window, across the room). Unlike a still stare this counts even
    // with moving eyes: you're reading or watching something that isn't your work. A wide monitor or a second screen
    // you use a lot is inside the learned zone, so it never counts.
    const yawOut = Math.max(M.min[1] - margin[1] - f[1], f[1] - M.max[1] - margin[1]);
    this.sideEMA = this.sideEMA * 0.8 + (yawOut > TUNE.sideExtra / s && !phonePose ? 0.2 : 0);
    this.downAtLoss = this.headDownEMA > 0.5;
    this.sideAtLoss = this.sideEMA > 0.5;
  }

  // Eyes jumping around (reading, scanning a page) vs. a still, empty stare. Spread of gaze over ~3s.
  trackGaze(m) {
    this.gazeHist ||= [];
    this.gazeHist.push([m.gazeX || 0, (m.eyeUp || 0) - (m.eyeDown || 0)]);
    if (this.gazeHist.length > 15) this.gazeHist.shift();
    if (this.gazeHist.length < 8) { this.eyeMotion = 1; return; }
    const sd = k => { const v = this.gazeHist.map(g => g[k]), mu = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - mu) ** 2, 0) / v.length); };
    this.eyeMotion = sd(0) + sd(1);
  }

  // Funny-moment signals for clips: laughing (big smile + mouth moving), surprise (brows up + jaw open).
  trackExpression(m) {
    const now = Date.now();
    const laughing = m.smile > 0.55 && m.jaw > 0.25;
    this.laughEMA = (this.laughEMA || 0) * 0.8 + (laughing ? 0.2 : 0);
    if (this.laughEMA > 0.5 && now - (this.laughAt || 0) > 20000) this.laughAt = now;
    this.smileEMA = (this.smileEMA || 0) * 0.85 + (m.smile > 0.6 ? 0.15 : 0);
    if (this.smileEMA > 0.6 && now - (this.smileAt || 0) > 30000) this.smileAt = now;
    if (m.brow > 0.6 && m.jaw > 0.35 && now - (this.surpriseAt || 0) > 20000) this.surpriseAt = now;
  }

  trackTalking(m) {
    // Talking = the jaw keeps opening and closing (spread over ~3s). No microphone involved.
    const h = this.jawHist;
    h.push(m.jaw); if (h.length > 15) h.shift();
    if (h.length < 10) return;
    const n = h.length, mean = h.reduce((a, b) => a + b, 0) / n;
    const v = h.reduce((a, b) => a + (b - mean) ** 2, 0) / n, sd = Math.sqrt(v), max = Math.max(...h);
    // ...and the mouth must still be opening in the last second, so "talking" ends soon after you stop.
    const lately = Math.max(...h.slice(-5)) > TUNE.talkOpen;
    const talking = sd > TUNE.talkSd && max > TUNE.talkOpen && max < 0.7 && lately && this.jawRhythm() < TUNE.chewRhythm;
    this.talkEMA = this.talkEMA * 0.88 + (talking ? 0.12 : 0);
    if (this.talkEMA > 0.5) this.talkAt = Date.now();
  }

  // Chewing (food, gum) is a steady ~1-2 bites a second: the jaw signal repeats itself 3-6 frames later. Speech is
  // irregular at this frame rate, so a strong repeat means eating, not talking. Uses the frame-by-frame record
  // (missed frames as gaps) because the rhythm only shows with the real spacing between frames.
  jawRhythm() {
    const h = this.jawSlots, ok = h.filter(x => x != null);
    if (ok.length < 8) return 0;
    const mean = ok.reduce((a, b) => a + b, 0) / ok.length, v = ok.reduce((a, b) => a + (b - mean) ** 2, 0) / ok.length;
    if (v < 1e-4) return 0;
    let best = 0;
    for (let lag = 3; lag <= 6; lag++) {
      let c = 0, k = 0;
      for (let i = lag; i < h.length; i++) if (h[i] != null && h[i - lag] != null) { c += (h[i] - mean) * (h[i - lag] - mean); k++; }
      if (k >= 6) best = Math.max(best, c / (k * v));
    }
    return best;
  }

  trackEyes(m) {
    const now = Date.now();
    // Eyes closed: blink score stays high (a normal blink lasts well under half a second).
    if (m.blink > 0.55) this.closedSince ||= now; else this.closedSince = 0;
    // Yawn: jaw wide open for over a second.
    if (m.jaw > 0.55) {
      this.yawnSince ||= now;
      if (now - this.yawnSince > 1200 && !this.yawnCounted) { this.yawns.push(now); this.yawnCounted = true; }
    } else { this.yawnSince = 0; this.yawnCounted = false; }
    this.yawns = this.yawns.filter(t => now - t < 15 * 60000);
  }

  draw(w, h) {
    const c = this.overlay;
    if (!w || !h) return;
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    const g = c.getContext("2d");
    g.clearRect(0, 0, w, h);
    if (this.phoneBox) {
      const b = this.phoneBox;
      g.strokeStyle = "#ff5a5f"; g.lineWidth = Math.max(3, w / 160);
      g.strokeRect(b.originX, b.originY, b.width, b.height);
    }
  }

  // "Not my phone": remember this posture as an exception (writing, reading notes) without stretching the work zone.
  teachWork() {
    if (this.recent.length) {
      const mid = [0, 1, 2].map(k => pct(this.recent.map(f => f[k]), 0.5));
      (this.taught ||= []).push(mid); if (this.taught.length > 12) this.taught.shift();
    }
    this.downEMA = 0; this.headDownEMA = 0; this.offEMA = 0; this.sideEMA = 0; this.downAtLoss = false; this.sideAtLoss = false;
    this.dispatchEvent(new Event("learned"));
  }

  stop() {
    this._cancel = true;
    this.reader?.cancel().catch(() => {});
    this.reader = null;
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null; this.video.srcObject = null;
    this.on = false; this.ready = false; this.phoneBox = null;
    this.overlay.getContext("2d").clearRect(0, 0, this.overlay.width, this.overlay.height);
    this.msg(""); this.changed();
  }

  get learning() { return this.ready && !this.model; }
  get faceVisible() { return Date.now() - this.faceAt < 1500; }
  // Someone is in the seat: face seen recently, or a person seen by the object detector (checked ~every 1.2s).
  get lastSeenAt() { return Math.max(this.faceAt || 0, this.personAt || 0); }
  get present() { return this.faceVisible || Date.now() - (this.personAt || 0) < 3000; }
  get phoneVisible() { return Date.now() - this.phoneAt < 3000; }
  phoneSeenWithin(ms) { return Date.now() - this.phoneAt < ms; }
  get stalled() { return this.ready && Date.now() - this.lastFrameAt > 4000; }
  get inGrace() { return Date.now() < this.graceUntil; }
  get phoneCalibrated() { return !!this.model?.phone; }
  get quality() { return this.hits.length < 10 ? null : Math.round(this.hits.reduce((a, b) => a + b, 0) / this.hits.length * 100); }
  // Face found on few frames lately, last seen with eyes shut or head dropped, body still in the chair (no phone around:
  // that's the lap-phone case). Dropping the head with open eyes needs the face to be almost fully gone.
  // (Rates, not "face gone for Xs": a face on the desk still gets found now and then.)
  get headOnDesk() {
    // The person detector misses a slumped body now and then, so "still here" gets a few seconds of slack.
    if (this.hits.length < 50 || Date.now() - this.lastSeenAt > 6000 || this.phoneSeenWithin(20000)) return false;
    const rate = n => this.hits.slice(-n).reduce((a, b) => a + b, 0) / n;
    return (this.closedEMA > 0.5 && rate(25) < TUNE.deskHits) || (this.downAtLoss && rate(50) < TUNE.deskHits / 3);
  }
  // Last sightings had the eyes shut and the face has dropped out since (dozing off, not looking down at something).
  get eyesShutAtLoss() { return !this.faceVisible && this.closedEMA > 0.5; }
  get eyesClosedMs() { return this.closedSince && this.faceVisible ? Date.now() - this.closedSince : 0; }
  yawnsWithin(ms) { return this.yawns.filter(t => Date.now() - t < ms).length; }
  get offScreen() { return this.faceVisible && this.offEMA > 0.6; }
  // Head turned sideways past your work zone (see judge).
  get lookingSide() { return this.faceVisible && this.sideEMA > 0.5; }
  // Phone at your ear and still talking: a call (the detector often loses a phone pressed to the head, hence the hold).
  get onCall() { return !this.inGrace && Date.now() - this.callAt < TUNE.callHoldMs && this.talkedWithin(TUNE.callHoldMs); }
  // Moving eyes = reading or scanning something, so you aren't zoned out.
  get eyesActive() { return (this.eyeMotion ?? 1) > TUNE.eyeMove; }
  // A phone counts as "in use" when it's held up and seen at least twice in a few seconds, or seen once while
  // you're also looking down at it or your face is hidden behind it. A single stray detection is ignored.
  get phoneInUse() {
    if (!this.phoneVisible || this.inGrace) return false;
    const now = Date.now();
    const repeated = (this.phoneHits || []).filter(t => now - t < 5000).length >= 2;
    const held = now - this.phoneHeldAt < 3000;
    return (held && repeated) || this.downEMA > 0.45 || (!this.faceVisible && repeated);
  }
  get talking() { return this.faceVisible && this.talkEMA > 0.5; }
  get withOthers() { return Date.now() - this.othersAt < 8000; }
  talkedWithin(ms) { return Date.now() - this.talkAt < ms; }
  resetTalk() { this.jawHist = []; this.jawSlots = []; this.talkEMA = 0; this.talkAt = 0; }
  resetPhone(ms = 8000) {
    this.phoneAt = 0; this.phoneHeldAt = 0; this.phoneBox = null;
    this.downEMA = 0; this.headDownEMA = 0; this.offEMA = 0; this.downAtLoss = false; this.callAt = 0; this.graceUntil = Date.now() + ms;
  }
  recover() {
    if (!this.ready) return;
    this.reader?.cancel().catch(() => {});
    this.reader = null;
    this.video.play?.().catch(() => {});
    this.lastFrameAt = Date.now();
    const track = this.stream?.getVideoTracks()[0];
    if (!track || track.readyState === "ended") { this.msg("Camera disconnected. Turn it off and on again."); return; }
    this.startTrackReader();
  }
}
