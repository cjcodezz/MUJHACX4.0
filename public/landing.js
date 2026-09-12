const $ = (s) => document.querySelector(s);

/* ---------------------------------------------------------- ambient field */
// A slow drifting constellation behind the page. Canvas rather than a stack of
// animated divs so it stays one cheap paint, and it respects reduced-motion.
const cv = $("#field"), ctx = cv.getContext("2d");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
let pts = [];

function seed() {
  cv.width = innerWidth * devicePixelRatio;
  cv.height = innerHeight * devicePixelRatio;
  const count = Math.min(70, Math.round(innerWidth / 22));
  pts = Array.from({ length: count }, () => ({
    x: Math.random() * cv.width,
    y: Math.random() * cv.height,
    vx: (Math.random() - .5) * .22 * devicePixelRatio,
    vy: (Math.random() - .5) * .22 * devicePixelRatio,
    r: (Math.random() * 1.5 + .6) * devicePixelRatio,
  }));
}
seed();
addEventListener("resize", seed);

function field() {
  ctx.clearRect(0, 0, cv.width, cv.height);
  const LINK = 150 * devicePixelRatio;
  for (const p of pts) {
    p.x += p.vx; p.y += p.vy;
    if (p.x < 0 || p.x > cv.width) p.vx *= -1;
    if (p.y < 0 || p.y > cv.height) p.vy *= -1;
  }
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
      const d = Math.hypot(dx, dy);
      if (d > LINK) continue;
      ctx.strokeStyle = `rgba(107,139,255,${(1 - d / LINK) * .16})`;
      ctx.lineWidth = devicePixelRatio * .6;
      ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke();
    }
  }
  for (const p of pts) {
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(155,107,255,.42)"; ctx.fill();
  }
  if (!reduced) requestAnimationFrame(field);
}
field();

/* -------------------------------------------------------------- reveal in */
if (!reduced) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.style.transition = "opacity .6s ease, transform .6s cubic-bezier(.16,1,.3,1)";
      e.target.style.opacity = 1;
      e.target.style.transform = "none";
      io.unobserve(e.target);
    }
  }, { threshold: .15 });
  document.querySelectorAll(".card, .sec-h, .closer").forEach((el, i) => {
    el.style.opacity = 0;
    el.style.transform = "translateY(18px)";
    el.style.transitionDelay = `${(i % 4) * 70}ms`;
    io.observe(el);
  });
}

/* ------------------------------------------------------- the live roster */
// Rendered from the server rather than hardcoded, so adding or renaming a
// teacher in src/tutor.js never leaves this page showing a roster that no
// longer exists. The markup in the HTML is the fallback if the fetch fails.
// Irregular on purpose: left/top as percentages of the header box, each with its
// own size, drift distance and phase so nothing beats in time with anything else.
// Percentages run past 0 and 100 on purpose: the header box is capped at 1080px
// and centred, so the gutters either side of it are where these can sit without
// ever landing on the headline.
const SPOTS = [
  { left: "-9%",  top: "27%", size: 126, rise: "-18px", tilt: "-3deg",  dur: "9.5s",  delay: "0s"    },
  { left: "-1%",  top: "78%", size: 100, rise: "-13px", tilt: "2.5deg", dur: "11s",   delay: "-2.6s" },
  { left: "106%", top: "17%", size: 114, rise: "-15px", tilt: "3deg",   dur: "10.2s", delay: "-4.1s" },
  { left: "100%", top: "68%", size: 130, rise: "-20px", tilt: "-2deg",  dur: "8.8s",  delay: "-1.3s" },
  { left: "50%",  top: "99%", size: 94,  rise: "-11px", tilt: "2deg",   dur: "12s",   delay: "-6.2s" },
];

(async () => {
  try {
    const roster = await (await fetch("/api/personas")).json();
    const shown = (Array.isArray(roster) ? roster : []).filter((p) => !p.custom).slice(0, SPOTS.length);
    if (!shown.length) return;
    $("#strip").innerHTML = shown.map((p, i) => {
      const s = SPOTS[i];
      return `<div class="tcard" style="left:${s.left};top:${s.top};--size:${s.size}px;--rise:${s.rise};--tilt:${s.tilt};--dur:${s.dur};--delay:${s.delay};transform:translate(-50%,-50%)">
        <div class="face" style="background:linear-gradient(140deg,${p.grad[0]},${p.grad[1]})">
          <img src="avatars/${p.id}.jpg" alt="" data-alt="avatars/${p.id}.webp">
        </div>
        <b>${p.name}</b><span>${p.style || p.label}</span>
      </div>`;
    }).join("");
    $("#strip").querySelectorAll("img").forEach((img) => {
      img.onerror = () => {
        const alt = img.dataset.alt;
        if (alt && img.src.indexOf(alt) === -1) { img.dataset.alt = ""; img.src = alt; return; }
        img.remove();
      };
    });
  } catch { /* the hero reads fine without them */ }
})();

/* -------------------------------------------------------------- accounts */
// Same local store the app reads, so signing in here lands you straight in.
const DB = {
  read: () => { try { return JSON.parse(localStorage.getItem("ml.users") || "{}"); } catch { return {}; } },
  write: (u) => localStorage.setItem("ml.users", JSON.stringify(u)),
};
async function hash(password, salt) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + ":" + password));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const newSalt = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");

let mode = "login";
const showAuth = () => { $("#authVeil").classList.add("on"); $("#u").focus(); };

$("#heroStart").onclick = showAuth;
$("#footStart").onclick = showAuth;
$("#navStart").onclick = showAuth;
$("#authClose").onclick = () => $("#authVeil").classList.remove("on");
$("#authVeil").onclick = (e) => { if (e.target === $("#authVeil")) $("#authVeil").classList.remove("on"); };
addEventListener("keydown", (e) => { if (e.key === "Escape") $("#authVeil").classList.remove("on"); });

$("#authTabs").onclick = (e) => {
  if (!e.target.dataset.m) return;
  mode = e.target.dataset.m;
  [...$("#authTabs").children].forEach((b) => b.classList.toggle("on", b === e.target));
  $("#authGo").textContent = mode === "register" ? "Create account" : "Log in";
  $("#authTitle").textContent = mode === "register" ? "Make an account" : "Welcome back";
  $("#authErr").textContent = "";
};

$("#authForm").onsubmit = async (e) => {
  e.preventDefault();
  const username = $("#u").value.trim().toLowerCase();
  const password = $("#p").value;
  const err = (m) => ($("#authErr").textContent = m);
  if (username.length < 2) return err("Username needs at least 2 characters.");
  if (password.length < 4) return err("Password needs at least 4 characters.");

  const users = DB.read();
  if (mode === "register") {
    if (users[username]) return err("That username is taken. Try logging in.");
    const salt = newSalt();
    users[username] = { username, salt, hash: await hash(password, salt), avatarId: null, createdAt: Date.now() };
    DB.write(users);
  } else {
    const rec = users[username];
    if (!rec) return err("No account with that name. Register instead?");
    if (await hash(password, rec.salt) !== rec.hash) return err("Wrong password.");
  }
  localStorage.setItem("ml.session", username);
  location.href = "avatar.html";
};

// Already signed in? Say so rather than making them log in twice.
const last = localStorage.getItem("ml.session");
if (last && DB.read()[last]) {
  $("#navStart").textContent = "Open AI Tutor";
  $("#navStart").onclick = () => (location.href = "avatar.html");
  for (const id of ["#heroStart", "#footStart"]) {
    $(id).textContent = "Continue learning";
    $(id).onclick = () => (location.href = "avatar.html");
  }
}
