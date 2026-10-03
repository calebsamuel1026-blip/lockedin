// "Lock-out moments": short clips of you getting distracted, shown when the session ends.
// Opt-in. Frames live only in memory and vanish when the tab closes unless you share or save a clip.
const FPS = 5, BEFORE = 3, AFTER = 3, MAX_CLIPS = 6, W = 360;
const CAPTIONS = {
  phone: ["📵 caught lacking", "📵 the phone won this round", "📵 just one quick scroll…"],
  sleepy: ["😴 dozed off mid-study", "😴 power nap unlocked"],
  zoned: ["🫠 brain left the chat", "🫠 buffering…"],
  yawn: ["🥱 big yawn energy", "🥱 study session hits different"],
  chat: ["💬 yapping instead of studying", "💬 the group chat in real life"],
  laugh: ["😂 lost it mid-study", "😂 what was SO funny", "😂 study session got unserious"],
  smile: ["😎 main character moment", "😁 grinning at the textbook"],
  surprise: ["😱 plot twist", "😱 reading the syllabus like", "😱 saw the due date"],
};
const pick = a => a[Math.floor(Math.random() * a.length)];

let enabled = false, ring = [], pending = null, lastAt = 0;
export const clips = [];
const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");

export function setEnabled(on) { enabled = !!on; if (!on) { ring = []; pending = null; } }
export function reset() { ring = []; pending = null; clips.length = 0; lastAt = 0; }

// Called by the vision loop for each analysed frame (~5 per second). Keeps a short rolling buffer.
export async function capture(source, w, h) {
  if (!enabled || !w || !h) return;
  const now = performance.now();
  if (now - lastAt < 1000 / FPS - 20) return;
  lastAt = now;
  canvas.width = W; canvas.height = Math.round(W * h / w);
  ctx.save(); ctx.translate(canvas.width, 0); ctx.scale(-1, 1); // selfie view
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height); ctx.restore();
  const bmp = await createImageBitmap(canvas);
  ring.push(bmp); if (ring.length > FPS * BEFORE) ring.shift().close?.();
  if (pending) { pending.frames.push(await createImageBitmap(canvas)); if (pending.frames.length >= FPS * (BEFORE + AFTER)) finish(); }
}

// Something funny happened: keep the last few seconds and record a few more.
// How funny each kind of moment is. Only the top-scoring clips are kept.
const FUNNY = {laugh: 10, surprise: 8, sleepy: 8, yawn: 7, smile: 5, chat: 4, phone: 3, zoned: 2};
export function moment(kind, sessionSec) {
  if (!enabled || pending) return;
  const score = (FUNNY[kind] || 1) + Math.random(); // tiny tiebreak so the reel varies
  if (clips.length >= MAX_CLIPS && score <= Math.min(...clips.map(c => c.score))) return; // not funnier than what we have
  if (clips.filter(c => c.kind === kind).length >= 2 && kind !== "laugh") return;          // variety
  pending = {kind, score, at: Date.now(), sessionSec, caption: pick(CAPTIONS[kind] || ["🔒 lockedout"]), frames: ring.map(b => b)};
  ring = [];
}
function finish() {
  const c = pending; pending = null;
  if (clips.length >= MAX_CLIPS) {
    const worst = clips.reduce((a, b, i) => (b.score < clips[a].score ? i : a), 0);
    clips.splice(worst, 1)[0].frames.forEach(f => f.close?.());
  }
  clips.push(c);
  clips.sort((a, b) => b.score - a.score); // funniest first
}

// Draw one frame of a clip with its caption and watermark.
function drawFrame(g, clip, i, cw, ch) {
  const f = clip.frames[Math.min(i, clip.frames.length - 1)];
  g.drawImage(f, 0, 0, cw, ch);
  g.fillStyle = "rgba(0,0,0,.45)"; g.fillRect(0, ch - 56, cw, 56);
  g.fillStyle = "#fff"; g.font = "800 22px 'Plus Jakarta Sans', system-ui, sans-serif"; g.textAlign = "center";
  g.fillText(clip.caption, cw / 2, ch - 20);
  g.textAlign = "left"; g.font = "800 16px 'Plus Jakarta Sans', system-ui, sans-serif"; g.fillStyle = "#c6ff3d";
  g.fillText("lockedin", 12, 26);
}

// Loop a clip on a canvas (preview). Returns a stop function.
export function play(clip, target) {
  const g = target.getContext("2d");
  target.width = clip.frames[0]?.width || W; target.height = clip.frames[0]?.height || 270;
  let i = 0;
  const id = setInterval(() => { drawFrame(g, clip, i, target.width, target.height); i = (i + 1) % clip.frames.length; }, 1000 / FPS);
  return () => clearInterval(id);
}

// Render a shareable video (MP4 where supported, otherwise WebM).
export async function toVideo(clip) {
  const c = document.createElement("canvas");
  c.width = clip.frames[0].width; c.height = clip.frames[0].height;
  const g = c.getContext("2d");
  const type = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"].find(t => window.MediaRecorder?.isTypeSupported?.(t));
  if (!type) throw new Error("This browser can't make videos.");
  const stream = c.captureStream(FPS);
  const rec = new MediaRecorder(stream, {mimeType: type, videoBitsPerSecond: 1_500_000});
  const chunks = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const done = new Promise(r => (rec.onstop = r));
  rec.start();
  for (let loop = 0; loop < 2; loop++) for (let i = 0; i < clip.frames.length; i++) { drawFrame(g, clip, i, c.width, c.height); await new Promise(r => setTimeout(r, 1000 / FPS)); }
  rec.stop(); await done;
  const base = type.split(";")[0];
  return new File([new Blob(chunks, {type: base})], `lockedin-lockout.${base.endsWith("mp4") ? "mp4" : "webm"}`, {type: base});
}
