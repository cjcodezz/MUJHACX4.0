/* ---------------------------------------------------------------------
 * NOT INCLUDED IN THIS REPOSITORY — the misconception-diagnosis prompt
 *
 * The tuned text that normally lives here is proprietary and is kept in a
 * separate build. The placeholder below keeps this file runnable so the
 * architecture can be read and exercised end to end.
 * ------------------------------------------------------------------- */
// The diagnosis pass — the one thing in this product that the problem statement
// says nobody else should be doing. Runs OUT OF BAND: the conversational turn
// never waits on it, so this can be slow and careful.

import { z } from "zod";
import { structured } from "./llm.js";
import { CATALOG, catalogForPrompt, STRATEGIES } from "./catalog.js";

const DiagnosisSchema = z.object({
  utterance_type: z
    .enum(["explanation", "answer", "question", "greeting", "off_topic", "confusion"])
    .describe("What the student actually did. Only 'explanation' and 'answer' carry reasoning that can be diagnosed."),
  node_id: z
    .string()
    .describe("A catalog id, or the literal OPEN_SET for a misconception not in the catalog, or NONE if the reasoning is sound."),
  name: z.string().describe("The wrong mental model named in the student's own terms. For OPEN_SET, write a new name in the style of the catalog."),
  confidence: z.number().min(0).max(1),
  evidence_span: z
    .string()
    .describe("The exact substring of the student's utterance that reveals the misconception. Must appear verbatim in the input."),
  evidence_reading: z.string().describe("One sentence: why that span shows this specific wrong rule rather than a slip."),
  code_mix: z.object({
    spans: z.array(
      z.object({
        text: z.string(),
        lang: z.enum(["en", "hi", "mixed", "other"]),
        role: z.enum(["procedure", "reasoning", "technical_term", "filler", "other"]),
      })
    ),
    reading: z
      .string()
      .describe("What the language split implies about understanding — e.g. technical nouns in English but all causal reasoning in L1 suggests borrowed vocabulary over an absent model. Empty string if the utterance is monolingual."),
  }),
  robustness: z
    .enum(["robust", "uncertain", "guess"])
    .describe("robust = stated fluently with no hedging (re-explaining will bounce off); guess = hedged, self-corrected, or asked back."),
  recommended_strategy: z.enum(Object.keys(STRATEGIES)),
  why_this_strategy: z.string(),
});

const SYSTEM = `[Misconception-diagnosis prompt not included in this repository.]`;

/**
 * @param {string} utterance    raw student speech, code-mixing intact
 * @param {object} ctx          { problem, priorNodes, failedStrategies }
 */
export async function diagnose(utterance, ctx = {}) {
  const { problem = "(not stated)", priorNodes = [], failed = [] } = ctx;

  const { data: d, model, usage } = await structured({
    system: SYSTEM,
    maxTokens: 4000,
    schema: DiagnosisSchema,
    user: `PROBLEM THE STUDENT IS WORKING ON
${problem}

WHAT THE LEDGER ALREADY BELIEVES
${priorNodes.length ? priorNodes.map((n) => `${n.id} (${n.name}) belief ${n.belief.toFixed(2)}, ${n.observations} obs`).join("\n") : "nothing yet — this is the first turn"}

STRATEGIES ALREADY TRIED AND FAILED
${failed.length ? failed.join(", ") : "none"}

STUDENT'S SPOKEN EXPLANATION (verbatim, code-mixing intact)
"""
${utterance}
"""`,
  });


  // A NONE verdict has no evidence by definition. Left populated, the UI draws
  // a misconception underline across a sentence nothing is wrong with.
  if (d.node_id === "NONE") { d.evidence_span = ""; d.code_mix.spans = d.code_mix.spans || []; }

  // The model often wraps the span in quotes. Strip them at the SOURCE: left in,
  // they break the verbatim check below (which silently halves confidence) and
  // show up as doubled quotes everywhere the span is rendered.
  d.evidence_span = (d.evidence_span || "")
    .trim()
    .replace(/^["'\u201c\u201d\u2018\u2019]+|["'\u201c\u201d\u2018\u2019]+$/g, "")
    .trim();

  // Guard the one thing the model can get wrong in a way that breaks the UI:
  // the evidence span must actually be highlightable in the transcript.
  const idx = utterance.toLowerCase().indexOf(d.evidence_span.toLowerCase());
  d.evidence_verbatim = idx >= 0;
  d.evidence_offset = idx;
  if (!d.evidence_verbatim) d.confidence = Math.min(d.confidence, 0.49);

  d.model = model;
  d.usage = usage;
  d.known_node = d.node_id !== "OPEN_SET" && d.node_id !== "NONE" && CATALOG.some((n) => n.id === d.node_id);
  return d;
}

export { DiagnosisSchema };
