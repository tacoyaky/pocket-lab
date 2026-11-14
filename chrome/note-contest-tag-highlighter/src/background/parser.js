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
  const headings = [...doc.querySelectorAll("h1, h2, h3, h4, h5, h6")];
  const contestsStart = headings.findIndex((heading) => heading.textContent.includes("コンテスト・コラボ企画に参加しよう"));
  const themesStart = headings.findIndex((heading) => heading.textContent.includes("書きたいテーマを探してみよう"));
  if (contestsStart < 0 || themesStart <= contestsStart) throw new Error("Expected source sections were not found");

  const contestsSectionHeadings = headings.slice(contestsStart + 1, themesStart);
  // The source HTML includes the section titles, but card buttons may only be
  // present after note's client-side rendering. The section heading is the
  // stable boundary; every hashtag heading inside it is a listed contest tag.
  const contests = collectHashtags(contestsSectionHeadings);
  if (contests.length === 0) throw new Error("No hashtag titles were found in the contest section");

  const themeLevel = Number(headings[themesStart].tagName.slice(1));
  const themesEnd = headings.findIndex((heading, index) => index > themesStart && Number(heading.tagName.slice(1)) <= themeLevel);
  const themeHeadings = headings.slice(themesStart + 1, themesEnd < 0 ? undefined : themesEnd);
  const categories = [];
  for (const heading of themeHeadings) {
    const level = Number(heading.tagName.slice(1));
    const tag = normalizeTag(heading.textContent);
    if (level === themeLevel + 1 && !tag) categories.push({ tags: [] });
    else if (tag && categories.length > 0) categories[categories.length - 1].tags.push(tag);
  }
  if (categories.length === 0 || categories.some((category) => category.tags.length === 0)) {
    throw new Error("Theme categories were missing or incomplete");
  }

  return {
    contests,
    themes: categories.flatMap((category) => category.tags),
    themeCategoryCount: categories.length,
    themeCategoriesWithTags: categories.filter((category) => category.tags.length > 0).length
  };
}

function collectHashtags(headings) {
  return headings
    .map((heading) => normalizeTag(heading.textContent))
    .filter(Boolean);
}

function normalizeTag(value) {
  const label = value.trim();
  if (!label.startsWith("#")) return null;
  const text = label.slice(1).trim();
  return text && !/[\r\n]/.test(text) ? text : null;
}
