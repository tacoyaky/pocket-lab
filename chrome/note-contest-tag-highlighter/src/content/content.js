(() => {
  const PUBLISH_PATH = /^\/notes\/[^/]+\/publish\/$/;
  if (location.protocol !== "https:" || location.hostname !== "editor.note.com" || !PUBLISH_PATH.test(location.pathname)) return;

  let targetTags = new Set();
  let scheduled = false;

  chrome.runtime.sendMessage({ type: "GET_TAG_DATA" }, (response) => {
    if (chrome.runtime.lastError) return;
    setTagData(response?.tagData);
  });
  chrome.runtime.sendMessage({ type: "PAGE_READY" });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "TAG_DATA_UPDATED") {
      chrome.runtime.sendMessage({ type: "GET_TAG_DATA" }, (response) => {
        if (chrome.runtime.lastError) return;
        setTagData(response?.tagData);
      });
    }
  });

  const observer = new MutationObserver(scheduleApply);
  observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });

  function setTagData(data) {
    targetTags = new Set(Array.isArray(data?.tags) ? data.tags.map(normalizeTag).filter(Boolean) : []);
    scheduleApply();
  }

  function scheduleApply() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      applyHighlighting();
    });
  }

  function applyHighlighting() {
    const buttons = [...document.querySelectorAll("button"), ...document.querySelectorAll(".note-contest-tag-highlighter-match")];
    const hashtagButtons = [...new Set(buttons)].filter((button) => getButtonLabel(button));
    const selectedTagButtons = hashtagButtons.filter((button) => button.querySelector('[aria-label="削除"]'));
    const candidateTagButtons = hashtagButtons.filter((button) => !selectedTagButtons.includes(button) && isCandidateTagButton(button));
    const eligibleTagButtons = new Set([...selectedTagButtons, ...candidateTagButtons]);

    const suggestionItems = findSuggestionItems();
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
    const items = new Map();
    const selectors = "button, [role='option'], [role='button'], li, div";
    for (const element of document.querySelectorAll(selectors)) {
      const tag = getSuggestionTag(element);
      if (!tag) continue;

      const hasMatchingDescendant = [...element.querySelectorAll("*")].some((descendant) => getSuggestionTag(descendant) === tag);
      if (!hasMatchingDescendant) items.set(element, tag);
    }
    return items;
  }

  function getSuggestionTag(element) {
    const text = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
    if (!text.startsWith("#")) return null;

    const tagsByLength = [...targetTags].sort((left, right) => right.length - left.length);
    for (const tag of tagsByLength) {
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
