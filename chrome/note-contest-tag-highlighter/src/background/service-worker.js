const CACHE_KEY = "tagData";
const CONSENT_KEY = "dataUseConsent";
const CONSENT_VERSION = 1;
const ALARM_NAME = "refresh-note-contest-tags";
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SOURCE_URL = "https://note.com/contests";
const FETCH_TIMEOUT_MS = 20 * 1000;
const MIN_PREVIOUS_TAG_COUNT_FOR_DROP_CHECK = 30;
const MIN_ACCEPTABLE_TAG_COUNT_RATIO = 0.5;
let refreshPromise;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 24 * 60 });
  void refreshIfStale();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 24 * 60 });
  void refreshIfStale();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void refreshTagData();
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  void handleHistoryStateUpdated(details);
}, {
  url: [{ hostEquals: "editor.note.com", pathPrefix: "/notes/" }]
});

async function handleHistoryStateUpdated(details) {
  const { [CONSENT_KEY]: dataUseConsent } = await chrome.storage.local.get(CONSENT_KEY);
  if (dataUseConsent?.version !== CONSENT_VERSION || details.frameId !== 0 || !isEditorPage(details.url)) return;

  void chrome.tabs.sendMessage(details.tabId, { type: "SPA_ROUTE_CHANGED" }, { frameId: 0 })
    .then((response) => {
      if (!response?.handled) return injectContentScript(details.tabId);
    })
    .catch(() => injectContentScript(details.tabId));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "ACCEPT_DATA_USE") {
    chrome.storage.local.set({ [CONSENT_KEY]: { version: CONSENT_VERSION } })
      .then(activateOpenEditorTabs)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message?.type === "REVOKE_DATA_USE") {
    chrome.storage.local.remove(CONSENT_KEY)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message?.type === "GET_TAG_DATA") {
    chrome.storage.local.get(CACHE_KEY).then(({ tagData }) => {
      sendResponse({ tagData: tagData ?? null, refreshing: Boolean(refreshPromise) });
    });
    return true;
  }

  if (message?.type === "PAGE_READY") {
    if (isPublishPage(sender.tab?.url)) void refreshIfStale();
    return false;
  }

  if (message?.type === "REFRESH_TAG_DATA") {
    refreshTagData().then(sendResponse);
    return true;
  }

  return false;
});

async function refreshIfStale() {
  const { tagData } = await chrome.storage.local.get(CACHE_KEY);
  const isStale = !tagData?.updatedAt || Date.now() - tagData.updatedAt >= REFRESH_INTERVAL_MS;
  if (isStale) return refreshTagData();
}

function isPublishPage(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "editor.note.com" &&
      /^\/notes\/[^/]+\/publish\/$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isEditorPage(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "editor.note.com" &&
      parsed.pathname.startsWith("/notes/");
  } catch {
    return false;
  }
}

async function injectContentScript(tabId) {
  const target = { tabId, frameIds: [0] };
  try {
    await chrome.scripting.insertCSS({ target, files: ["styles/highlight.css"] });
    await chrome.scripting.executeScript({ target, files: ["src/content/content.js"] });
  } catch {
    // The page may have navigated away before the fallback injection completed.
  }
}

async function activateOpenEditorTabs() {
  const tabs = await chrome.tabs.query({ url: "https://editor.note.com/notes/*" });
  await Promise.all(tabs.map(async (tab) => {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: "DATA_USE_CONSENT_GRANTED" });
      if (!response?.handled) await injectContentScript(tab.id);
    } catch {
      await injectContentScript(tab.id);
    }
  }));
}

async function refreshTagData() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    notifyRefreshState(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let response;
      let html;
      try {
        response = await fetch(SOURCE_URL, {
          method: "GET",
          credentials: "omit",
          cache: "no-store",
          signal: controller.signal
        });
        if (response.status !== 200) throw new Error(`Source returned HTTP ${response.status}`);

        const contentType = response.headers?.get("content-type") ?? "";
        if (!/^text\/html(?:\s*;|\s*$)/i.test(contentType)) {
          throw new Error(`Source returned an unexpected Content-Type: ${contentType || "missing"}`);
        }

        html = await response.text();
      } finally {
        clearTimeout(timeoutId);
      }

      if (typeof html !== "string" || html.trim().length === 0) throw new Error("Source returned an empty HTML document");
      const extracted = await parseSourceHtml(html);
      if (extracted?.error) throw new Error(`Source parsing failed: ${extracted.error}`);
      const { tagData: previousTagData } = await chrome.storage.local.get(CACHE_KEY);
      const validationError = getDataValidationError(extracted, previousTagData);
      if (validationError) throw new Error(`Could not validate tags from source page: ${validationError}`);

      const tags = [...new Set(extracted.tags.map((tag) => tag.name.trim()))];
      const tagData = {
        contests: tags,
        themes: [],
        tags,
        updatedAt: Date.now(),
        status: "available",
        error: null
      };
      await chrome.storage.local.set({ [CACHE_KEY]: tagData });
      await notifyPublishTabs();
      return { success: true, tagData };
    } catch (error) {
      const { tagData } = await chrome.storage.local.get(CACHE_KEY);
      console.warn("[note-contest-tag-highlighter] Tag refresh failed; retaining the previous cache.", error);
      if (tagData) {
        const preserved = { ...tagData, status: "stale", error: error.message };
        await chrome.storage.local.set({ [CACHE_KEY]: preserved });
        await notifyPublishTabs();
        return { success: false, tagData: preserved, error: error.message };
      }

      const unavailable = {
        contests: [], themes: [], tags: [], updatedAt: null,
        status: "unavailable", error: error.message
      };
      await chrome.storage.local.set({ [CACHE_KEY]: unavailable });
      await notifyPublishTabs();
      return { success: false, tagData: unavailable, error: error.message };
    } finally {
      refreshPromise = undefined;
      notifyRefreshState(false);
    }
  })();

  return refreshPromise;
}

function notifyRefreshState(refreshing) {
  void chrome.runtime.sendMessage({ type: "TAG_DATA_REFRESH_STATE", refreshing }).catch(() => {});
}

async function parseSourceHtml(html) {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (contexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: "src/background/parser.html",
      reasons: ["DOM_PARSER"],
      justification: "Parse the fetched note contests HTML without executing its scripts."
    });
  }
  return chrome.runtime.sendMessage({ type: "PARSE_SOURCE_HTML", html });
}

function getDataValidationError(data, previousTagData) {
  if (!data || !Array.isArray(data.tags)) return "contest tag links were not extracted";
  if (data.tags.length === 0) return "no contest tag links were found";

  const names = [];
  for (const tag of data.tags) {
    if (!tag || typeof tag.name !== "string" || !tag.name.trim() || typeof tag.url !== "string") {
      return "an extracted tag name or URL is empty or invalid";
    }

    let url;
    try {
      url = new URL(tag.url);
    } catch {
      return "an extracted tag URL is invalid";
    }
    if (url.origin !== "https://note.com" || url.username || url.password || !url.pathname.startsWith("/contest/") ||
        url.pathname.length <= "/contest/".length) {
      return "an extracted tag URL is outside the note.com contest pages";
    }
    names.push(tag.name.trim());
  }

  // Legacy caches split the list into contest and theme groups. The new parser
  // intentionally treats all qualifying links as one list, so compare against
  // the legacy contest group during migration and the full list afterward.
  const previousComparableTags = Array.isArray(previousTagData?.themes) && previousTagData.themes.length > 0
    ? previousTagData.contests
    : previousTagData?.tags;
  const previousTagCount = Array.isArray(previousComparableTags)
    ? new Set(previousComparableTags.filter((tag) => typeof tag === "string" && tag.trim())).size
    : 0;
  if (previousTagCount >= MIN_PREVIOUS_TAG_COUNT_FOR_DROP_CHECK &&
      names.length < previousTagCount * MIN_ACCEPTABLE_TAG_COUNT_RATIO) {
    return `tag count dropped from ${previousTagCount} to ${names.length}`;
  }
  return null;
}

async function notifyPublishTabs() {
  const { [CONSENT_KEY]: dataUseConsent } = await chrome.storage.local.get(CONSENT_KEY);
  if (dataUseConsent?.version !== CONSENT_VERSION) return;
  const tabs = await chrome.tabs.query({ url: "https://editor.note.com/notes/*/publish/*" });
  await Promise.all(tabs.map((tab) => chrome.tabs.sendMessage(tab.id, { type: "TAG_DATA_UPDATED" }).catch(() => {})));
}
