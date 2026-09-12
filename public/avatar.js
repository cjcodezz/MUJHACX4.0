// A missing element used to throw at module scope and stop every later
// statement — including boot — from running. Absorb it instead: warn once and
// hand back an inert stand-in so one renamed id cannot take the page down.
const MISSING = new Proxy({}, {
  get: (_, k) => (k === "classList" || k === "style" || k === "dataset") ? MISSING
    : k === "children" ? []
    : k === "value" || k === "textContent" || k === "innerHTML" ? ""
    : () => {},
  set: () => true,
});
const warned = new Set();
const $ = (s) => document.querySelector(s) || (
  warned.has(s) || (warned.add(s), console.warn(`[dom] ${s} not found`)), MISSING);

let SESSION = null;       // the active conversation id
let CONVO = null;         // the active conversation record
let ME = null;            // { username, avatarId } from localStorage
let PERSONAS = [];        // shipped roster + this user's own
let pIdx = 0, busy = false, lang = "hinglish", turns = 0;
// No default topic. A conversation is about whatever the student said it was
// about — pinning every session to a fractions question made the tutor drag
// unrelated questions back to pizza slices.
let PROBLEM = "";

/* ---------------------------------------------------------- avatar stage */
// Pluggable by design: drop public/avatars/<persona>.mp4 or .png and it is used
// instead of the generated presence. That is what makes "the avatar layer is an
// interface, we have a MetaHuman backend behind it" a true statement rather
// than a claim — the slot is real and the fallback is honest.
const canvas = $("#presence"), cx = canvas.getContext("2d");
let level = 0, targetLevel = 0, phase = 0, hasAsset = false;

function sizeCanvas() {
  const r = canvas.getBoundingClientRect();
  canvas.width = r.width * devicePixelRatio; canvas.height = r.height * devicePixelRatio;
}
addEventListener("resize", () => { sizeCanvas(); if (carItems.length) paintCarousel(); });

function presenceLoop() {
  requestAnimationFrame(presenceLoop);
  if (hasAsset) { cx.clearRect(0, 0, canvas.width, canvas.height); return; }
  const w = canvas.width, h = canvas.height, cxm = w / 2, cym = h / 2;
  level += (targetLevel - level) * 0.18;
  phase += 0.012;
  cx.clearRect(0, 0, w, h);
  const base = Math.min(w, h) * 0.19;
  for (let i = 6; i >= 0; i--) {
    const t = i / 6;
    const r = base * (1 + t * 1.5) + level * base * 0.95 * (1 - t * 0.45)
            + Math.sin(phase * 2 + i * 0.7) * base * 0.035;
    cx.beginPath(); cx.arc(cxm, cym, r, 0, Math.PI * 2);
    cx.strokeStyle = `rgba(107,139,255,${(0.30 - t * 0.036) * (0.45 + level * 0.9)})`;
    cx.lineWidth = (1 - t * 0.55) * 3.2 * devicePixelRatio;
    cx.stroke();
  }
  const g = cx.createRadialGradient(cxm, cym, 0, cxm, cym, base * (1.5 + level));
  g.addColorStop(0, `rgba(107,139,255,${0.2 + level * 0.3})`);
  g.addColorStop(1, "rgba(107,139,255,0)");
  cx.fillStyle = g; cx.fillRect(0, 0, w, h);
}

// A teacher can ship two loops: an idle take and a speaking take. Both are
// mounted at once and kept playing; switching is a cross-fade of opacity, never
// a src swap — reloading a 7 MB file mid-sentence would stutter every answer.
let speakLoop = null;

async function has(url) {
  const r = await fetch(url, { method: "HEAD" }).catch(() => null);
  return !!r?.ok;
}

async function loadAvatarAsset(p) {
  $("#frame").querySelectorAll("img,video.av").forEach((n) => n.remove());
  hasAsset = false; speakLoop = null;
  $("#initial").style.display = "";

  const mount = (tag, src, cls) => {
    const el = document.createElement(tag);
    el.src = src;
    el.className = "av " + cls;
    if (tag === "video") { el.loop = el.muted = el.autoplay = el.playsInline = true; }
    $("#frame").prepend(el);
    return el;
  };

  // Idle first: it is what the student looks at most of the time.
  for (const ext of ["mp4", "webm", "jpg", "png", "webp"]) {
    const url = `avatars/${p.id}.${ext}`;
    if (!(await has(url))) continue;
    mount(ext === "mp4" || ext === "webm" ? "video" : "img", url, "idle on");
    hasAsset = true;
    $("#initial").style.display = "none";
    break;
  }
  if (!hasAsset) return;

  for (const ext of ["mp4", "webm"]) {
    const url = `avatars/${p.id}-speaking.${ext}`;
    if (!(await has(url))) continue;
    speakLoop = mount("video", url, "speak");
    speakLoop.play().catch(() => {});     // keep it warm so the cut is instant
    break;
  }
}

// Called the moment audio starts and the moment it ends.
function setSpeaking(on) {
  const idle = $("#frame").querySelector(".av.idle");
  if (!speakLoop || !idle) return;
  speakLoop.classList.toggle("on", on);
  idle.classList.toggle("on", !on);
  if (on) speakLoop.play().catch(() => {});
}

/* -------------------------------------------------------------- personas */
async function paintPersona() {
  const p = PERSONAS[pIdx]; if (!p) return;
  $("#initial").textContent = p.initial;
  $("#pName").textContent = p.name;
  $("#pRole").textContent = p.style || p.label;
  await loadAvatarAsset(p);
}
const moveP = (d) => { pIdx = (pIdx + d + PERSONAS.length) % PERSONAS.length; paintPersona(); };
function selectPersona(id) {
  const i = PERSONAS.findIndex((p) => p.id === id);
  if (i >= 0 && i !== pIdx) { pIdx = i; paintPersona(); return true; }
  return false;
}

/* ------------------------------------------------------------ rendering */
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

function renderSaid(text, diag) {
  if (!diag) return esc(text);
  const L = new Array(text.length).fill(null), E = new Array(text.length).fill(false);
  const low = text.toLowerCase();
  let cursor = 0;
  for (const sp of diag.code_mix?.spans || []) {
    const n = (sp.text || "").toLowerCase().trim(); if (!n) continue;
    let i = low.indexOf(n, cursor); if (i < 0) i = low.indexOf(n); if (i < 0) continue;
    const cls = sp.lang === "en" ? "sp-en" : sp.lang === "other" ? null : "sp-l1";
    if (cls) for (let k = i; k < i + n.length; k++) L[k] = cls;
    cursor = i + n.length;
  }
  if (diag.evidence_span && diag.node_id !== "NONE") {
    const n = diag.evidence_span.toLowerCase().trim();
    const i = low.indexOf(n);
    if (i >= 0) for (let k = i; k < i + n.length; k++) E[k] = true;
  }
  let out = "", oL = null, oE = false;
  const closeSpan = () => { if (oL) { out += "</span>"; oL = null; } };
  for (let i = 0; i < text.length; i++) {
    if (E[i] !== oE) { closeSpan(); out += E[i] ? '<mark class="ev">' : "</mark>"; oE = E[i]; }
    if (L[i] !== oL) { closeSpan(); if (L[i]) { out += `<span class="${L[i]}">`; oL = L[i]; } }
    out += esc(text[i]);
  }
  closeSpan(); if (oE) out += "</mark>";
  return out;
}

function bubble(kind, html, who) {
  const el = document.createElement("div");
  el.className = `bub ${kind}`;
  el.innerHTML = (who ? `<div class="who">${who}</div>` : "") + html;
  $("#chat").appendChild(el); $("#chat").scrollTop = $("#chat").scrollHeight;
  return el;
}

/* ------------------------------------------------------------------ turn */
async function submit(text) {
  if (busy || !text.trim()) return;
  if (!SESSION) { askNewConvo({ required: true }); return; }
  busy = true;
  const who = PERSONAS[pIdx]?.name || "Your teacher";
  bubble("me", esc(text), "you");
  const status = bubble("sys", `<span class="spin"></span>${esc(who)} is thinking…`);

  try {
    const r = await (await fetch("/api/ask", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: SESSION, utterance: text,
        personaId: PERSONAS[pIdx]?.id, lang, mood,
      }),
    })).json();
    if (r.error) throw new Error(r.error);

    status.innerHTML = `<span class="spin"></span>${esc(who)} is answering…`;
    $("#turns").textContent = `${++turns} turns`;
    status.remove();
    bubble("her", esc(r.say), who);
    say(r.say, r.persona.voice);
    refreshConvos();
  } catch (e) {
    status.remove();
    bubble("sys", `<span style="color:var(--hot)">${esc(e.message)}</span>`);
  } finally { busy = false; }
}

/* -------------------------------------------------- speech out + reactive */
// Play FIRST, visualise second. The previous version routed the element through
// an AudioContext before calling play(), so whenever the context started
// suspended — which is the default until a gesture — no sound came out at all.
// Audio must never depend on the animation working.
async function say(text, speaker) {
  let audio;
  try {
    const r = await (await fetch("/api/tts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, speaker, lang: lang === "english" ? "en-IN" : "hi-IN" }),
    })).json();
    if (r.error) throw new Error(r.error);
    audio = r.audio;
  } catch (e) {
    console.warn("[tts]", e.message);
    bubble("sys", `<span style="color:var(--hot)">Voice unavailable — ${esc(e.message)}</span>`);
    return;
  }
  if (!audio) return;

  const el = new Audio("data:audio/wav;base64," + audio);
  el.preload = "auto";
  $("#liveTag").textContent = "speaking"; $("#liveTag").classList.add("on");
  setSpeaking(true);

  // done() must be idempotent and must fire on every exit route. If it does not
  // run, the speaking loop stays on screen forever with nobody talking.
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    targetLevel = 0;
    setSpeaking(false);
    $("#liveTag").textContent = "idle"; $("#liveTag").classList.remove("on");
  };
  el.onended = done;
  el.onerror = done;
  el.onpause = done;

  try {
    await el.play();
  } catch (e) {
    // Autoplay blocked: surface it rather than failing silently, because the
    // fix is one click by the user and nothing in the UI would otherwise say so.
    console.warn("[tts] playback blocked:", e.message);
    bubble("sys", "Tap anywhere once to let the browser play audio, then ask again.");
    done();
    return;
  }

  // Belt and braces: if no event ever arrives, revert on the clip's own length.
  // A stuck speaking loop is far more visible than a late revert.
  const guard = setTimeout(done, ((el.duration || 12) + 2) * 1000);
  el.addEventListener("ended", () => clearTimeout(guard), { once: true });

  // Drive the presence rings off the real waveform. Entirely optional — and it
  // must never be able to stop playback.
  try {
    const ac = new AudioContext();
    if (ac.state === "suspended") await ac.resume();
    const src = ac.createMediaElementSource(el);
    const an = ac.createAnalyser(); an.fftSize = 256;
    src.connect(an); an.connect(ac.destination);
    const buf = new Uint8Array(an.frequencyBinCount);
    let started = false;
    (function tick() {
      // `paused` is still true for a frame or two after play() resolves. Closing
      // the context on that first frame tore down the graph the audio was
      // routed through — silent playback, and no `ended` event ever fired.
      if (!started && !el.paused) started = true;
      if (started && (el.paused || el.ended)) { ac.close().catch(() => {}); return; }
      requestAnimationFrame(tick);
      an.getByteTimeDomainData(buf);
      let sum = 0; for (const v of buf) sum += (v - 128) ** 2;
      targetLevel = Math.min(1, Math.sqrt(sum / buf.length) / 32);
    })();
  } catch (e) { console.warn("[tts] visualiser off:", e.message); }
}

/* ==========================================================================
   Camera and mood.
   Expressions are read locally with face-api (tiny detector + expression net,
   both served from /models) — no frame ever leaves the browser. The seven raw
   classes are collapsed into plain emotion words, because "engaged" is jargon
   and "happy" is not.
   ========================================================================== */
let camOn = false, micOn = false, camStream = null, faceReady = false;
let mood = { label: "unknown", confidence: 0 };

const MOOD_COPY = {
  happy: "is happy", sad: "is sad", confused: "is confused",
  nervous: "is nervous", frustrated: "is frustrated", steady: "is steady",
};

// Raw scores are smoothed with an exponential moving average rather than a ring
// buffer of labels: EMA reacts on the very next frame while still killing
// single-frame flicker, and costs one multiply instead of a rescan.
const EMA = 0.55;                 // weight on the newest frame — high = snappy
const SWITCH_MARGIN = 1.12;       // a challenger must beat the incumbent by this
let smooth = null;

// Anger and disgust fold together because the difference does not change how a
// tutor should respond; neutral is discounted so a blank face does not outrank
// a real expression that is only weakly present.
function scoreStates(x) {
  return {
    happy:      x.happy,
    sad:        x.sad,
    frustrated: x.angry + x.disgusted,
    confused:   x.surprised,
    nervous:    x.fearful,
    steady:     x.neutral * 0.85,
  };
}

function readMood(raw) {
  const s = scoreStates(raw);
  if (!smooth) smooth = { ...s };
  else for (const k in s) smooth[k] = smooth[k] * (1 - EMA) + s[k] * EMA;

  const ranked = Object.entries(smooth).sort((a, b) => b[1] - a[1]);
  const [topLabel, topScore] = ranked[0];

  // Hysteresis: hold the current label unless the leader clearly beats it, so a
  // near-tie between neutral and happy does not strobe the badge.
  if (mood.label !== "unknown" && topLabel !== mood.label) {
    const incumbent = smooth[mood.label] ?? 0;
    if (topScore < incumbent * SWITCH_MARGIN) return { label: mood.label, confidence: incumbent };
  }
  return { label: topLabel, confidence: Math.min(1, topScore) };
}

function paintMood() {
  const el = $("#mood");
  if (!camOn || mood.label === "unknown") { el.hidden = true; return; }
  el.hidden = false;
  el.className = `mood ${mood.label}`;
  const who = ME?.username ? ME.username[0].toUpperCase() + ME.username.slice(1) : "You";
  el.querySelector("span").textContent = `${who} ${MOOD_COPY[mood.label] || ""}`;
}

async function ensureFaceModels() {
  if (faceReady) return true;
  try {
    await faceapi.nets.tinyFaceDetector.loadFromUri("models");
    await faceapi.nets.faceExpressionNet.loadFromUri("models");
    faceReady = true;
  } catch (e) {
    console.warn("[face] models failed to load:", e.message);
    bubble("sys", "Expression reading is unavailable — your teacher will go on words alone.");
  }
  return faceReady;
}

// A continuous loop, not a timer. Each pass awaits the previous detection, so it
// runs as fast as the machine allows and never queues work behind itself.
async function moodLoop() {
  if (!camOn) return;
  const v = $("#cam");
  if (faceReady && v.videoWidth) {
    try {
      const det = await faceapi
        .detectSingleFace(v, new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.35 }))
        .withFaceExpressions();
      if (det) {
        const next = readMood(det.expressions);
        if (next.label !== mood.label || Math.abs(next.confidence - mood.confidence) > 0.05) {
          mood = next;
          paintMood();
        }
      }
    } catch { /* a dropped frame is not worth reporting */ }
  }
  requestAnimationFrame(moodLoop);
}

async function toggleCam() {
  if (camOn) {
    camStream?.getVideoTracks().forEach((t) => t.stop());
    camOn = false; smooth = null; mood = { label: "unknown", confidence: 0 };
    $("#cam").srcObject = null;
    document.querySelector(".cam").classList.remove("live");
    $("#camBtn").classList.remove("on");
    paintMood();
    return;
  }
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, facingMode: "user" } });
  } catch {
    bubble("sys", `<span style="color:var(--hot)">Camera blocked. Allow it in the address bar, or keep typing.</span>`);
    return;
  }
  $("#cam").srcObject = camStream;
  camOn = true;
  document.querySelector(".cam").classList.add("live");
  $("#camBtn").classList.add("on");
  if (await ensureFaceModels()) moodLoop();
}

/* ------------------------------------------------------------------- mic */
// A toggle, not a hold. Once on, it listens continuously and submits on its own
// when you stop talking, then goes straight back to listening — so a student can
// think out loud without operating a button. Endpointing is energy-based: cheap,
// no extra model, and good enough because we only need to find the gap AFTER
// someone has clearly started speaking.
let audioCtx, node, stream, chunks = [], capturing = false;
let speechSeen = false, quietFor = 0;
const SILENCE = 0.012;      // RMS below this counts as quiet
const HANG_MS = 1100;       // quiet this long after speech ends the utterance
const MAX_MS = 20000;       // hard ceiling so one long ramble still gets sent

function encodeWav(s, rate) {
  const b = new ArrayBuffer(44 + s.length * 2), v = new DataView(b);
  const str = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + s.length * 2, true); str(8, "WAVEfmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, s.length * 2, true);
  s.forEach((x, i) => { const c = Math.max(-1, Math.min(1, x)); v.setInt16(44 + i * 2, c < 0 ? c * 0x8000 : c * 0x7fff, true); });
  return new Blob([b], { type: "audio/wav" });
}

async function toggleMic() {
  if (micOn) { micOn = false; $("#micBtn").classList.remove("on", "rec"); await stopCapture(false); return; }
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, noiseSuppression: true, echoCancellation: true } }); }
  catch {
    bubble("sys", `<span style="color:var(--hot)">Microphone blocked. Allow it in the address bar, or keep typing.</span>`);
    return;
  }
  micOn = true;
  $("#micBtn").classList.add("on");
  startCapture();
}

function startCapture() {
  if (!micOn || capturing) return;
  audioCtx = new AudioContext();
  const src = audioCtx.createMediaStreamSource(stream);
  const an = audioCtx.createAnalyser(); an.fftSize = 512; src.connect(an);
  node = audioCtx.createScriptProcessor(4096, 1, 1);
  chunks = []; capturing = true; speechSeen = false; quietFor = 0;
  const started = Date.now();
  node.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  src.connect(node); node.connect(audioCtx.destination);
  $("#liveTag").textContent = "listening"; $("#liveTag").classList.add("on");

  const buf = new Uint8Array(an.frequencyBinCount);
  let last = performance.now();
  (function watch(now = performance.now()) {
    if (!capturing) return;
    requestAnimationFrame(watch);
    const dt = now - last; last = now;
    an.getByteTimeDomainData(buf);
    let sum = 0; for (const v of buf) sum += (v - 128) ** 2;
    const rms = Math.sqrt(sum / buf.length) / 128;
    targetLevel = Math.min(1, rms * 7);

    if (rms > SILENCE * 1.8) { speechSeen = true; quietFor = 0; $("#micBtn").classList.add("rec"); }
    else if (speechSeen) quietFor += dt;

    if ((speechSeen && quietFor > HANG_MS) || Date.now() - started > MAX_MS) stopCapture(true);
  })();
}

async function stopCapture(submitIt) {
  if (!capturing) return;
  capturing = false;
  $("#micBtn").classList.remove("rec");
  targetLevel = 0;
  $("#liveTag").textContent = "idle"; $("#liveTag").classList.remove("on");
  try { node.disconnect(); } catch {}
  const rate = audioCtx.sampleRate;
  try { await audioCtx.close(); } catch {}

  const heard = speechSeen;
  const flat = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0; chunks.forEach((c) => { flat.set(c, o); o += c.length; });

  if (!micOn) { stream?.getTracks().forEach((t) => t.stop()); stream = null; return; }
  if (!submitIt || !heard || flat.length < rate * 0.4) { startCapture(); return; }

  const b64 = await new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result.split(",")[1]); f.readAsDataURL(encodeWav(flat, rate)); });
  const p = bubble("sys", `<span class="spin"></span>transcribing`);
  try {
    const t = await (await fetch("/api/stt", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio: b64 }),
    })).json();
    p.remove();
    // Empty transcript means the mic picked up noise, not speech. In a
    // continuously listening loop that is normal — go quiet and keep waiting
    // rather than stacking red errors down the rail.
    if (!t.error && !t.text) { startCapture(); return; }
    if (t.error) throw new Error(t.error);
    await submit(t.text);
  } catch (e) { p.remove(); bubble("sys", `<span style="color:var(--hot)">${esc(e.message)}</span>`); }
  startCapture();   // straight back to listening
}

/* ------------------------------------------------------------------ wire */
$("#camBtn").onclick = toggleCam;
$("#micBtn").onclick = toggleMic;
$("#send").onclick = () => { const v = $("#say").value; $("#say").value = ""; submit(v); };
// Block body, NOT `(e) => e.key === "Enter" && send()`. An arrow with an
// implicit body returns false for every other key, and returning false from an
// on* handler cancels the event — which silently blocks all typing.
$("#say").onkeydown = (e) => {
  if (e.key === "Enter") $("#send").click();
};
$("#fs").onclick = () => $("#frame").requestFullscreen?.().catch(() => {});
$("#langSeg").onclick = (e) => {
  if (!e.target.dataset.l) return;
  lang = e.target.dataset.l;
  [...$("#langSeg").children].forEach((b) => b.classList.toggle("on", b === e.target));
};
addEventListener("keydown", (e) => {
  if ($("#pickVeil").classList.contains("on")) {
    if (e.key === "ArrowLeft") slideTo(carIdx - 1, -1);
    if (e.key === "ArrowRight") slideTo(carIdx + 1, 1);
    return;
  }
  if (document.activeElement === $("#say")) return;
  if (e.key === "ArrowRight") moveP(1);
  if (e.key === "ArrowLeft") moveP(-1);
});


/* ==========================================================================
   Local accounts + avatar choice.
   Demo-grade auth: everything lives in this browser's localStorage. Passwords
   are salted and SHA-256 hashed rather than stored in the clear — cheap to do
   and there is no excuse not to — but this is a hackathon store, not real auth.
   ========================================================================== */
const DB = {
  read: () => { try { return JSON.parse(localStorage.getItem("ml.users") || "{}"); } catch { return {}; } },
  write: (u) => localStorage.setItem("ml.users", JSON.stringify(u)),
};

async function hash(password, salt) {
  const bytes = new TextEncoder().encode(salt + ":" + password);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const newSalt = () => [...crypto.getRandomValues(new Uint8Array(16))]
  .map((b) => b.toString(16).padStart(2, "0")).join("");

let authMode = "login";
const authErr = (m) => ($("#authErr").textContent = m || "");

async function doAuth(e) {
  e.preventDefault();
  const username = $("#u").value.trim().toLowerCase();
  const password = $("#p").value;
  if (username.length < 2) return authErr("Username needs at least 2 characters.");
  if (password.length < 4) return authErr("Password needs at least 4 characters.");

  const users = DB.read();
  if (authMode === "register") {
    if (users[username]) return authErr("That username is taken. Try logging in.");
    const salt = newSalt();
    users[username] = { username, salt, hash: await hash(password, salt), avatarId: null, createdAt: Date.now() };
    DB.write(users);
  } else {
    const rec = users[username];
    if (!rec) return authErr("No account with that name. Register instead?");
    if (await hash(password, rec.salt) !== rec.hash) return authErr("Wrong password.");
  }
  authErr("");
  $("#p").value = "";
  await enter(DB.read()[username]);
}

async function enter(rec) {
  ME = rec;
  SESSION = rec.username;
  localStorage.setItem("ml.session", rec.username);
  $("#authVeil").classList.remove("on");
  $("#whoName").textContent = rec.username;
  $("#whoChip").hidden = false;
  $("#logout").hidden = false;
  paintWhoAvatar();
  if (!rec.avatarId) openPicker();
  else { $("#pickVeil").classList.remove("on"); await boot(); }
}

function paintWhoAvatar() {
  const el = $("#whoAv");
  const p = PERSONAS.find((x) => x.id === ME?.avatarId);
  if (!p) { el.innerHTML = "?"; return; }
  if (p.custom) { el.innerHTML = p.initial; el.style.background = `linear-gradient(140deg,${p.grad[0]},${p.grad[1]})`; return; }
  el.dataset.fallback = p.initial;
  el.style.background = `linear-gradient(140deg,${p.grad[0]},${p.grad[1]})`;
  el.innerHTML = `<img src="avatars/${p.id}.jpg" alt="" data-alt="avatars/${p.id}.webp">`;
  wirePortraitFallbacks(el.parentNode);
  el.style.background = p ? `linear-gradient(140deg,${p.grad[0]},${p.grad[1]})` : "var(--raise)";
}

/* ------------------------------- picker -------------------------------- */
// A carousel, not a grid: one teacher at a time, arrows slide the track, and
// the final slide is "create your own". The whole strip moves with a single
// transform so the motion is one continuous slide rather than a swap.
let pickChoice = null, carIdx = 0, carItems = [];
const MAKER = { id: "__make__", maker: true, name: "Create your own", label: "Your teacher, your method",
  blurb: "Name them, pick how they teach, give them a voice and a face." };

// Portraits are served from /avatars. A missing file falls back to the gradient
// initial rather than a broken-image icon.
function slideFace(p) {
  if (p.maker) return `<div class="ph">＋</div>`;
  const grad = `linear-gradient(140deg,${p.grad[0]},${p.grad[1]})`;
  if (p.custom) return `<div class="ph" style="background:${grad}">${p.initial}</div>`;
  return `<div class="ph" data-fallback="${p.initial}" style="background:${grad}">` +
         `<img src="avatars/${p.id}.jpg" alt="" data-alt="avatars/${p.id}.webp"></div>`;
}

// One delegated error handler beats an inline onerror per tile.
function wirePortraitFallbacks(root) {
  root.querySelectorAll(".ph img").forEach((img) => {
    img.onerror = () => {
      const alt = img.dataset.alt;
      if (alt && img.src.indexOf(alt) === -1) { img.dataset.alt = ""; img.src = alt; return; }
      const box = img.parentNode;
      img.remove();
      if (box) box.textContent = box.dataset.fallback || "";
    };
  });
}

// One card, animated in from the side the arrow points from. The previous
// implementation slid a full-width track; percentage and measured transforms
// both drifted because the track overflows its viewport, so the visible card
// never lined up with the selected index. Rendering a single slide removes the
// width maths entirely — what you see is always carItems[carIdx].
function paintCarousel(dir = 0) {
  const p = carItems[carIdx];
  const cls = dir > 0 ? "in-right" : dir < 0 ? "in-left" : "";
  $("#track").innerHTML = `
    <div class="slide ${p.maker ? "maker " : ""}${cls}">
      ${slideFace(p)}
      <h3>${esc(p.name)}</h3>
      <div class="st">${p.custom ? "yours · " : ""}${esc(p.label)}</div>
      ${p.role ? `<div class="role">${esc(p.role)}</div>` : ""}
      <div class="bl">${esc(p.blurb || "")}</div>
    </div>`;
  wirePortraitFallbacks($("#track"));
  [...$("#dots").children].forEach((el, i) => el.classList.toggle("on", i === carIdx));
  pickChoice = p.maker ? null : p.id;
  $("#pickGo").textContent = p.maker ? "Create a teacher" : `Start with ${p.name}`;
}

function slideTo(i, dir = 0) {
  carIdx = (i + carItems.length) % carItems.length;
  paintCarousel(dir);
}

async function openPicker() {
  await loadPersonas();
  carItems = [...PERSONAS, MAKER];
  const start = Math.max(0, carItems.findIndex((p) => p.id === ME?.avatarId));
  $("#dots").innerHTML = carItems.map(() => "<i></i>").join("");
  [...$("#dots").children].forEach((d, i) => (d.onclick = () => slideTo(i, i > carIdx ? 1 : -1)));
  // Show it FIRST: the slide is measured to position the track, and a slide
  // inside a display:none overlay measures 0, which pins the carousel to the
  // first card no matter which teacher is actually selected.
  $("#pickVeil").classList.add("on");
  slideTo(start);
}

$("#carPrev").onclick = () => slideTo(carIdx - 1, -1);
$("#carNext").onclick = () => slideTo(carIdx + 1, 1);

$("#pickGo").onclick = async () => {
  if (carItems[carIdx]?.maker) { $("#pickVeil").classList.remove("on"); return openMaker(); }
  const users = DB.read();
  users[ME.username].avatarId = pickChoice;
  DB.write(users);
  ME = users[ME.username];
  paintWhoAvatar();
  $("#pickVeil").classList.remove("on");
  pIdx = Math.max(0, PERSONAS.findIndex((p) => p.id === pickChoice));
  if (SESSION) await paintPersona(); else await boot();
};

$("#authForm").onsubmit = doAuth;
$("#authTabs").onclick = (e) => {
  if (!e.target.dataset.m) return;
  authMode = e.target.dataset.m;
  [...$("#authTabs").children].forEach((b) => b.classList.toggle("on", b === e.target));
  $("#authGo").textContent = authMode === "register" ? "Create account" : "Log in";
  authErr("");
};
$("#logout").onclick = () => { localStorage.removeItem("ml.session"); location.reload(); };


/* ==========================================================================
   Conversations — the left rail. Everything here is server-persisted, so a
   reload (or a server restart) returns you to the same ledger and history.
   ========================================================================== */
async function loadPersonas() {
  PERSONAS = await (await fetch(`/api/personas?owner=${encodeURIComponent(ME.username)}`)).json();
}

async function refreshConvos() {
  const list = await (await fetch(`/api/conversations?owner=${encodeURIComponent(ME.username)}`)).json();
  const box = $("#convos");
  if (!list.length) { box.innerHTML = `<div class="empty" style="margin:6px 2px">No conversations yet.</div>`; return; }
  box.innerHTML = list.map((c) => `
    <button class="convo ${c.id === SESSION ? "on" : ""}" data-id="${c.id}">
      <b>${esc(c.title)}</b>
      <span>${new Date(c.updatedAt).toLocaleDateString()}</span>
      <span class="del" data-del="${c.id}" title="Delete">×</span>
    </button>`).join("");
  [...box.children].forEach((el) => {
    el.onclick = (e) => {
      if (e.target.dataset.del) { e.stopPropagation(); removeConvo(e.target.dataset.del); return; }
      openConvo(el.dataset.id);
    };
  });
}

async function removeConvo(id) {
  await fetch(`/api/conversations/${id}?owner=${encodeURIComponent(ME.username)}`, { method: "DELETE" });
  if (id === SESSION) { SESSION = null; await boot(); } else await refreshConvos();
}

// A conversation is only saved once it has a name, so the name is collected
// before the first word rather than after. When there is nothing to fall back
// to, Cancel is hidden — leaving the student on an empty stage with no way to
// start would be worse than making the field compulsory.
function askNewConvo({ required = false } = {}) {
  $("#cName").value = "";
  $("#cProb").value = "";
  $("#nameCancel").hidden = required;
  $("#nameVeil").classList.add("on");
  $("#cName").focus();
}

function setComposerEnabled(on) {
  // Guard: if a conversation is open, the composer is never disabled. A stale
  // disable left over from the empty state is invisible — the placeholder still
  // reads normally — and looks exactly like the page being broken.
  const enabled = on || !!SESSION;
  $("#say").disabled = !enabled;
  $("#send").disabled = !enabled;
  $("#say").placeholder = enabled ? "Ask anything, or explain your thinking…" : "Name a conversation to start";
}

async function newConvo({ title, problem } = {}) {
  PROBLEM = (problem || "").trim();
  CONVO = await (await fetch("/api/conversations", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner: ME.username, problem: PROBLEM, personaId: ME.avatarId, title }),
  })).json();
  $("#probTitle").textContent = PROBLEM.split("?")[0] + "?";
  SESSION = CONVO.id;
  $("#probTitle").textContent = CONVO.title;
  $("#chat").innerHTML = "";
  turns = 0; $("#turns").textContent = "0 turns";
  pIdx = Math.max(0, PERSONAS.findIndex((p) => p.id === ME.avatarId));
  await paintPersona();
  await refreshConvos();
  setComposerEnabled(true);
}

// Replay a stored conversation into the rail. Student lines lose their span
// colouring on replay — the diagnosis that produced it is not stored per
// message — so the ledger card remains the record of what was found.
async function openConvo(id) {
  CONVO = await (await fetch(`/api/conversations/${id}`)).json();
  SESSION = id;
  $("#chat").innerHTML = "";
  for (const m of CONVO.messages || []) {
    if (m.role === "student") bubble("me", esc(m.text), "you");
    else bubble("her", esc(m.text), "teacher");
  }
  PROBLEM = CONVO.problem || "";
  $("#probTitle").textContent = CONVO.title;
  turns = CONVO.turns || 0;
  $("#turns").textContent = `${turns} turns`;
  if (CONVO.personaId) { const i = PERSONAS.findIndex((p) => p.id === CONVO.personaId); if (i >= 0) pIdx = i; }
  await paintPersona();
  await refreshConvos();
  setComposerEnabled(true);   // every route into a conversation ends typeable
}

/* -------------------------- build your own teacher --------------------- */
let VOICES = { f: [], m: [] };

function paintVoices() {
  const g = $("#mGender").value;
  $("#mVoice").innerHTML = (VOICES[g] || []).map((v) => `<option value="${v}">${v}</option>`).join("");
}

async function openMaker() {
  const [strats, voices] = await Promise.all([
    (await fetch("/api/strategies")).json(),
    (await fetch("/api/voices")).json(),
  ]);
  VOICES = voices;
  $("#mStrat").innerHTML = strats.map((s) => `<option value="${s.id}">${s.label}</option>`).join("");
  paintVoices();
  $("#makeErr").textContent = "";
  $("#makeVeil").classList.add("on");
  $("#mName").focus();
}

$("#makeForm").onsubmit = async (e) => {
  e.preventDefault();
  const name = $("#mName").value.trim();
  if (!name) return ($("#makeErr").textContent = "Give them a name.");
  const p = await (await fetch("/api/personas", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      owner: ME.username, name, strategy: $("#mStrat").value, voice: $("#mVoice").value, gender: $("#mGender").value,
      blurb: $("#mBlurb").value.trim(),
    }),
  })).json();
  if (p.error) return ($("#makeErr").textContent = p.error);
  $("#makeForm").reset();
  $("#makeVeil").classList.remove("on");
  await loadPersonas();
  openPicker();
};
$("#mGender").onchange = paintVoices;
$("#makeCancel").onclick = () => $("#makeVeil").classList.remove("on");
$("#makePersona").onclick = openMaker;
$("#sideToggle").onclick = () => {
  const c = $("#stage").classList.toggle("collapsed");
  $("#sideToggle").title = $("#sideToggle").ariaLabel = c ? "Show conversations" : "Hide conversations";
};
/* --------------------------- what is coming next ----------------------- */
// Deliberately previews, not stubs pretending to work. Each one states what the
// feature will do so it can be shown and discussed without being half-built.
const SOON = {
  call: {
    tint: ["rgba(45,212,167,.2)", "rgba(45,212,167,.16)", "rgba(45,212,167,.34)", "#2DD4A7"],
    icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.4 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
    title: (p) => `Call ${p.name}`,
    sub: (p) => `A live voice call with ${p.name} — no typing, no turns, just talk.`,
    cta: { label: (p) => `Call ${p.name}`, cls: "green", icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.4 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>' },
    points: [
      "Hold a real conversation, interruptions and all.",
      "They hear you think out loud, not read a finished sentence.",
      "Works on a plain phone browser — no app, no laptop.",
    ],
  },
  upload: {
    tint: ["rgba(107,139,255,.2)", "rgba(107,139,255,.16)", "rgba(107,139,255,.32)", "#6B8BFF"],
    icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>',
    title: () => "Upload your notes",
    sub: () => "Drop in a chapter, a worksheet, or a photo of the board — and ask about that.",
    zone: true,
    points: [
      "PDFs, images and typed notes, indexed so your teacher can quote them back.",
      "Answers come from YOUR chapter, in your syllabus's wording.",
      "Ask \u201cexplain question 4\u201d and it knows which question 4 you mean.",
    ],
  },
  test: {
    tint: ["rgba(155,107,255,.2)", "rgba(155,107,255,.16)", "rgba(155,107,255,.34)", "#9B6BFF"],
    icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3 7-7"/><path d="M21 12v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/></svg>',
    title: (p) => `Take a test with ${p.name}`,
    sub: () => "They ask, you answer, and anything you miss gets taught on the spot.",
    cta: { label: () => "Start the test", cls: "", icon: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3l14 9-14 9V3z"/></svg>' },
    points: [
      "Questions pitched at what you have actually covered here.",
      "Answer out loud or by typing — whichever you would do in a viva.",
      "Get one wrong and the teacher stops and teaches it before moving on.",
    ],
  },
};

function openSoon(key) {
  const s = SOON[key]; if (!s) return;
  const p = PERSONAS[pIdx] || { name: "your teacher", id: "allie" };
  const sheet = $("#soonSheet");
  const [a1, b1, c1, d1] = s.tint;
  sheet.style.setProperty("--tintA", a1);
  sheet.style.setProperty("--tintB", b1);
  sheet.style.setProperty("--tintC", c1);
  sheet.style.setProperty("--tintD", d1);

  // A teacher's own face carries more than a generic glyph, so the sheets that
  // are about a person show the person.
  $("#soonIco").style.display = "grid";
  $("#soonIco").innerHTML = s.icon || "";

  $("#soonTitle").textContent = s.title(p);
  $("#soonSub").textContent = s.sub(p);
  $("#soonList").innerHTML = s.points.map((t) => `<li>${esc(t)}</li>`).join("");

  const act = $("#soonAction");
  if (s.zone) {
    act.innerHTML = `
      <label class="as-zone" id="dropZone">
        <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
        <b>Choose a file, or drop one here</b>
        <span>PDF, image or text — up to 20 MB</span>
        <input type="file" id="dropInput" accept=".pdf,.txt,.md,image/*">
      </label>`;
    const zone = $("#dropZone");
    ["dragenter", "dragover"].forEach((e) => zone.addEventListener(e, (ev) => { ev.preventDefault(); zone.classList.add("drag"); }));
    ["dragleave", "drop"].forEach((e) => zone.addEventListener(e, (ev) => { ev.preventDefault(); zone.classList.remove("drag"); }));
    zone.addEventListener("drop", (ev) => noteFile(ev.dataTransfer?.files?.[0]));
    $("#dropInput").onchange = (ev) => noteFile(ev.target.files?.[0]);
  } else if (s.cta) {
    act.innerHTML = `<button class="as-cta ${s.cta.cls}" id="soonCta">${s.cta.icon}${esc(s.cta.label(p))}</button>`;
    $("#soonCta").onclick = () => {
      $("#soonVeil").classList.remove("on");
      if (key === "test") {
        // Same page, fresh conversation — the test simply starts as a new one.
        askNewConvo();
        $("#cName").value = `Test with ${p.name}`;
        $("#cProb").value = `Test me on what we have covered so far.`;
      } else {
        bubble("sys", `Voice calling with ${esc(p.name)} is coming next — for now, turn the mic on and talk.`);
      }
    };
  } else act.innerHTML = "";

  $("#soonVeil").classList.add("on");
}

function noteFile(f) {
  if (!f) return;
  $("#dropZone").querySelector("b").textContent = f.name;
  $("#dropZone").querySelector("span").textContent =
    `${(f.size / 1024 / 1024).toFixed(1)} MB — indexing is coming next`;
}

/* ------------------------------ video search --------------------------- */
async function runYtSearch(q) {
  const box = $("#ytResults");
  box.innerHTML = `<div class="ytempty"><span class="spin"></span>searching…</div>`;
  try {
    const { items, error } = await (await fetch(`/api/youtube?q=${encodeURIComponent(q)}`)).json();
    if (error) throw new Error(error);
    if (!items?.length) { box.innerHTML = `<div class="ytempty">Nothing found. Try different words.</div>`; return; }
    box.innerHTML = items.map((v) => `
      <button class="vid" data-id="${v.id}" data-title="${esc(v.title)}">
        <span class="th"><img src="${v.thumb}" alt="" loading="lazy">${v.length ? `<span class="len">${esc(v.length)}</span>` : ""}</span>
        <span class="meta"><b>${esc(v.title)}</b><span>${esc(v.channel || "")}</span></span>
      </button>`).join("");
    [...box.children].forEach((el) => (el.onclick = () => playVideo(el.dataset.id, el.dataset.title)));
  } catch (e) {
    box.innerHTML = `<div class="ytempty" style="color:var(--hot)">${esc(e.message)}</div>`;
  }
}

// The player docks over the teacher, and shrinking it is the point: the student
// keeps the video running and asks about it in the same breath.
function playVideo(id, title) {
  $("#ytVeil").classList.remove("on");
  $("#pFrame").src = `https://www.youtube.com/embed/${id}?autoplay=1&rel=0`;
  $("#player").classList.add("on");
  $("#player").classList.remove("mini");
  if (title) bubble("sys", `Playing <b>${esc(title)}</b> — shrink it and ask about any part.`);
}

$("#ytForm").onsubmit = (e) => {
  e.preventDefault();                       // without this the form navigates away
  const q = $("#ytQ").value.trim();
  if (q) runYtSearch(q);
};
$("#ytClose").onclick = () => $("#ytVeil").classList.remove("on");
$("#ytVeil").onclick = (e) => { if (e.target === $("#ytVeil")) $("#ytVeil").classList.remove("on"); };
$("#pMini").onclick = () => $("#player").classList.toggle("mini");
$("#pClose").onclick = () => {
  $("#player").classList.remove("on", "mini");
  $("#pFrame").src = "";
};

document.querySelectorAll(".act").forEach((b) => (b.onclick = () => {
  if (b.dataset.act === "youtube") {
    $("#ytVeil").classList.add("on");
    $("#ytQ").value = CONVO?.problem || CONVO?.title || "";
    $("#ytQ").focus();
    if ($("#ytQ").value) runYtSearch($("#ytQ").value);
    return;
  }
  openSoon(b.dataset.act);
}));
$("#soonClose").onclick = () => $("#soonVeil").classList.remove("on");
$("#soonVeil").onclick = (e) => { if (e.target === $("#soonVeil")) $("#soonVeil").classList.remove("on"); };
$("#soonVeil").onclick = (e) => { if (e.target === $("#soonVeil")) $("#soonVeil").classList.remove("on"); };

$("#changeAvatar").onclick = openPicker;
$("#newChat").onclick = askNewConvo;
$("#nameCancel").onclick = () => $("#nameVeil").classList.remove("on");
$("#nameForm").onsubmit = async (e) => {
  e.preventDefault();
  const title = $("#cName").value.trim();
  if (!title) return;
  $("#nameVeil").classList.remove("on");
  await newConvo({ title, problem: $("#cProb").value });
  setComposerEnabled(true);
};

// Vendor status is deliberately not surfaced in this UI — the health endpoint is where
// the team checks it. A failure still has to be visible to the student though,
// so it arrives as a message in the rail rather than a dashboard light.
let degraded = false;
async function health() {
  try {
    const h = await (await fetch("/api/health")).json();
    const bad = h.sarvam !== "live" || h.llm !== "live";
    if (bad && !degraded) bubble("sys", `<span style="color:var(--hot)">Connection trouble — answers may not come through.</span>`);
    degraded = bad;
  } catch { /* the turn itself will surface the failure */ }
}

// A teacher id saved before the roster changed points at nobody. Re-point it at
// a real teacher rather than rendering "?" forever.
function reconcileTeacher() {
  if (!ME || !PERSONAS.length) return;
  if (PERSONAS.some((p) => p.id === ME.avatarId)) return;
  const users = DB.read();
  const fallback = PERSONAS[0].id;
  if (users[ME.username]) { users[ME.username].avatarId = fallback; DB.write(users); ME = users[ME.username]; }
  else ME.avatarId = fallback;
  pIdx = 0;
}

async function boot() {
  sizeCanvas();
  await loadPersonas();
  reconcileTeacher();
  paintWhoAvatar();   // the roster was empty when enter() first painted it
  const list = await (await fetch(`/api/conversations?owner=${encodeURIComponent(ME.username)}`)).json();
  if (list.length) { await openConvo(list[0].id); setComposerEnabled(true); }
  else {
    $("#probTitle").textContent = "No conversation yet";
    setComposerEnabled(false);
    await paintPersona();
    askNewConvo({ required: true });
  }
}

(async () => {
  presenceLoop();
  health(); setInterval(health, 30000);

  const last = localStorage.getItem("ml.session");
  const rec = last && DB.read()[last];
  if (rec) await enter(rec);
  else { $("#authVeil").classList.add("on"); $("#u").focus(); }
})();
