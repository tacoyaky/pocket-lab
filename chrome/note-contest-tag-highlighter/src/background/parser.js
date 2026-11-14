chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "PARSE_SOURCE_HTML" || typeof message.html !== "string") return false;
  try {
    sendResponse(extractTags(message.html));
  } catch (error) {
    sendResponse({ error: error instanceof Error ? error.message : String(error) });
  }
  return false;
});

function extractTags(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const tags = [];
  const seenNames = new Set();

  for (const anchor of doc.querySelectorAll("a[href][aria-label]")) {
    const label = anchor.getAttribute("aria-label");
    if (typeof label !== "string" || !label.startsWith("#")) continue;

    const name = normalizeTag(label.slice(1));
    if (!name || seenNames.has(name)) continue;

    const href = anchor.getAttribute("href");
    if (typeof href !== "string" || !href.trim()) continue;

    let url;
    try {
      url = new URL(href, "https://note.com/contests");
    } catch {
      continue;
    }

    if (url.origin !== "https://note.com" || url.username || url.password || !url.pathname.startsWith("/contest/") ||
        url.pathname.length <= "/contest/".length) continue;

    seenNames.add(name);
    tags.push({ name, url: url.href });
  }

  return { tags };
}

function normalizeTag(value) {
  return value.replace(/\s+/g, " ").trim();
}
