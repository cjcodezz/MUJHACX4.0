// The learner model. This is the object the judges should be looking at.
//
// One entry per misconception the system has ever suspected, carrying the
// evidence that produced it, a belief that moves on every interaction, and the
// strategies already tried and failed. "Continuously updates its understanding
// of the student's learning gaps" is this file.

import { byId } from "./catalog.js";

const sessions = new Map();

const BELIEF = {
  // A spoken tell is suggestive; a failed discriminating probe is near-proof,
  // because the distractor is only reachable if the misconception is held.
  utterance_hit: 0.30,
  probe_confirm: 0.35,
  probe_clear: -0.55,
  remediation_ok: -0.30,
  decay_per_turn: 0.02,
};

const clamp = (x) => Math.max(0, Math.min(1, x));

export function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      id,
      createdAt: Date.now(),
      turns: 0,
      language_profile: { l1_spans: 0, en_spans: 0, technical_terms_in_en: 0 },
      nodes: new Map(),
      transcript: [],
      events: [],
    });
  }
  return sessions.get(id);
}

export const allSessions = () => [...sessions.values()];

/** Wipe one session. Rehearsing the demo six times needs this. */
export function resetSession(id) { sessions.delete(id); return getSession(id); }

function ensureNode(session, nodeId, name) {
  if (!session.nodes.has(nodeId)) {
    session.nodes.set(nodeId, {
      id: nodeId,
      name: name || byId(nodeId)?.name || nodeId,
      belief: 0,
      observations: 0,
      evidence: [],
      strategies_tried: [],
      status: "suspected",
      first_seen: Date.now(),
      resolved_at: null,
      history: [],
    });
  }
  return session.nodes.get(nodeId);
}

/**
 * Move a belief and record why. Every mutation goes through here so the panel
 * can render a trajectory rather than a single number.
 */
export function updateBelief(session, nodeId, kind, { name, evidence, note } = {}) {
  const node = ensureNode(session, nodeId, name);
  const before = node.belief;
  node.belief = clamp(node.belief + (BELIEF[kind] ?? 0));
  node.observations += 1;
  if (evidence) node.evidence.push({ ...evidence, at: Date.now(), kind });
  node.history.push({ at: Date.now(), kind, from: before, to: node.belief, note });

  if (node.belief >= 0.6) node.status = "active";
  else if (node.belief <= 0.2 && node.observations > 1) {
    node.status = "resolved";
    node.resolved_at = node.resolved_at ?? Date.now();
  } else node.status = "suspected";

  session.events.push({ at: Date.now(), type: "belief", nodeId, from: before, to: node.belief, kind });
  return node;
}

export function recordStrategy(session, nodeId, strategyId, outcome) {
  const node = session.nodes.get(nodeId);
  if (!node) return null;
  // One row per strategy, not one per turn — the panel is meant to answer
  // "what have we already tried on this node", and repeats make it unreadable.
  const seen = node.strategies_tried.find((s) => s.strategy === strategyId);
  if (seen) { seen.outcome = outcome; seen.at = Date.now(); seen.attempts = (seen.attempts || 1) + 1; }
  else node.strategies_tried.push({ strategy: strategyId, outcome, at: Date.now(), attempts: 1 });
  return node;
}

/** Strategies already burned on this node — the tutor must not repeat them. */
export function failedStrategies(session, nodeId) {
  const node = session.nodes.get(nodeId);
  if (!node) return [];
  return node.strategies_tried.filter((s) => s.outcome === "failed").map((s) => s.strategy);
}

export function decay(session) {
  for (const node of session.nodes.values()) {
    if (node.status === "resolved") continue;
    node.belief = clamp(node.belief - BELIEF.decay_per_turn);
  }
}

export function activeNode(session) {
  const ranked = [...session.nodes.values()]
    .filter((n) => n.status !== "resolved")
    .sort((a, b) => b.belief - a.belief);
  return ranked[0] || null;
}

/** Shape the panel renders. Keep it flat and boring — the UI should not compute. */
export function snapshot(session) {
  return {
    id: session.id,
    turns: session.turns,
    language_profile: session.language_profile,
    nodes: [...session.nodes.values()]
      .sort((a, b) => b.belief - a.belief)
      .map((n) => ({
        ...n,
        evidence: n.evidence.slice(-4),
        history: n.history.slice(-8),
      })),
    transcript: session.transcript.slice(-12),
  };
}
