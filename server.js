import "dotenv/config";
import express from "express";
import { diagnose } from "./src/diagnose.js";
import { tutorTurn, PERSONAS, personaForStrategy } from "./src/tutor.js";
import { generateItem } from "./src/items.js";
import { answer } from "./src/answer.js";
import { searchVideos } from "./src/youtube.js";
import { speak, transcribe } from "./src/speech.js";
import {
  getSession, updateBelief, recordStrategy, snapshot, decay,
  activeNode, failedStrategies, resetSession,
} from "./src/ledger.js";
import { STRATEGIES } from "./src/catalog.js";
import * as store from "./src/store.js";
import { SPEAKERS, VOICES, voiceGender } from "./src/speech.js";
import { PROVIDER } from "./src/llm.js";

function hydrate(c) {
  const s = getSession(c.id);
  if (s.turns || !c.messages?.length) return s;   // already live
  s.turns = c.turns || 0;
  s.transcript = c.messages.map((m) => ({ role: m.role, text: m.text, at: m.at }));
  s.persona = c.personaId;
  for (const n of c.ledger?.nodes || []) {
    const node = { ...n, evidence: n.evidence || [], history: n.history || [], strategies_tried: n.strategies_tried || [] };
    s.nodes.set(n.id, node);
  }
  return s;
}

function persist(sessionId, snap) {
  if (!store.getConversation(sessionId)) return;
  const s = getSession(sessionId);
  store.saveConversation(sessionId, {
    messages: s.transcript,
    ledger: snap,
    turns: s.turns,
    nodeCount: snap.nodes.length,
    personaId: s.persona,
  });
}

const app = express();
app.use(express.json({ limit: "25mb" }));
app.use(express.static("public"));

// --- speech ---------------------------------------------------------------
app.post("/api/stt", async (req, res) => {
  try { res.json(await transcribe(Buffer.from(req.body.audio, "base64"))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/tts", async (req, res) => {
  try { res.json({ audio: await speak(req.body.text, { speaker: req.body.speaker }) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// --- phase 1: diagnose ----------------------------------------------------
// Returns as soon as the ledger has moved. The UI renders the diagnosis
// immediately and only then asks for the teacher's reply — so the judge
// watches the misconception get named BEFORE anyone starts teaching.
app.post("/api/turn", async (req, res) => {
  const { sessionId = "demo", utterance, problem, preferred } = req.body;
  const session = getSession(sessionId);
  session.turns += 1;
  session.transcript.push({ role: "student", text: utterance, at: Date.now() });
  decay(session);

  try {
    const prior = [...session.nodes.values()].filter((n) => n.status !== "resolved");
    const prev = activeNode(session);
    const t0 = Date.now();
    const d = await diagnose(utterance, {
      problem,
      priorNodes: prior,
      failed: prev ? failedStrategies(session, prev.id) : [],
    });
    d.ms = Date.now() - t0;

    if (d.node_id !== "NONE") {
      updateBelief(session, d.node_id, "utterance_hit", {
        name: d.name,
        evidence: { text: d.evidence_span, reading: d.evidence_reading },
      });
    }

    // A persona change is a pedagogical event, not decoration — surface it so
    // the UI can say WHY the teacher changed.
    const custom = preferred && store.getPersona(preferred);
    const persona = custom && custom.strategy === d.recommended_strategy
      ? custom
      : personaForStrategy(d.recommended_strategy, preferred);
    const switched = session.persona && session.persona !== persona.id;
    const from = session.persona ? PERSONAS[session.persona] : null;
    session.persona = persona.id;

    res.json({
      diagnosis: d,
      ledger: snapshot(session),
      strategy: STRATEGIES[d.recommended_strategy],
      persona,
      personaSwitch: switched
        ? { from: from?.name, to: persona.name, because: d.why_this_strategy }
        : null,
    });
    persist(sessionId, snapshot(session));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- phase 2: teach -------------------------------------------------------
app.post("/api/reply", async (req, res) => {
  const { sessionId = "demo", utterance, diagnosis, strategy, problem, preferred, mood } = req.body;
  const session = getSession(sessionId);
  try {
    const custom = preferred && store.getPersona(preferred);
    const persona = custom && custom.strategy === strategy
      ? custom
      : personaForStrategy(strategy, preferred);
    const reply = await tutorTurn({
      utterance, diagnosis, strategy, persona, problem, mood, history: session.transcript,
    });
    session.transcript.push({ role: "tutor", text: reply.say, at: Date.now() });
    if (diagnosis?.node_id && diagnosis.node_id !== "NONE") {
      recordStrategy(session, diagnosis.node_id, strategy, "attempted");
    }
    res.json({ reply, persona });
    persist(sessionId, snapshot(session));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- the probe ------------------------------------------------------------
app.post("/api/item", async (req, res) => {
  const { sessionId = "demo", nodeId } = req.body;
  const session = getSession(sessionId);
  try {
    const node = session.nodes.get(nodeId);
    const item = await generateItem(nodeId, {
      name: node?.name,
      avoid: (session.itemsAsked || []).map((i) => i.question),
    });
    session.itemsAsked = [...(session.itemsAsked || []), item];
    res.json({ item });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Answering the probe is the measurement: the discriminator confirms the
// belief, anything else clears a large chunk of it.
app.post("/api/answer", (req, res) => {
  const { sessionId = "demo", nodeId, label } = req.body;
  const session = getSession(sessionId);
  const item = (session.itemsAsked || []).at(-1);
  const chosen = item?.options.find((o) => o.label === label);
  if (!chosen) return res.status(400).json({ error: "unknown option" });

  const kind = chosen.is_discriminator ? "probe_confirm" : "probe_clear";
  updateBelief(session, nodeId, kind, { note: `chose ${label}: ${chosen.text}` });
  if (!chosen.is_discriminator) recordStrategy(session, nodeId, session.lastStrategy, "worked");
  const snap = snapshot(session);
  res.json({ chosen, kind, ledger: snap });
  persist(sessionId, snap);
});

app.post("/api/reset", (req, res) => {
  resetSession(req.body.sessionId || "demo");
  res.json({ ok: true });
});

app.get("/api/ledger/:id", (req, res) => res.json(snapshot(getSession(req.params.id))));
app.get("/api/personas", (req, res) => {
  const owner = req.query.owner;
  res.json([...Object.values(PERSONAS), ...(owner ? store.listPersonas(owner) : [])]);
});
app.get("/api/voices", (_, res) => res.json(VOICES));
app.get("/api/strategies", (_, res) =>
  res.json(Object.values(STRATEGIES).map(({ id, label, brief }) => ({ id, label, brief }))));

app.post("/api/personas", (req, res) => {
  const { owner, name, strategy, voice, blurb, grad, gender } = req.body;
  if (!owner || !name || !STRATEGIES[strategy]) return res.status(400).json({ error: "owner, name and a valid strategy are required" });
  if (!SPEAKERS.includes(voice)) return res.status(400).json({ error: "unknown voice" });
  const g = gender === "m" || gender === "f" ? gender : voiceGender(voice);
  if (g && voiceGender(voice) !== g) return res.status(400).json({ error: "that voice does not match the selected gender" });
  res.json(store.createPersona(owner, { name, strategy, voice, blurb, grad, gender: g }));
});
app.delete("/api/personas/:id", (req, res) =>
  res.json({ ok: store.deletePersona(req.params.id, req.query.owner) }));

/* --------------------------------- ask --------------------------------- */
// The whole teaching loop in one call: no diagnosis pass, no catalog, no topic
// the student did not raise. History is capped and the model decides for itself
// whether the new message is a follow-up or a fresh start.
app.post("/api/ask", async (req, res) => {
  const { sessionId = "demo", utterance, personaId, mood, lang } = req.body;
  if (!utterance || !utterance.trim()) return res.status(400).json({ error: "nothing to answer" });

  const session = getSession(sessionId);
  const convo = store.getConversation(sessionId);
  if (convo) hydrate(convo);

  const persona = (personaId && store.getPersona(personaId)) || PERSONAS[personaId] || PERSONAS.allie;
  session.turns += 1;
  session.transcript.push({ role: "student", text: utterance, at: Date.now() });

  try {
    const t0 = Date.now();
    const out = await answer({
      utterance, persona, mood, lang,
      problem: convo?.problem || "",
      history: session.transcript.slice(0, -1),
    });
    session.transcript.push({ role: "tutor", text: out.say, at: Date.now() });
    session.persona = persona.id;
    res.json({ ...out, persona, ms: Date.now() - t0 });
    persist(sessionId, snapshot(session));
  } catch (e) {
    session.transcript.pop();
    session.turns -= 1;
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/youtube", async (req, res) => {
  try { res.json({ items: await searchVideos(req.query.q, 8) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

/* ----------------------------- conversations --------------------------- */
app.get("/api/conversations", (req, res) => res.json(store.listConversations(req.query.owner)));
app.get("/api/conversations/:id", (req, res) => {
  const c = store.getConversation(req.params.id);
  if (!c) return res.status(404).json({ error: "not found" });
  // Rehydrate the in-memory ledger so context survives a server restart.
  hydrate(c);
  res.json(c);
});
app.post("/api/conversations", (req, res) => {
  const { owner, problem, personaId, title } = req.body;
  if (!owner) return res.status(400).json({ error: "owner required" });
  res.json(store.createConversation(owner, { problem, personaId, title }));
});
app.delete("/api/conversations/:id", (req, res) =>
  res.json({ ok: store.deleteConversation(req.params.id, req.query.owner) }));

app.get("/api/health", async (_, res) => {
  const out = { ok: false, provider: PROVIDER, model: process.env.MODEL_NAME, speech: "unset", llm: "unset" };
  try {
    const r = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: { "api-subscription-key": process.env.SPEECH_API_KEY || "", "Content-Type": "application/json" },
      body: JSON.stringify({ text: "ok", target_language_code: "hi-IN", model: "bulbul:v3", speaker: "kavya" }),
    });
    out.speech = r.ok ? "live" : `error ${r.status}`;
  } catch (e) { out.speech = "unreachable"; }
  if (PROVIDER === "the provider") {
    try {
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
        headers: { "x-goog-api-key": process.env.MODEL_API_KEY || "" },
      });
      out.llm = r.ok ? "live" : `error ${r.status}`;
    } catch { out.llm = "unreachable"; }
  } else out.llm = "unset";
  out.ok = out.speech === "live" && out.llm === "live";
  res.json(out);
});

const PORT = process.env.PORT || 8091;
app.listen(PORT, () => console.log(`ps8-tutor on http://localhost:${PORT}  [${PROVIDER}]`));
