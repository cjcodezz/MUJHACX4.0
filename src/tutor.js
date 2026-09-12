/* ---------------------------------------------------------------------
 * NOT INCLUDED IN THIS REPOSITORY — persona registers and the teaching prompt
 *
 * The tuned text that normally lives here is proprietary and is kept in a
 * separate build. The placeholder below keeps this file runnable so the
 * architecture can be read and exercised end to end.
 * ------------------------------------------------------------------- */
// The teaching turn. Runs on the FAST track — the student is waiting, so this
// is a short generation with no thinking budget and no schema ceremony.
//
// The strategy is chosen by the ledger, not by this model. That separation is
// the point: "change the method of explanation, not the difficulty level" is a
// decision made from the learner model, and the model here only voices it.

import { z } from "zod";
import { structured } from "./llm.js";
import { STRATEGIES, byId } from "./catalog.js";

// Ten faces across five teaching strategies — two per strategy, so choosing a
// teacher is a real choice of look AND method. `voice` must be one of the 37
// speakers bulbul:v3 accepts; `grad` renders the procedural portrait when no
// photo has been dropped into public/avatars/.
// The Ycotes studio roster. Five identities, five teaching methods, one-to-one —
// so choosing a face is also choosing a method, and a face swap always means the
// pedagogy actually changed. Roles and voice notes come from the studio page;
// the strategy each one owns is chosen to match how they already present.
// Artwork lives in public/avatars/ (mp4 wins over a still).
// Five identities, five teaching methods, one-to-one — so choosing a face is
// also choosing a method, and a face swap always means the pedagogy changed.
//
// `style` is the label a student picks by. `styleBrief` is the part that does
// the work: it goes into the system prompt, so a teacher labelled GenZ actually
// talks like one instead of being a Socratic tutor wearing a badge.
export const PERSONAS = {
  allie: {
    id: "allie", gender: "f", name: "Allie", initial: "A", voice: "priya",
    strategy: "socratic", label: "Socratic",
    style: "The friendly one",
    blurb: "[not included in this repository]",
    styleBrief: "[not included in this repository]",
    styleBriefHindi: "[not included in this repository]",
    grad: ["#6B8BFF", "#9B6BFF"],
  },
  yuna: {
    id: "yuna", gender: "f", name: "Yuna", initial: "Y", voice: "shruti",
    strategy: "cognitive_conflict", label: "Cognitive conflict",
    style: "The no-nonsense one",
    blurb: "[not included in this repository]",
    styleBrief: "[not included in this repository]",
    styleBriefHindi: "[not included in this repository]",
    grad: ["#FF5C4D", "#FF9E4D"],
  },
  mira: {
    id: "mira", gender: "f", name: "Mira", initial: "M", voice: "simran",
    strategy: "analogy", label: "Bridging analogy",
    style: "The GenZ one",
    blurb: "[not included in this repository]",
    styleBrief: "[not included in this repository]",
    styleBriefHindi: "[not included in this repository]",
    grad: ["#2DD4A7", "#1E9E8A"],
  },
  kabir: {
    id: "kabir", gender: "m", name: "Kabir", initial: "K", voice: "kabir",
    strategy: "representation", label: "New representation",
    style: "The desi one",
    blurb: "[not included in this repository]",
    styleBrief: "[not included in this repository]",
    styleBriefHindi: "[not included in this repository]",
    grad: ["#8E6BFF", "#5D3FD3"],
  },
  hanna: {
    id: "hanna", gender: "f", name: "Hanna", initial: "H", voice: "neha",
    strategy: "worked_example", label: "Faded example",
    style: "The fun one",
    blurb: "[not included in this repository]",
    styleBrief: "[not included in this repository]",
    styleBriefHindi: "[not included in this repository]",
    grad: ["#E879A6", "#B14A8A"],
  },
};

// Every strategy MUST own a persona. A silent fallback here puts the Socratic
// teacher on screen while she delivers an area model — visible, and wrong.
// Respect the teacher the student chose for as long as their method fits. Only
// swap faces when the pedagogy actually demands a different method — otherwise
// the switch stops meaning anything.
export function personaForStrategy(strategy, preferredId) {
  const preferred = preferredId && PERSONAS[preferredId];
  if (preferred && preferred.strategy === strategy) return preferred;
  const p = Object.values(PERSONAS).find((x) => x.strategy === strategy);
  if (!p) {
    console.warn(`[tutor] no persona owns strategy "${strategy}" — falling back to Kavya`);
    return PERSONAS.kavya;
  }
  return p;
}

const ReplySchema = z.object({
  say: z.string().describe("What the teacher says next. 2-3 sentences maximum, spoken aloud, natural Hinglish matching how the student speaks."),
  move: z.string().describe("Four to six words naming the pedagogical move, shown on screen. e.g. 'asks them to predict first'."),
  expects: z.string().describe("What a student who has understood would say back."),
});

export async function tutorTurn({ utterance, diagnosis, strategy, persona, history = [], problem, mood }) {
  const node = byId(diagnosis.node_id);
  const strat = STRATEGIES[strategy] || STRATEGIES.socratic;

  const system = `[Teaching prompt not included in this repository.]`;

  const user = `${problem && problem.trim()
    ? `THE PROBLEM ON SCREEN (hold them to this)\n${problem}`
    : "NO FIXED PROBLEM — answer what they actually asked about."}

THE STUDENT SAID
"${utterance}"

WHAT THIS UTTERANCE WAS: ${diagnosis.utterance_type || "explanation"}
${diagnosis.node_id === "NONE"
  ? "No misconception to teach against. Acknowledge briefly, then put the problem back in front of them — do NOT deliver a lesson on whatever they asked about."
  : `DIAGNOSED MISCONCEPTION
${diagnosis.node_id} — ${diagnosis.name}`}
${node ? `The wrong rule: ${node.wrong_rule}` : ""}
Evidence in their words: "${diagnosis.evidence_span}"
How firmly held: ${diagnosis.robustness}
${diagnosis.code_mix?.reading ? `Language read: ${diagnosis.code_mix.reading}` : ""}

${mood && mood.label && mood.label !== "unknown" ? `HOW THEY LOOK RIGHT NOW: ${mood.label}${mood.confidence ? ` (${Math.round(mood.confidence * 100)}% confident)` : ""}` : ""}

${history.length ? `RECENT CONTEXT — the last three exchanges only. Use it so you do not repeat\nyourself or lose the thread; do not treat anything older as still on the table\n${history.slice(-6).map((h) => `${h.role}: ${h.text}`).join("\n")}` : ""}

Take one ${strat.label} move now.`;

  const { data } = await structured({ system, user, schema: ReplySchema, maxTokens: 1200 });
  return data;
}
