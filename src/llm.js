// Provider-pluggable structured generation.
//
// The diagnosis pass needs schema-enforced JSON — that requirement is what
// disqualified browser proxies, not brand loyalty. Both backends here enforce
// a schema, so whichever key lands first tonight, the build is unblocked.
//


import { z } from "zod";

export const PROVIDER = "the provider";

/** the provider's responseSchema is an OpenAPI 3.0 subset — strip what it rejects. */
function toProviderSchema(node) {
  if (Array.isArray(node)) return node.map(toProviderSchema);
  if (node === null || typeof node !== "object") return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "$schema" || k === "additionalProperties" || k === "default") continue;
    out[k] = toProviderSchema(v);
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Measured on the free tier 2026-09-11 (same utterance, all three correct):




// back-to-back calls, and the stacked retries turned an 8s diagnosis into 62s.
// Two attempts, not three — on a congested model, falling through beats waiting.
const MODEL_CHAIN = (process.env.MODEL_FALLBACKS || process.env.MODEL_NAME || "")
    .split(",").map((s) => s.trim()).filter(Boolean);

async function providerCall(model, { system, user, schema, maxTokens }) {
  const key = process.env.MODEL_API_KEY;
  if (!key) throw new Error("MODEL_API_KEY is not set");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: toProviderSchema(z.toJSONSchema(schema)),
          maxOutputTokens: maxTokens,
        },
      }),
    }
  );
  if (!res.ok) {
    const err = new Error(`the provider ${res.status}: ${(await res.text()).slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const body = await res.json();
  const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`the provider: empty candidate (${JSON.stringify(body).slice(0, 200)})`);

  // field fails loudly here rather than rendering as undefined in the panel.
  return { data: schema.parse(JSON.parse(text)), model, usage: body.usageMetadata };
}

async function viaProvider(args) {
  const preferred = process.env.MODEL_NAME;
  const chain = preferred ? [preferred, ...MODEL_CHAIN.filter((m) => m !== preferred)] : MODEL_CHAIN;
  let last;
  for (const model of chain) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await providerCall(model, args);
      } catch (e) {
        last = e;
        // 503 = capacity, 429 = rate limit. Both are worth waiting out.
        if (e.status !== 503 && e.status !== 429) throw e;
        await sleep(400 * 2 ** attempt);
      }
    }
    console.warn(`[model] ${model} unavailable, falling back`);
  }
  throw last;
}

export async function structured({ system, user, schema, maxTokens = 4000 }) {
  const fn = viaProvider;
  return fn({ system, user, schema, maxTokens });
}
