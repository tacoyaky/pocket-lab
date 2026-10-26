(() => {
  const PUBLISH_PATH = /^\/notes\/[^/]+\/publish\/$/;
  const TAG_CANDIDATE_SELECTORS = "button, [role='option'], [role='button'], li, div";
  const MAX_TAG_CANDIDATE_TEXT_LENGTH = 180;
  const MUTATION_APPLY_DEBOUNCE_MS = 60;
  if (location.protocol !== "https:" || location.hostname !== "editor.note.com" || !location.pathname.startsWith("/notes/")) return;
  const INSTANCE_KEY = "__noteContestTagHighlighterInitialized";
  if (window[INSTANCE_KEY]) return;
  window[INSTANCE_KEY] = true;

  let targetTags = new Set();
  let sortedTargetTags = [];
  let trackedTagElements = new Set();
  let scheduled = false;
  let mutationApplyTimer;
  let active = false;

  // Watch for tag-related DOM changes; the service worker reports SPA history updates.
  const observer = new MutationObserver((mutations) => {
    const wasActive = active;
    syncRoute();
    if (active && wasActive && hasRelevantMutation(mutations)) scheduleMutationApply();
  });
  observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });

  window.addEventListener("popstate", syncRoute);
  window.addEventListener("hashchange", syncRoute);
  syncRoute();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "SPA_ROUTE_CHANGED") {
      const wasActive = active;
      syncRoute();
      if (active && wasActive) {
        scheduleApply();
      }
      sendResponse({ handled: true });
      return;
    }
    if (message?.type === "TAG_DATA_UPDATED" && active) loadTagData();
  });

  function syncRoute() {
    const shouldBeActive = PUBLISH_PATH.test(location.pathname);
    if (shouldBeActive === active) return;

    active = shouldBeActive;
    if (active) {
      loadTagData();
      chrome.runtime.sendMessage({ type: "PAGE_READY" });
      scheduleApply();
    } else {
      clearTimeout(mutationApplyTimer);
      mutationApplyTimer = undefined;
      targetTags = new Set();
      sortedTargetTags = [];
      trackedTagElements = new Set();
      for (const element of document.querySelectorAll(".note-contest-tag-highlighter-match")) {
        element.classList.remove("note-contest-tag-highlighter-match");
      }
    }
  }

  function loadTagData() {
    chrome.runtime.sendMessage({ type: "GET_TAG_DATA" }, (response) => {
      if (chrome.runtime.lastError || !active) return;
      setTagData(response?.tagData);
    });
  }

  function setTagData(data) {
    targetTags = new Set(Array.isArray(data?.tags) ? data.tags.map(normalizeTag).filter(Boolean) : []);
    sortedTargetTags = [...targetTags].sort((left, right) => right.length - left.length);
    scheduleApply();
  }

  function hasRelevantMutation(mutations) {
    for (const mutation of mutations) {
      if (isTrackedTagNode(mutation.target)) return true;
      for (const node of mutation.addedNodes) {
        if (containsRelevantTagCandidate(node)) return true;
      }
      for (const node of mutation.removedNodes) {
        if (containsTrackedTagNode(node)) return true;
      }
    }
    return false;
  }

  function containsTrackedTagNode(node) {
    if (isTrackedTagNode(node) || containsHighlightedNode(node)) return true;
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    for (const element of trackedTagElements) {
      if (node.contains(element)) return true;
    }
    return false;
  }

  function isTrackedTagNode(node) {
    let element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    while (element) {
      if (trackedTagElements.has(element)) return true;
      element = element.parentElement;
    }
    return false;
  }

  function containsHighlightedNode(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    return node.matches(".note-contest-tag-highlighter-match") ||
      Boolean(node.querySelector(".note-contest-tag-highlighter-match"));
  }

  function containsRelevantTagCandidate(node) {
    let root = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!root) return false;

    for (let depth = 0; root && depth < 7; depth += 1, root = root.parentElement) {
      if (isRelevantTagCandidate(root)) return true;
    }

    if (node.nodeType === Node.TEXT_NODE) return false;
    if (isRelevantTagCandidate(node)) return true;
    return [...node.querySelectorAll(TAG_CANDIDATE_SELECTORS)].some(isRelevantTagCandidate);
  }

  function isRelevantTagCandidate(element) {
    if (element.nodeType !== Node.ELEMENT_NODE || !element.matches(TAG_CANDIDATE_SELECTORS)) return false;
    if (element.matches("button") && getButtonLabel(element)) return true;
    const text = element.innerText || element.textContent || "";
    return text.length <= MAX_TAG_CANDIDATE_TEXT_LENGTH && Boolean(getSuggestionTag(element, text));
  }

  function scheduleApply() {
    if (!active || scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      applyHighlighting();
    });
  }

  function scheduleMutationApply() {
    clearTimeout(mutationApplyTimer);
    mutationApplyTimer = setTimeout(() => {
      mutationApplyTimer = undefined;
      scheduleApply();
    }, MUTATION_APPLY_DEBOUNCE_MS);
  }

  function applyHighlighting() {
    if (!active) return;
    const buttons = [...document.querySelectorAll("button"), ...document.querySelectorAll(".note-contest-tag-highlighter-match")];
    const hashtagButtons = [...new Set(buttons)].filter((button) => getButtonLabel(button));
    const selectedTagButtons = hashtagButtons.filter((button) => button.querySelector('[aria-label="削除"]'));
    const candidateTagButtons = hashtagButtons.filter((button) => !selectedTagButtons.includes(button) && isCandidateTagButton(button));
    const eligibleTagButtons = new Set([...selectedTagButtons, ...candidateTagButtons]);

    const suggestionItems = findSuggestionItems();
    trackedTagElements = new Set([...eligibleTagButtons, ...suggestionItems.keys()]);
    const highlightedElements = new Set([...eligibleTagButtons, ...suggestionItems.keys()]);
    for (const element of document.querySelectorAll(".note-contest-tag-highlighter-match")) {
      if (!highlightedElements.has(element)) element.classList.remove("note-contest-tag-highlighter-match");
    }
    for (const button of buttons) {
      const label = getButtonLabel(button);
      const normalized = label ? normalizeTag(label) : "";
      const inTagArea = eligibleTagButtons.has(button);
      button.classList.toggle("note-contest-tag-highlighter-match", inTagArea && targetTags.has(normalized));
    }
    for (const [element, tag] of suggestionItems) {
      element.classList.toggle("note-contest-tag-highlighter-match", targetTags.has(tag));
    }
  }

  function findSuggestionItems() {
    const matches = new Map();
    for (const element of document.querySelectorAll(TAG_CANDIDATE_SELECTORS)) {
      const text = element.innerText || element.textContent || "";
      if (text.length > MAX_TAG_CANDIDATE_TEXT_LENGTH) continue;
      const tag = getSuggestionTag(element, text);
      if (tag) matches.set(element, tag);
    }

    const ancestorsWithMatches = new Set();
    for (const [element, tag] of matches) {
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (matches.get(ancestor) === tag) ancestorsWithMatches.add(ancestor);
      }
    }

    const items = new Map();
    for (const [element, tag] of matches) {
      if (!ancestorsWithMatches.has(element)) items.set(element, tag);
    }
    return items;
  }

  function getSuggestionTag(element, rawText = element.innerText || element.textContent || "") {
    const text = rawText.replace(/\s+/g, " ").trim();
    if (!text.startsWith("#")) return null;

    for (const tag of sortedTargetTags) {
      if (!text.startsWith(`#${tag}`)) continue;
      const suffix = text.slice(tag.length + 1).trim();
      if (/^(?:[\d,]+|[\d.]+万)(?:件)?$/.test(suffix)) return tag;
      if (suffix === "" && element.matches("button, [role='option'], [role='button'], li")) return tag;
    }
    return null;
  }

  function isCandidateTagButton(button) {
    let container = button.parentElement;
    for (let depth = 0; container && depth < 6; depth += 1, container = container.parentElement) {
      const groupButtons = [...container.querySelectorAll("button")];
      const groupTagButtons = groupButtons.filter((candidate) => getButtonLabel(candidate));
      if (groupTagButtons.length >= 2 && groupTagButtons.includes(button)) return true;
    }
    return false;
  }

  function getButtonLabel(button) {
    if (button.disabled || button.getAttribute("aria-hidden") === "true") return null;
    const text = (button.innerText || button.textContent || "").trim();
    return /^#[^\s#]+(?:\s+[^\s#]+)*$/.test(text) ? text : null;
  }

  function normalizeTag(value) {
    return typeof value === "string" ? value.trim().replace(/^#/, "").trim() : "";
  }
})();
