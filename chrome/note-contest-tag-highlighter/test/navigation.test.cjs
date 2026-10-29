const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const extensionRoot = join(__dirname, "..");
const serviceWorkerSource = readFileSync(join(extensionRoot, "src/background/service-worker.js"), "utf8");
const manifest = JSON.parse(readFileSync(join(extensionRoot, "manifest.json"), "utf8"));

function createServiceWorker({
  messageResponse = { handled: true },
  messageError,
  consentGranted = true,
  editorTabs = []
} = {}) {
  const callbacks = new Map();
  const sentMessages = [];
  const insertedCss = [];
  const executedScripts = [];
  const eventFilters = new Map();
  let dataUseConsent = consentGranted ? { version: 1 } : undefined;
  const registerEvent = (name) => ({
    addListener(callback, filter) {
      const listeners = callbacks.get(name) ?? [];
      listeners.push(callback);
      callbacks.set(name, listeners);
      if (filter) eventFilters.set(name, filter);
    }
  });
  const chrome = {
    alarms: { create() {}, onAlarm: registerEvent("alarm") },
    runtime: {
      onInstalled: registerEvent("installed"),
      onStartup: registerEvent("startup"),
      onMessage: registerEvent("message"),
      sendMessage: () => Promise.resolve()
    },
    storage: {
      local: {
        get(key) {
          if (key === "dataUseConsent") return Promise.resolve({ dataUseConsent });
          return Promise.resolve({});
        },
        set(values) {
          if (values.dataUseConsent) dataUseConsent = values.dataUseConsent;
          return Promise.resolve();
        },
        remove(key) {
          if (key === "dataUseConsent") dataUseConsent = undefined;
          return Promise.resolve();
        }
      }
    },
    tabs: {
      query: () => Promise.resolve(editorTabs),
      sendMessage(tabId, message, options) {
        sentMessages.push({ tabId, message, options });
        if (messageError) return Promise.reject(messageError);
        return Promise.resolve(messageResponse);
      }
    },
    webNavigation: { onHistoryStateUpdated: registerEvent("history-state-updated") },
    scripting: {
      insertCSS(details) {
        insertedCss.push(details);
        return Promise.resolve();
      },
      executeScript(details) {
        executedScripts.push(details);
        return Promise.resolve();
      }
    }
  };
  vm.runInNewContext(serviceWorkerSource, { chrome, URL, Date, Set, Promise, fetch() {} });

  return {
    notifyHistoryStateUpdated: (details) => {
      for (const listener of callbacks.get("history-state-updated") ?? []) listener(details);
    },
    dispatchMessage: (message) => new Promise((resolve) => {
      for (const listener of callbacks.get("message") ?? []) {
        const didRespondAsync = listener(message, {}, resolve);
        if (!didRespondAsync) resolve(undefined);
      }
    }),
    sentMessages,
    insertedCss,
    executedScripts,
    eventFilters
  };
}

test("declares webNavigation permission for SPA URL change events", () => {
  assert.equal(manifest.permissions.includes("webNavigation"), true);
  assert.equal(manifest.permissions.includes("scripting"), true);
  assert.equal(manifest.permissions.includes("tabs"), false);
});

test("forwards top-frame editor history updates to the content script", async () => {
  const serviceWorker = createServiceWorker();
  serviceWorker.notifyHistoryStateUpdated({
    tabId: 42,
    frameId: 0,
    url: "https://editor.note.com/notes/example/publish/"
  });

  await new Promise(setImmediate);

  assert.equal(serviceWorker.sentMessages.length, 1);
  assert.equal(serviceWorker.sentMessages[0].tabId, 42);
  assert.equal(serviceWorker.sentMessages[0].message.type, "SPA_ROUTE_CHANGED");
  assert.equal(serviceWorker.sentMessages[0].options.frameId, 0);
  assert.deepEqual(serviceWorker.insertedCss, []);
  assert.deepEqual(serviceWorker.executedScripts, []);
  assert.deepEqual(JSON.parse(JSON.stringify(serviceWorker.eventFilters.get("history-state-updated"))), {
    url: [{ hostEquals: "editor.note.com", pathPrefix: "/notes/" }]
  });
});

test("injects the content script and its styles when the page has no listener", async () => {
  const serviceWorker = createServiceWorker({ messageError: new Error("No receiving end") });
  serviceWorker.notifyHistoryStateUpdated({
    tabId: 42,
    frameId: 0,
    url: "https://editor.note.com/notes/example/publish/"
  });

  await new Promise(setImmediate);

  assert.deepEqual(JSON.parse(JSON.stringify(serviceWorker.insertedCss)), [{
    target: { tabId: 42, frameIds: [0] },
    files: ["styles/highlight.css"]
  }]);
  assert.deepEqual(JSON.parse(JSON.stringify(serviceWorker.executedScripts)), [{
    target: { tabId: 42, frameIds: [0] },
    files: ["src/content/content.js"]
  }]);
});

test("does not inspect editor navigation until consent has been granted", async () => {
  const serviceWorker = createServiceWorker({ consentGranted: false });
  serviceWorker.notifyHistoryStateUpdated({
    tabId: 42,
    frameId: 0,
    url: "https://editor.note.com/notes/example/publish/"
  });

  await new Promise(setImmediate);

  assert.equal(serviceWorker.sentMessages.length, 0);
  assert.equal(serviceWorker.executedScripts.length, 0);
});

test("ignores subframe and non-editor history updates", () => {
  const serviceWorker = createServiceWorker();
  serviceWorker.notifyHistoryStateUpdated({
    tabId: 42,
    frameId: 3,
    url: "https://editor.note.com/notes/example/publish/"
  });
  serviceWorker.notifyHistoryStateUpdated({
    tabId: 42,
    frameId: 0,
    url: "https://note.com/articles/example"
  });
  serviceWorker.notifyHistoryStateUpdated({
    tabId: 42,
    frameId: 0,
    url: "https://editor.note.com/settings"
  });

  assert.equal(serviceWorker.sentMessages.length, 0);
});
