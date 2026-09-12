/* ---------------------------------------------------------------------
 * NOT INCLUDED IN THIS REPOSITORY — system prompt and language/script rules
 *
 * The tuned text that normally lives here is proprietary and is kept in a
 * separate build. The placeholder below keeps this file runnable so the
 * architecture can be read and exercised end to end.
 * ------------------------------------------------------------------- */
// One call, one answer. No misconception catalog, no diagnosis pass, no topic
// the student did not raise — the teacher answers what was actually asked, in
// their own style, and history is offered rather than imposed.

import { z } from "zod";
import { structured } from "./llm.js";
import { STRATEGIES } from "./catalog.js";

const AnswerSchema = z.object({
  follows_on: z
    .boolean()
    .describe("True only if the new message genuinely continues the recent exchange. False for a fresh topic, even inside the same conversation."),
  say: z.string().describe("What the teacher says. Spoken aloud, so no markdown, no bullet lists, no code fences."),
});

// Three exchanges is enough to carry a follow-up and short enough that an old
// topic cannot bleed into a new one.
const MAX_HISTORY = 6;

const DEVANAGARI = /[\u0900-\u097F]/;

// Is the reply actually in the script we asked for? Counting beats trusting:
// one persona's register was consistently strong enough to override the
// instruction, and a prompt-only fix is a probability, not a guarantee.
function isDevanagari(text) {
  const dev = (text.match(/[\u0900-\u097F]/g) || []).length;
  const lat = (text.match(/[A-Za-z]/g) || []).length;
  return dev > lat;
}

const LANGS = {
  hinglish: "[not included]",
  hindi: "[not included]",
  english: "[not included]",
};

export async function answer({ utterance, persona, history = [], problem, mood, lang = "hinglish" }) {
  const strat = STRATEGIES[persona.strategy] || STRATEGIES.socratic;
  const recent = history.slice(-MAX_HISTORY);

  const system = `You are a tutor. Answer the student's question clearly and in their language.\n[System prompt not included in this repository.]`;

  const user = `${problem && problem.trim() ? `WHAT THIS CONVERSATION IS ABOUT\n${problem}\n\n` : ""}${
    recent.length
      ? `RECENT TURNS (most recent last)\n${recent.map((h) => `${h.role === "student" ? "Student" : "You"}: ${h.text}`).join("\n")}\n\n`
      : ""
  }THE STUDENT JUST SAID
"${utterance}"`;

  let { data } = await structured({ system, user, schema: AnswerSchema, maxTokens: 1200 });

  // Enforcement, not hope: if Hindi was requested and the reply came back in
  // Roman script, say so plainly and ask once more. Personas with a strong
  // Roman-script register (the Gen-Z one especially) otherwise ignore the
  // setting entirely.
  if (lang === "hindi" && data.say && !isDevanagari(data.say)) {
    console.warn("[answer] Hindi requested but reply was Roman — retrying");
    const retry = await structured({
      system,
      schema: AnswerSchema,
      maxTokens: 1200,
      user:
        `${user}\n\nYour previous attempt was:\n"${data.say}"\n\n` +
        `That was written in ROMAN script. It must be in DEVANAGARI (देवनागरी). ` +
        `Write the same answer again, same personality, same warmth, same slang register — ` +
        `but in Devanagari. Only technical terms with no natural Hindi equivalent stay in Latin script.`,
    });
    if (retry.data?.say && isDevanagari(retry.data.say)) data = retry.data;
  }

  return data;
}
