# Notice

This repository contains the architecture of AI Tutor and runs end to end.
The tuned behaviour is proprietary and is not included:

| Not included | Why |
|---|---|
| System prompt (`src/answer.js`) | The teaching instruction set. |
| Language and script rules | What makes Hindi come back in Devanagari, in persona. |
| Persona registers (`src/tutor.js`) | Five teaching styles, English and Hindi. |
| Misconception catalog (`src/catalog.js`) | Researched error patterns. |
| Diagnosis and item prompts | The diagnostic core. |

Everything structural is here: routing, the provider-agnostic inference layer,
the speech pipeline, on-device expression reading, persistence, video search and
the full interface.

Run it with your own keys and it will answer — in a generic teacher voice rather
than the tuned personas.
