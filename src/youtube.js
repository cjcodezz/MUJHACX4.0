// YouTube search with two paths.
//
// The Data API is the right way, but it needs to be enabled per project and the

// otherwise read the payload YouTube's own results page already ships. No key,
// no quota, and it degrades to an empty list rather than an error page.

const API = "https://www.googleapis.com/youtube/v3/search";

async function viaApi(q, max) {
  const url = `${API}?part=snippet&type=video&maxResults=${max}&safeSearch=strict&q=${encodeURIComponent(q)}&key=${process.env.VIDEO_API_KEY}`;
  const r = await fetch(url);
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || "youtube api error");
  return (d.items || []).map((it) => ({
    id: it.id.videoId,
    title: it.snippet.title,
    channel: it.snippet.channelTitle,
    thumb: it.snippet.thumbnails?.medium?.url || it.snippet.thumbnails?.default?.url,
  }));
}

async function viaPage(q, max) {
  const r = await fetch(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAQ%253D%253D`,
    { headers: { "accept-language": "en-IN,en;q=0.9", "user-agent": "Mozilla/5.0" } }
  );
  const html = await r.text();
  const m = html.match(/var ytInitialData\s*=\s*(\{.+?\});<\/script>/s);
  if (!m) return [];
  const data = JSON.parse(m[1]);

  // The renderer tree moves around between deploys, so walk it instead of
  // indexing a fixed path.
  const out = [];
  (function walk(node) {
    if (out.length >= max || !node || typeof node !== "object") return;
    if (node.videoRenderer?.videoId) {
      const v = node.videoRenderer;
      out.push({
        id: v.videoId,
        title: v.title?.runs?.[0]?.text || v.title?.simpleText || "Untitled",
        channel: v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || "",
        length: v.lengthText?.simpleText || "",
        thumb: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
      });
      return;
    }
    for (const k of Object.keys(node)) walk(node[k]);
  })(data);
  return out;
}

export async function searchVideos(q, max = 8) {
  if (!q || !q.trim()) return [];
  if (process.env.VIDEO_API_KEY) {
    try { return await viaApi(q, max); }
    catch (e) { console.warn("[youtube] api failed, falling back:", e.message); }
  }
  return viaPage(q, max);
}
