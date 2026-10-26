const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const extensionRoot = join(__dirname, "..");
const contentSource = readFileSync(join(extensionRoot, "src/content/content.js"), "utf8");

class FakeElement {
  constructor(tagName, text = "", attributes = {}) {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.parentElement = null;
    this.childNodes = [];
    this.attributes = new Map(Object.entries(attributes));
    this.disabled = false;
    this._text = text;
    this.classes = new Set();
    this.classList = {
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
      contains: (name) => this.classes.has(name),
      toggle: (name, force) => {
        const shouldAdd = force ?? !this.classes.has(name);
        if (shouldAdd) this.classes.add(name);
        else this.classes.delete(name);
        return shouldAdd;
      }
    };
  }

  get innerText() {
    return this.textContent;
  }

  get textContent() {
    return this._text + this.childNodes.map((child) => child.textContent ?? "").join("");
  }

  set textContent(value) {
    this.childNodes = [];
    this._text = String(value);
  }

  appendChild(child) {
    child.parentElement = this;
    this.childNodes.push(child);
    return child;
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  matches(selector) {
    return selector.split(",").some((part) => this.matchesSimple(part.trim()));
  }

  matchesSimple(selector) {
    if (selector === "*") return true;
    if (selector.startsWith(".")) return this.classes.has(selector.slice(1));
    const attribute = selector.match(/^\[([^=\]]+)(?:=['"]?([^\]'\"]+)['"]?)?\]$/);
    if (attribute) {
      return this.getAttribute(attribute[1]) !== null &&
        (attribute[2] === undefined || this.getAttribute(attribute[1]) === attribute[2]);
    }
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (element) => {
      for (const child of element.childNodes) {
        if (child.nodeType === 1) {
          if (child.matches(selector)) matches.push(child);
          visit(child);
        }
      }
    };
    visit(this);
    return matches;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  contains(candidate) {
    for (let element = candidate; element; element = element.parentElement) {
      if (element === this) return true;
    }
    return false;
  }
}

function makeSelectedTag(tag) {
  const button = new FakeElement("button", `#${tag}`);
  button.appendChild(new FakeElement("span", "", { "aria-label": "削除" }));
  return button;
}

function createPage(pathname, { immediateTagData } = {}) {
  const documentElement = new FakeElement("html");
  const body = documentElement.appendChild(new FakeElement("body"));
  const document = {
    documentElement,
    body,
    querySelectorAll: (selector) => documentElement.querySelectorAll(selector)
  };
  const location = {
    protocol: "https:",
    hostname: "editor.note.com",
    pathname,
    href: `https://editor.note.com${pathname}`
  };
  const listeners = new Map();
  const pendingFrames = [];
  const pendingTimers = new Map();
  const pendingTagData = [];
  const messageListeners = [];
  const messages = [];
  let nextTimerId = 0;
  let observer;
  let observerOptions;

  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      observer = this;
    }

    observe(_target, options) {
      observerOptions = options;
    }
  }

  const window = {
    addEventListener(type, listener) {
      const callbacks = listeners.get(type) ?? [];
      callbacks.push(listener);
      listeners.set(type, callbacks);
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) ?? []) listener(event);
      return true;
    }
  };
  const chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener: (listener) => messageListeners.push(listener) },
      sendMessage(message, callback) {
        messages.push(message.type);
        if (message.type === "GET_TAG_DATA" && callback) {
          if (immediateTagData) callback({ tagData: immediateTagData });
          else pendingTagData.push(callback);
        }
      }
    }
  };
  const context = vm.createContext({
    Node: { ELEMENT_NODE: 1 },
    MutationObserver: FakeMutationObserver,
    chrome,
    clearTimeout: (id) => pendingTimers.delete(id),
    document,
    location,
    requestAnimationFrame: (callback) => pendingFrames.push(callback),
    setTimeout: (callback) => {
      const id = ++nextTimerId;
      pendingTimers.set(id, callback);
      return id;
    },
    window
  });

  function startContentScript() {
    vm.runInContext(contentSource, context, { filename: "content.js" });
  }

  function flushFrames() {
    while (pendingFrames.length) pendingFrames.shift()();
  }

  function flushTimers() {
    while (pendingTimers.size) {
      const [id, callback] = pendingTimers.entries().next().value;
      pendingTimers.delete(id);
      callback();
    }
  }

  function deliverTagData(tags) {
    const callback = pendingTagData.shift();
    assert.ok(callback, "expected a pending GET_TAG_DATA response");
    callback({ tagData: { tags } });
  }

  function reportMutation({ target = body, addedNodes = [], removedNodes = [] } = {}) {
    assert.ok(observer, "content script must install a MutationObserver");
    observer.callback([{ target, addedNodes, removedNodes }]);
  }

  return {
    body,
    chrome,
    deliverTagData,
    flushFrames,
    flushTimers,
    location,
    messages,
    observerOptions: () => observerOptions,
    pendingTimerCount: () => pendingTimers.size,
    notifyRouteChanged: () => messageListeners.forEach((listener) => listener(
      { type: "SPA_ROUTE_CHANGED" },
      {},
      () => {}
    )),
    reportMutation,
    setPathname: (pathname) => {
      location.pathname = pathname;
      location.href = `https://editor.note.com${pathname}`;
    },
    startContentScript
  };
}

test("activates when the browser reports a SPA URL change after its DOM update", () => {
  const page = createPage("/notes/example/edit");
  page.startContentScript();

  const selectedTag = makeSelectedTag("スキしてみて");
  page.body.appendChild(selectedTag);
  page.reportMutation({ addedNodes: [selectedTag] });
  assert.equal(page.messages.includes("GET_TAG_DATA"), false);

  page.setPathname("/notes/example/publish/");
  page.notifyRouteChanged();
  assert.equal(page.messages.filter((message) => message === "GET_TAG_DATA").length, 1);
  page.flushFrames();
  page.deliverTagData(["スキしてみて"]);
  page.flushFrames();

  assert.equal(selectedTag.classList.contains("note-contest-tag-highlighter-match"), true);
});

test("handles a route notification before the tag DOM is rendered", () => {
  const page = createPage("/notes/example/edit");
  page.startContentScript();

  page.setPathname("/notes/example/publish/");
  page.notifyRouteChanged();
  assert.equal(page.messages.filter((message) => message === "GET_TAG_DATA").length, 1);

  const selectedTag = makeSelectedTag("スキしてみて");
  page.body.appendChild(selectedTag);
  page.reportMutation({ addedNodes: [selectedTag] });
  page.deliverTagData(["スキしてみて"]);
  page.flushTimers();
  page.flushFrames();

  assert.equal(selectedTag.classList.contains("note-contest-tag-highlighter-match"), true);
});

test("does not initialize the content script twice in the same page", () => {
  const page = createPage("/notes/example/publish/", {
    immediateTagData: { tags: ["スキしてみて"] }
  });
  page.startContentScript();
  page.startContentScript();

  assert.equal(page.messages.filter((message) => message === "GET_TAG_DATA").length, 1);
});

test("deactivates when the SPA navigates away from the publish route", () => {
  const page = createPage("/notes/example/edit");
  page.startContentScript();

  page.setPathname("/notes/example/publish/");
  page.notifyRouteChanged();
  page.deliverTagData(["スキしてみて"]);
  page.flushFrames();
  const selectedTag = makeSelectedTag("スキしてみて");
  page.body.appendChild(selectedTag);
  page.reportMutation({ addedNodes: [selectedTag] });
  page.flushTimers();
  page.flushFrames();
  assert.equal(selectedTag.classList.contains("note-contest-tag-highlighter-match"), true);

  page.setPathname("/notes/example/edit");
  page.notifyRouteChanged();
  assert.equal(selectedTag.classList.contains("note-contest-tag-highlighter-match"), false);
});

test("reapplies after tag data arrives when the tag DOM already exists", () => {
  const page = createPage("/notes/example/publish/");
  const selectedTag = makeSelectedTag("スキしてみて");
  page.body.appendChild(selectedTag);
  page.startContentScript();

  page.flushFrames();
  assert.equal(selectedTag.classList.contains("note-contest-tag-highlighter-match"), false);
  page.deliverTagData(["スキしてみて"]);
  page.flushFrames();

  assert.equal(selectedTag.classList.contains("note-contest-tag-highlighter-match"), true);
});

test("reapplies after tag elements arrive when tag data is already loaded", () => {
  const page = createPage("/notes/example/publish/", {
    immediateTagData: { tags: ["スキしてみて"] }
  });
  page.startContentScript();
  page.flushFrames();

  const suggestion = new FakeElement("li", "#スキしてみて 1,234件");
  page.body.appendChild(suggestion);
  page.reportMutation({ addedNodes: [suggestion] });
  page.flushTimers();
  page.flushFrames();

  assert.equal(suggestion.classList.contains("note-contest-tag-highlighter-match"), true);
});

test("highlights existing tags on a direct publish-page load", () => {
  const page = createPage("/notes/example/publish/", {
    immediateTagData: { tags: ["スキしてみて"] }
  });
  const selectedTag = makeSelectedTag("スキしてみて");
  page.body.appendChild(selectedTag);
  page.startContentScript();
  page.flushFrames();

  assert.equal(selectedTag.classList.contains("note-contest-tag-highlighter-match"), true);
});

test("leaves non-target pages and non-target tags unhighlighted", () => {
  const outsidePage = createPage("/notes/example/edit", {
    immediateTagData: { tags: ["スキしてみて"] }
  });
  const outsideTag = makeSelectedTag("スキしてみて");
  outsidePage.body.appendChild(outsideTag);
  outsidePage.startContentScript();
  outsidePage.reportMutation({ addedNodes: [outsideTag] });
  outsidePage.flushFrames();
  assert.equal(outsideTag.classList.contains("note-contest-tag-highlighter-match"), false);

  const publishPage = createPage("/notes/example/publish/", {
    immediateTagData: { tags: ["スキしてみて"] }
  });
  const unrelatedSuggestion = new FakeElement("li", "#test 12件");
  publishPage.body.appendChild(unrelatedSuggestion);
  publishPage.startContentScript();
  publishPage.reportMutation({ addedNodes: [unrelatedSuggestion] });
  publishPage.flushTimers();
  publishPage.flushFrames();
  assert.equal(unrelatedSuggestion.classList.contains("note-contest-tag-highlighter-match"), false);
});

test("coalesces relevant mutations and ignores unrelated DOM churn", () => {
  const page = createPage("/notes/example/publish/", {
    immediateTagData: { tags: ["スキしてみて"] }
  });
  page.startContentScript();
  page.flushFrames();
  assert.equal(page.observerOptions().attributes, undefined);

  const unrelated = new FakeElement("div", "Ordinary page content");
  page.body.appendChild(unrelated);
  page.reportMutation({ addedNodes: [unrelated] });
  assert.equal(page.pendingTimerCount(), 0);

  const first = new FakeElement("li", "#スキしてみて 1件");
  const second = new FakeElement("li", "#スキしてみて 2件");
  page.body.appendChild(first);
  page.body.appendChild(second);
  page.reportMutation({ addedNodes: [first] });
  page.reportMutation({ addedNodes: [second] });
  assert.equal(page.pendingTimerCount(), 1);
  page.flushTimers();
  page.flushFrames();
  assert.equal(page.pendingTimerCount(), 0);
});
