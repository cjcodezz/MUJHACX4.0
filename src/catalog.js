/* ---------------------------------------------------------------------
 * NOT INCLUDED IN THIS REPOSITORY — the researched misconception catalog
 *
 * The tuned text that normally lives here is proprietary and is kept in a
 * separate build. The placeholder below keeps this file runnable so the
 * architecture can be read and exercised end to end.
 * ------------------------------------------------------------------- */
export const STRATEGIES = {
  cognitive_conflict: {
    id: "cognitive_conflict",
    label: "Cognitive conflict",
    persona: "shreya",
    // Beats robust misconceptions: re-explaining a rule the student is confident
    // in just bounces off. Make them commit to a prediction, then break it.
    brief:
      "Ask the student to predict a concrete outcome that their rule forces. " +
      "Show the real outcome. Let the contradiction sit before resolving it.",
  },
  analogy: {
    id: "analogy",
    label: "Bridging analogy",
    persona: "advait",
    brief:
      "Anchor to a physical situation the student already reasons correctly about " +
      "(sharing food, money, distance), then bridge step by step to the symbols.",
  },
  worked_example: {
    id: "worked_example",
    label: "Faded worked example",
    persona: "advait",
    brief:
      "Work one fully, then hand over one step at a time. Never more than one " +
      "new decision per problem.",
  },
  socratic: {
    id: "socratic",
    label: "Socratic",
    persona: "kavya",
    brief:
      "Never state the answer. Ask the one question whose answer exposes the gap. " +
      "Short questions, one at a time.",
  },
  representation: {
    id: "representation",
    label: "Change the representation",
    persona: "shreya",
    brief:
      "Move the concept to a different representation — number line, area model, " +
      "measurement — and let the student re-derive it there.",
  },
};

export const CATALOG = [
  // The researched misconception set is not included in this repository.
  // One entry is kept so the shape is legible.
  {
    id: "M-EXAMPLE-01",
    name: "[not included]",
    wrong_rule: "[not included]",
    predicts: "[not included]",
    tell: "[not included]",
    beats: ["cognitive_conflict"],
  },
];

export const byId = (id) => CATALOG.find((n) => n.id === id) || null;

/** Compact rendering for the diagnosis prompt. Keep this stable — it's cached. */
export function catalogForPrompt() {
  return CATALOG.map(
    (n) =>
      `${n.id} — ${n.name}\n  rule: ${n.wrong_rule}\n  predicts: ${n.predicts}\n  tell: ${n.tell}\n  beaten by: ${n.beats.join(", ")}`
  ).join("\n\n");
}
