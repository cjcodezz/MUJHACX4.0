/* ---------------------------------------------------------------------
 * NOT INCLUDED IN THIS REPOSITORY — discriminating-item generation prompts
 *
 * The tuned text that normally lives here is proprietary and is kept in a
 * separate build. The placeholder below keeps this file runnable so the
 * architecture can be read and exercised end to end.
 * ------------------------------------------------------------------- */
// Discriminating practice item generation.
//
// The point is NOT "more questions on fractions". Each item is built so that
// the distractor is reachable ONLY by applying the diagnosed misconception.
// That makes the student's answer a measurement: picking the distractor
// confirms the belief, avoiding it clears it. One mechanism serves both
// "targeted practice generation" and "measurable improvement".

import { z } from "zod";
import { structured } from "./llm.js";
import { byId } from "./catalog.js";

const ItemSchema = z.object({
  question: z.string().describe("One short question, in the student's code-mixed register."),
  options: z.array(z.object({
    label: z.string().describe("A, B, C or D"),
    text: z.string(),
    is_correct: z.boolean(),
    is_discriminator: z.boolean().describe("True for the single option that is reachable ONLY by applying this misconception."),
    why: z.string().describe("One clause: what reasoning produces this option."),
  })).min(3).max(4),
  discriminates: z.string().describe("One sentence: why choosing the discriminator is evidence of this specific misconception and not a careless slip."),
});

export async function generateItem(nodeId, { name, avoid = [] } = {}) {
  const node = byId(nodeId);

  const system = `[not included in this repository]`;

  const user = `[not included in this repository]`;

  const { data } = await structured({ system, user, schema: ItemSchema, maxTokens: 1500 });
  data.node_id = nodeId;
  return data;
}
