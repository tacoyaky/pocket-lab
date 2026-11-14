const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const serviceWorkerSource = readFileSync(join(__dirname, "../src/background/service-worker.js"), "utf8");

function tag(name, slug = encodeURIComponent(name)) {
  return { name, url: `https://note.com/contest/${slug}?f=popular` };
}

function htmlResponse({ status = 200, contentType = "text/html; charset=utf-8", html = "<html>source</html>", textError } = {}) {
  return {
    status,
    headers: { get: (name) => name.toLowerCase() === "content-type" ? contentType : null },
    text: () => textError ? Promise.reject(textError) : Promise.resolve(html)
  };
}

function createServiceWorker({
  initialTagData,
  parsedTags = [tag("スキしてみて"), tag("わたしの旅行記")],
  response = htmlResponse(),
  fetchError,
  fetchImpl,
  immediateTimeout = false
} = {}) {
  const callbacks = new Map();
  const fetchCalls = [];
  const writes = [];
  const warnings = [];
  const sentMessages = [];
  const createdDocuments = [];
  const stored = { dataUseConsent: { version: 1 } };
  if (initialTagData) stored.tagData = initialTagData;

  const registerEvent = (name) => ({
    addListener(callback) {
      const listeners = callbacks.get(name) ?? [];
      listeners.push(callback);
      callbacks.set(name, listeners);
    }
  });

  const chrome = {
    alarms: { create() {}, onAlarm: registerEvent("alarm") },
    offscreen: {
      createDocument(details) {
        createdDocuments.push(details);
        return Promise.resolve();
      }
    },
    runtime: {
      onInstalled: registerEvent("installed"),
      onStartup: registerEvent("startup"),
      onMessage: registerEvent("message"),
      getContexts: () => Promise.resolve([{ contextType: "OFFSCREEN_DOCUMENT" }]),
      sendMessage(message) {
        sentMessages.push(message);
        if (message.type === "PARSE_SOURCE_HTML") return Promise.resolve({ tags: parsedTags });
        return Promise.resolve();
      }
    },
    storage: {
      local: {
        get(key) {
          return Promise.resolve({ [key]: stored[key] });
        },
        set(values) {
          writes.push(values);
          Object.assign(stored, values);
          return Promise.resolve();
        },
        remove(key) {
          delete stored[key];
          return Promise.resolve();
        }
      }
    },
    tabs: {
      query: () => Promise.resolve([]),
      sendMessage: () => Promise.resolve()
    },
    webNavigation: { onHistoryStateUpdated: registerEvent("history-state-updated") },
    scripting: { insertCSS: () => Promise.resolve(), executeScript: () => Promise.resolve() }
  };

  const context = vm.createContext({
    AbortController,
    URL,
    Date,
    Promise,
    Set,
    clearTimeout: (id) => clearTimeout(id),
    console: { warn: (...args) => warnings.push(args) },
    fetch(url, options) {
      fetchCalls.push({ url, options });
      if (fetchError) return Promise.reject(fetchError);
      if (fetchImpl) return fetchImpl(url, options);
      return Promise.resolve(response);
    },
    setTimeout(callback, delay) {
      if (immediateTimeout) {
        queueMicrotask(callback);
        return 1;
      }
      return setTimeout(callback, delay);
    },
    chrome
  });
  vm.runInContext(serviceWorkerSource, context, { filename: "service-worker.js" });

  return {
    createdDocuments,
    fetchCalls,
    refreshIfStale: () => context.refreshIfStale(),
    sentMessages,
    stored,
    warnings,
    writes,
    dispatchMessage(message) {
      return new Promise((resolve, reject) => {
        try {
          const listener = callbacks.get("message")?.[0];
          const isAsync = listener(message, {}, resolve);
          if (!isAsync) resolve(undefined);
        } catch (error) {
          reject(error);
        }
      });
    }
  };
}

function previousCache(names = ["前回のタグ"]) {
  return {
    contests: names,
    themes: [],
    tags: names,
    updatedAt: 123456,
    status: "available",
    error: null
  };
}

test("fetches contests HTML without credentials and saves deduplicated names in the existing cache shape", async () => {
  const worker = createServiceWorker({ parsedTags: [tag("スキしてみて"), tag("スキしてみて", "duplicate"), tag("旅行") ] });
  const result = await worker.dispatchMessage({ type: "REFRESH_TAG_DATA" });

  assert.equal(result.success, true);
  assert.deepEqual(worker.fetchCalls.map(({ url }) => url), ["https://note.com/contests"]);
  assert.equal(worker.fetchCalls[0].options.method, "GET");
  assert.equal(worker.fetchCalls[0].options.credentials, "omit");
  assert.equal(worker.fetchCalls[0].options.cache, "no-store");
  assert.ok(worker.fetchCalls[0].options.signal);
  assert.deepEqual(JSON.parse(JSON.stringify(worker.stored.tagData.contests)), ["スキしてみて", "旅行"]);
  assert.deepEqual(JSON.parse(JSON.stringify(worker.stored.tagData.themes)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(worker.stored.tagData.tags)), ["スキしてみて", "旅行"]);
  assert.equal(worker.stored.tagData.status, "available");
  assert.ok(worker.stored.tagData.updatedAt > 0);
  assert.equal(worker.sentMessages.some((message) => message.type === "PARSE_SOURCE_HTML"), true);
});

test("does not replace a successful cache when the server or response is invalid", async (t) => {
  const scenarios = [
    ["HTTP 403", { response: htmlResponse({ status: 403 }) }, /HTTP 403/],
    ["HTTP 500", { response: htmlResponse({ status: 500 }) }, /HTTP 500/],
    ["non-HTML response", { response: htmlResponse({ contentType: "application/json" }) }, /Content-Type/],
    ["empty document", { response: htmlResponse({ html: " \n " }) }, /empty HTML/],
    ["no contest links", { parsedTags: [] }, /no contest tag links/],
    ["invalid URL", { parsedTags: [{ name: "不正", url: "https://example.com/contest/x" }] }, /outside the note.com/],
    ["network error", { fetchError: new Error("offline") }, /offline/]
  ];

  for (const [name, options, expectedError] of scenarios) {
    await t.test(name, async () => {
      const original = previousCache(["前回のタグ", "別のタグ"]);
      const worker = createServiceWorker({ initialTagData: original, ...options });
      const result = await worker.dispatchMessage({ type: "REFRESH_TAG_DATA" });

      assert.equal(result.success, false);
      assert.match(result.error, expectedError);
      assert.deepEqual(JSON.parse(JSON.stringify(worker.stored.tagData.tags)), original.tags);
      assert.equal(worker.stored.tagData.updatedAt, original.updatedAt);
      assert.equal(worker.stored.tagData.status, "stale");
      assert.equal(worker.warnings.length, 1);
    });
  }
});

test("rejects an abrupt drop relative to a substantial successful cache", async () => {
  const priorTags = Array.from({ length: 100 }, (_, index) => `prior-${index}`);
  const worker = createServiceWorker({
    initialTagData: previousCache(priorTags),
    parsedTags: Array.from({ length: 40 }, (_, index) => tag(`new-${index}`))
  });
  const result = await worker.dispatchMessage({ type: "REFRESH_TAG_DATA" });

  assert.equal(result.success, false);
  assert.match(result.error, /dropped from 100 to 40/);
  assert.equal(worker.stored.tagData.tags.length, 100);
  assert.equal(worker.stored.tagData.updatedAt, 123456);
  assert.equal(worker.warnings.length, 1);
});

test("uses the legacy contest group for the first refresh of a split cache", async () => {
  const legacyContests = Array.from({ length: 60 }, (_, index) => `contest-${index}`);
  const legacyThemes = Array.from({ length: 80 }, (_, index) => `theme-${index}`);
  const worker = createServiceWorker({
    initialTagData: {
      contests: legacyContests,
      themes: legacyThemes,
      tags: [...legacyContests, ...legacyThemes],
      updatedAt: 123456,
      status: "available",
      error: null
    },
    parsedTags: Array.from({ length: 60 }, (_, index) => tag(`new-${index}`))
  });
  const result = await worker.dispatchMessage({ type: "REFRESH_TAG_DATA" });

  assert.equal(result.success, true);
  assert.equal(worker.stored.tagData.tags.length, 60);
  assert.deepEqual(JSON.parse(JSON.stringify(worker.stored.tagData.themes)), []);
});

test("a timed out request retains the previous cache", async () => {
  const original = previousCache(["前回のタグ"]);
  const worker = createServiceWorker({
    initialTagData: original,
    immediateTimeout: true,
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      const abort = () => reject(Object.assign(new Error("request timed out"), { name: "AbortError" }));
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    })
  });
  const result = await worker.dispatchMessage({ type: "REFRESH_TAG_DATA" });

  assert.equal(result.success, false);
  assert.match(result.error, /timed out/);
  assert.deepEqual(JSON.parse(JSON.stringify(worker.stored.tagData.tags)), original.tags);
  assert.equal(worker.stored.tagData.updatedAt, original.updatedAt);
});

test("records an unavailable state after a failed first fetch", async () => {
  const worker = createServiceWorker({ fetchError: new Error("offline") });
  const result = await worker.dispatchMessage({ type: "REFRESH_TAG_DATA" });

  assert.equal(result.success, false);
  assert.equal(worker.stored.tagData.status, "unavailable");
  assert.deepEqual(JSON.parse(JSON.stringify(worker.stored.tagData.tags)), []);
  assert.equal(worker.stored.tagData.updatedAt, null);
});

test("reuses fresh cached data and refreshes it after 24 hours", async () => {
  const freshWorker = createServiceWorker({
    initialTagData: { ...previousCache(["現行タグ"]), updatedAt: Date.now() - 23 * 60 * 60 * 1000 }
  });
  await freshWorker.refreshIfStale();
  assert.equal(freshWorker.fetchCalls.length, 0);

  const staleWorker = createServiceWorker({
    initialTagData: { ...previousCache(["旧タグ"]), updatedAt: Date.now() - 24 * 60 * 60 * 1000 - 1 }
  });
  await staleWorker.refreshIfStale();
  assert.equal(staleWorker.fetchCalls.length, 1);
  assert.equal(staleWorker.stored.tagData.status, "available");
});
