
//   TTS  bulbul:v3   (bulbul:v2 is deprecated and returns 400)
//   STT  saaras:v4   (also valid: saarika:v2.5, saaras:v3, saaras:v3-realtime,
//                     saaras:v4-multispk, saarika:v1/v2, saarika:flash)
// NOTE: `output_script` is accepted but ignored — transcripts come back in
// Devanagari even for romanized input. See romanizationRisk() below.

const KEY = () => process.env.SPEECH_API_KEY;
const BASE = "https://api.sarvam.ai";

// Confirmed available for bulbul:v3, tagged by gender so a teacher is never
// given a voice that contradicts their face.
export const VOICES = {
  f: ["ritu","priya","neha","pooja","simran","kavya","ishita","shreya","roopa",
      "tanya","shruti","suhani","kavitha","rupali"],
  m: ["aditya","ashutosh","rahul","rohan","amit","dev","ratan","varun","manan",
      "sumit","kabir","aayan","shubh","advait","anand","tarun","sunny","mani",
      "gokul","vijay","mohit","rehan","soham"],
};
export const SPEAKERS = [...VOICES.f, ...VOICES.m];
export const voiceGender = (v) => (VOICES.f.includes(v) ? "f" : VOICES.m.includes(v) ? "m" : null);

export async function speak(text, { speaker = "kavya", lang = "hi-IN" } = {}) {
  const r = await fetch(`${BASE}/text-to-speech`, {
    method: "POST",
    headers: { "api-subscription-key": KEY(), "Content-Type": "application/json" },
    body: JSON.stringify({ text, target_language_code: lang, model: "bulbul:v3", speaker }),
  });
  if (!r.ok) throw new Error(`sarvam tts ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  return data.audios[0]; // base64 wav
}

export async function transcribe(buffer, { filename = "speech.wav", model = "saaras:v4" } = {}) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "audio/wav" }), filename);
  form.append("model", model);
  form.append("language_code", "unknown"); // let it detect; we want code-mix intact
  const r = await fetch(`${BASE}/speech-to-text`, {
    method: "POST",
    headers: { "api-subscription-key": KEY() },
    body: form,
  });
  if (!r.ok) throw new Error(`sarvam stt ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  return {
    text: data.transcript,
    language: data.language_code,
    confidence: data.language_probability ?? null,
  };
}

/**
 * The code-mix wedge depends on being able to see which words arrived in
 * English. the provider returns Devanagari, so English technical terms come back
 * transliterated (डिनॉमिनेटर) rather than as "denominator". That is still a
 * usable signal — a transliterated Latin loanword is recoverable — but it is
 * the single assumption under our best idea, so flag it loudly until a real
 * code-mixed human utterance has been run through.
 */
export function romanizationRisk(transcript) {
  // Devanagari renderings of English loan phonology: ऑ, ॉ, and ज़/फ़ clusters
  // show up almost exclusively in transliterated English.
  const loanish = (transcript.match(/[ऑॉ]|ज़|फ़/g) || []).length;
  return { transliterated_english_hints: loanish, devanagari: /[ऀ-ॿ]/.test(transcript) };
}
