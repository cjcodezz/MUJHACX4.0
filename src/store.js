// Local persistence. A single JSON file, written atomically and debounced —
// no dependency, survives a server restart, and is trivially inspectable at
// 3am, which matters more tonight than anything a real database would buy.

import fs from "fs";
import path from "path";

const DIR = path.resolve("data");
const FILE = path.join(DIR, "store.json");

let db = { conversations: {}, personas: {} };
let dirty = false;

try {
  fs.mkdirSync(DIR, { recursive: true });
  if (fs.existsSync(FILE)) db = JSON.parse(fs.readFileSync(FILE, "utf8"));
} catch (e) {
  console.warn("[store] could not read store.json, starting empty:", e.message);
}

function flush() {
  if (!dirty) return;
  dirty = false;
  try {
    // Write-then-rename so a crash mid-write cannot leave a truncated file.
    const tmp = FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, FILE);
  } catch (e) { console.warn("[store] write failed:", e.message); }
}
const save = () => { dirty = true; };
setInterval(flush, 1500).unref?.();
process.on("exit", flush);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { flush(); process.exit(0); });

/* ------------------------------- conversations ------------------------- */

export function listConversations(owner) {
  return Object.values(db.conversations)
    .filter((c) => c.owner === owner)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(({ id, title, updatedAt, turns, nodeCount }) => ({ id, title, updatedAt, turns, nodeCount }));
}

export const getConversation = (id) => db.conversations[id] || null;

export function createConversation(owner, { problem, personaId, title }) {
  const id = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  db.conversations[id] = {
    id, owner, problem, personaId,
    title: (title || "").trim() || "New conversation",
    messages: [], ledger: null,
    turns: 0, nodeCount: 0,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  save();
  return db.conversations[id];
}

export function saveConversation(id, patch) {
  const c = db.conversations[id];
  if (!c) return null;
  Object.assign(c, patch, { updatedAt: Date.now() });
  // Title from the student's first real utterance — it is what makes the
  // sidebar scannable instead of ten rows all saying "New conversation".
  if (c.title === "New conversation") {
    const first = c.messages.find((m) => m.role === "student");
    if (first) c.title = first.text.slice(0, 46) + (first.text.length > 46 ? "…" : "");
  }
  save();
  return c;
}

export function deleteConversation(id, owner) {
  const c = db.conversations[id];
  if (!c || c.owner !== owner) return false;
  delete db.conversations[id];
  save();
  return true;
}

/* ------------------------------ custom personas ------------------------ */

export const listPersonas = (owner) =>
  Object.values(db.personas).filter((p) => p.owner === owner);

export function createPersona(owner, { name, strategy, voice, blurb, grad, gender }) {
  const id = `u_${owner}_${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 20)}`;
  db.personas[id] = {
    id, owner, custom: true,
    name, strategy, voice, gender: gender || null,
    label: blurb ? "Custom" : "Custom",
    blurb: blurb || "",
    grad: grad || ["#6B8BFF", "#9B6BFF"],
    initial: name.trim()[0]?.toUpperCase() || "?",
    createdAt: Date.now(),
  };
  save();
  return db.personas[id];
}

export function deletePersona(id, owner) {
  const p = db.personas[id];
  if (!p || p.owner !== owner) return false;
  delete db.personas[id];
  save();
  return true;
}

export const getPersona = (id) => db.personas[id] || null;
