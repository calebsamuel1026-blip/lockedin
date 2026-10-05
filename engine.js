// The decision engine: turns camera signals into one state per second.
// Pure logic (no DOM) so the website and the test simulator run exactly the same code.
//
// Every second each possible state gets an evidence score (1.0 = enough to call it). The strongest
// state wins. "Head down" is a soft state that wins at any score. Going back to Focused takes two
// steady seconds so the status doesn't flicker. live.reason explains the decision in the UI.

// Timing thresholds (seconds). Defaults were picked by tests/tune.mjs against simulated users.
export const TUNE = {calibratedDown: 6, zoneSec: 8, sleepySec: 4, awaySec: 12,
  sideSec: 7,     // turned sideways past the work zone this long = looking away (brief glances stay focused)
  talkHold: 12,   // a conversation keeps counting this long after you last spoke, while you're turned to them / they're here
  chatCushion: 10, // talk time can build this far past chatSec, so short pauses don't end "Chatting"
  turnChat: 1,    // talking while turned to someone becomes "chat" after sideSec * turnChat (facing the screen waits chatSec)
  deskSec: 5,     // seconds of vision.headOnDesk before it counts as sleeping on the desk
  perclos: 0.15}; // share of the last minute with eyes shut that marks someone as drowsy (NHTSA PERCLOS, 15%)

export const DISTRACTED = ["phone", "chat", "down", "sleepy", "zoned"];   // count against your focus score

// Per-second counters: how long you've been looking down, off-screen, sideways, asleep on the desk, talking.
export function updateCounters(live, vision, onBreak) {
  if (onBreak) { live.downSec = 0; live.offSec = 0; live.talkSec = 0; live.sideSec = 0; live.deskSec = 0; return; }
  const fresh = vision.faceVisible;
  const goneFor = fresh ? 0 : Date.now() - vision.faceAt;
  // Head tilted toward your phone pose counts; eyes-only glances count only right after a phone was seen.
  // If your face drops out of view while you're looking down (lap, floor, a camera above you), keep counting while
  // the body still shows a dropped head (vision.downWhileLost).
  const lookingDown = fresh
    ? vision.headDownEMA > 0.6 || (vision.downEMA > 0.6 && vision.phoneSeenWithin(20000))
    : vision.downWhileLost ?? (vision.downAtLoss && goneFor < 8000);
  // Asleep on the desk also looks like a dropped head; it's handled as sleepy, not as a phone check.
  const desk = vision.headOnDesk;
  live.deskSec = desk ? (live.deskSec || 0) + 1 : 0;
  live.downSec = lookingDown && !desk ? live.downSec + 1 : 0;
  // Zoning out = looking away AND eyes still. Eyes moving means you're reading something (notes, second screen).
  live.offSec = fresh && vision.offScreen && !vision.eyesActive ? live.offSec + 1 : 0;
  // Turned sideways counts even with moving eyes (reading or watching something that isn't your work). Turning that
  // far often loses the face, so keep counting a while if your body is still there.
  const side = fresh ? vision.lookingSide : vision.sideAtLoss && vision.present && goneFor < 15000;
  live.sideSec = side ? (live.sideSec || 0) + 1 : 0;
  live.matchSec = fresh && (vision.phoneMatchEMA || 0) > 0.6 ? (live.matchSec || 0) + 1 : 0;
  // Conversations have pauses, so talk time builds while you talk and drains when you stop. Capped so a long
  // conversation doesn't leave "Chatting" stuck on after it ends.
  //  - Spoke in the last few seconds and turned to someone, or they're in frame: listening is still the conversation.
  //  - Spoke recently, facing the screen, alone in frame: a pause, hold the count (can't tell yet if it's over).
  //  - But if you'd turned to them and are now back facing your work, it's over: no hold.
  //  - Talking is only recognised after ~3s of jaw movement, so a fresh conversation starts with that head start.
  const turned = side || vision.offScreen, recent = vision.talkedWithin?.(TUNE.talkHold * 1000);
  if (turned && live.talkSec > 0) live.turnedTalk = true;
  const listening = recent && (turned || (vision.withOthers && !live.turnedTalk));
  if (vision.talking || listening) live.talkSec = Math.min(Math.max(live.talkSec + 1, 3), live.chatCap || 30);
  else if (!(recent && !live.turnedTalk)) live.talkSec = Math.max(0, live.talkSec - 3);
  // Turned back to your work and quiet: the conversation is over, so "Chatting" ends now rather than draining.
  if (live.turnedTalk && !turned && !vision.talking) live.talkSec = Math.min(live.talkSec, Math.max(0, (live.chatCap || 30) - TUNE.chatCushion - 1));
  if (!live.talkSec) live.turnedTalk = false;
}

export function candidates(live, vision, settings, collab) {
  const now = Date.now(), c = [];
  const paper = settings.paperMode, grace = vision.inGrace;
  const goneFor = vision.faceVisible ? 0 : now - vision.faceAt;
  const downNeeded = vision.phoneCalibrated ? Math.min(settings.downSec, TUNE.calibratedDown) : settings.downSec;
  const groupTalk = collab && vision.withOthers;
  const eyesShut = vision.eyesClosedMs > 1500 || vision.eyesShutAtLoss;   // a drooping head with closed eyes is dozing, not phone use
  if (vision.phoneInUse) c.push(["phone", 2, "Phone in your hand"]);
  else if (vision.onCall && !grace) c.push(["phone", 2, "On a phone call"]);
  if (goneFor > 8000 && goneFor < 60000 && !paper && !grace && (vision.downWhileLost ?? vision.downAtLoss) && vision.phoneSeenWithin(20000)) c.push(["phone", 1.5, "Phone out of view"]);
  // Paper mode ignores looking down, but a close match to your own phone posture still counts (a bit slower).
  if (paper && !grace && !eyesShut && (live.matchSec || 0) >= downNeeded * 1.5) c.push(["phone", 1.2, "Looks like your phone posture"]);
  if (vision.model) {
    if (!paper && !grace && !eyesShut && live.downSec > 0) {
      c.push(live.downSec >= downNeeded ? ["phone", 1 + live.downSec / downNeeded / 10, `Head down for ${live.downSec}s`]
                                        : ["down", 0.5 + live.downSec / downNeeded / 2, `Head down for ${live.downSec}s`]);
    }
    // Turned away while talking is a conversation, not zoning out.
    const quiet = !groupTalk && live.talkSec === 0 && !vision.talking;
    if ((live.sideSec || 0) > 0 && quiet) c.push(["zoned", live.sideSec / TUNE.sideSec, `Looking away for ${live.sideSec}s`]);
    if (live.offSec > 0 && quiet) c.push(["zoned", live.offSec / TUNE.zoneSec, `Zoned out for ${live.offSec}s`]);
  }
  // Eyes shut for a while. Someone who keeps nodding off (PERCLOS over 15% of the last minute) is called sooner.
  const closed = vision.eyesClosedMs / 1000, drowsy = (vision.perclos || 0) > TUNE.perclos;
  if (closed > 0.8) c.push(["sleepy", closed / (TUNE.sleepySec * (drowsy ? 0.6 : 1)), `Eyes closed for ${Math.round(closed)}s`]);
  // Head down on the desk: the face is (almost) gone after eyes shut or the head dropped, but your body is still here.
  if (live.deskSec > 0) c.push(["sleepy", live.deskSec / TUNE.deskSec, "Head down on the desk"]);
  live.chatCap = settings.chatSec + TUNE.chatCushion;
  // Facing the screen, talking may be a call or thinking aloud, so it waits chatSec. Turned to someone and talking
  // is plainly a conversation, so it counts as soon as a sideways look would.
  const turnedTalk = (live.sideSec || 0) > 0 && live.talkSec > 0 ? live.sideSec / (TUNE.sideSec * TUNE.turnChat) : 0;
  if (settings.chatDetect && !collab && live.talkSec > 0) c.push(["chat", Math.max(live.talkSec / settings.chatSec, turnedTalk), vision.withOthers ? "Talking with someone" : "Talking"]);
  // Away only when neither your face nor your body has been seen (turning your head away isn't leaving).
  const absentFor = vision.present ? 0 : now - (vision.lastSeenAt ?? vision.faceAt);
  if (absentFor > 0) c.push(["away", absentFor / (TUNE.awaySec * 1000), "Nobody at your desk"]);
  return c;
}

export function classify(live, vision, settings, collab) {
  live.reason = "";
  if (!vision.ready || vision.stalled) { live.confidence = null; return "focused"; }
  const c = candidates(live, vision, settings, collab);
  let best = null;
  for (const x of c) if ((x[1] >= 1 || x[0] === "down") && (!best || x[1] > best[1])) best = x;
  // Live confidence that you're focused: the opposite of the strongest distraction signal.
  live.confidence = Math.round(100 * (1 - Math.min(1, Math.max(0, ...c.map(x => x[1])))));
  if (!best) {
    live.focusRun++;
    if (live.focusRun < 2 && DISTRACTED.includes(live.state) && live.state !== "down") { live.reason = "Coming back…"; return live.state; }
    return "focused";
  }
  live.focusRun = 0;
  live.reason = best[2];
  // Still looking down after a phone check: that's the same phone check, not a new "head down" moment.
  if (best[0] === "down" && live.state === "phone") { live.reason = "Still on your phone"; return "phone"; }
  return best[0];
}

// Move to the new state. Returns whether this counts as a new phone pickup.
export function advance(live, st, now) {
  // One pickup per phone check: a new one only counts after at least 45 seconds without the phone.
  const pickup = st === "phone" && live.state !== "phone" && now - (live.lastPhoneAt || 0) > 45000;
  if (st === "phone") live.lastPhoneAt = now;
  live.stateSec = st === live.state ? live.stateSec + 1 : 1;
  live.state = st;
  return pickup;
}

// Which full-screen alert (if any) to show this second.
export function alertFor(live, st, settings, now) {
  const s = live.stateSec;
  let kind = null;
  if (st === "phone" && s >= settings.phoneAlertSec && now - live.lastAlertAt > 30000) kind = "phone";
  else if (st === "chat" && s >= settings.chatAlertSec && now - live.lastAlertAt > 120000) kind = "chat";
  else if (st === "sleepy" && s >= 8 && now - live.lastAlertAt > 60000) kind = "sleepy";
  if (kind) live.lastAlertAt = now;
  return kind;
}
