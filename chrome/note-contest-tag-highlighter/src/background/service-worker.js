const CACHE_KEY = "tagData";
const ALARM_NAME = "refresh-note-contest-tags";
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SOURCE_URL = "https://note.com/contests";
let refreshPromise;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 24 * 60 });
  void refreshTagData();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 24 * 60 });
  void refreshIfStale();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void refreshTagData();
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0 || !isEditorPage(details.url)) return;
  void chrome.tabs.sendMessage(details.tabId, { type: "SPA_ROUTE_CHANGED" }, { frameId: 0 })
    .then((response) => {
      if (!response?.handled) return injectContentScript(details.tabId);
    })
    .catch(() => injectContentScript(details.tabId));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

async function refreshTagData() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    notifyRefreshState(true);
    try {
      const response = await fetch(SOURCE_URL, { credentials: "omit", cache: "no-store" });
      if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
      const html = await response.text();
      const extracted = await parseSourceHtml(html);
      if (extracted?.error) throw new Error(`Source parsing failed: ${extracted.error}`);
      const validationError = getDataValidationError(extracted);
      if (validationError) throw new Error(`Could not validate tags from source page: ${validationError}`);

      const tagData = {
        contests: extracted.contests,
        themes: extracted.themes,
        tags: [...new Set([...extracted.contests, ...extracted.themes])],
        updatedAt: Date.now(),
        status: "available",
        error: null
      };
      await chrome.storage.local.set({ [CACHE_KEY]: tagData });
      await notifyPublishTabs();
      return { success: true, tagData };
    } catch (error) {
      const { tagData } = await chrome.storage.local.get(CACHE_KEY);
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

function getDataValidationError(data) {
  if (!data || !Array.isArray(data.contests) || !Array.isArray(data.themes)) return "tag sections were not extracted";
  if (data.contests.length === 0 || data.themes.length === 0) return "one or more tag sections are empty";
  if (data.themeCategoryCount === 0) return "no theme categories were detected";
  if (data.themeCategoriesWithTags !== data.themeCategoryCount) return "some theme categories have no hashtag titles";
  if (![...data.contests, ...data.themes].every((tag) => typeof tag === "string" && tag.length > 0)) {
    return "an extracted tag is empty or invalid";
  }
  return null;
}

async function notifyPublishTabs() {
  const tabs = await chrome.tabs.query({ url: "https://editor.note.com/notes/*/publish/*" });
  await Promise.all(tabs.map((tab) => chrome.tabs.sendMessage(tab.id, { type: "TAG_DATA_UPDATED" }).catch(() => {})));
}
