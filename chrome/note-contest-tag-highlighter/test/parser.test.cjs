const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const parserSource = readFileSync(join(__dirname, "../src/background/parser.js"), "utf8");

function decodeHtmlAttribute(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (entity, token) => {
    if (token[0] === "#") {
      const number = token[1].toLowerCase() === "x"
        ? Number.parseInt(token.slice(2), 16)
        : Number.parseInt(token.slice(1), 10);
      return String.fromCodePoint(number);
    }
    return ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" })[token.toLowerCase()];
  });
}

class FixtureDOMParser {
  parseFromString(html) {
    const anchors = [...html.matchAll(/<a\b([^>]*)>/gi)].map(([, rawAttributes]) => {
      const attributes = new Map();
      for (const match of rawAttributes.matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
        attributes.set(match[1].toLowerCase(), decodeHtmlAttribute(match[2] ?? match[3] ?? match[4]));
      }
      return { getAttribute: (name) => attributes.get(name) ?? null };
    });
    return { querySelectorAll: () => anchors };
  }
}

function extractTags(html) {
  let result;
  const chrome = {
    runtime: {
      onMessage: {
        addListener(listener) {
          listener({ type: "PARSE_SOURCE_HTML", html }, {}, (response) => { result = response; });
        }
      }
    }
  };
  vm.runInNewContext(parserSource, { DOMParser: FixtureDOMParser, URL, chrome });
  return result;
}

test("extracts and deduplicates contest names and URLs without relying on page sections", () => {
  const result = extractTags(`
    <main>
      <a title="#ignored" aria-label="#わたしの旅行記" href="https://note.com/contest/%E3%82%8F%E3%81%9F%E3%81%97%E3%81%AE%E6%97%85%E8%A1%8C%E8%A8%98?f=popular"></a>
      <section><a href='/contest/スキしてみて?f=popular' aria-label='#スキしてみて'></a></section>
      <a aria-label="#スキしてみて" href="/contest/duplicate?f=popular"></a>
      <a href="https://example.com/contest/external" aria-label="#external"></a>
      <a href="/articles/not-a-contest" aria-label="#article"></a>
      <a href="/contest/missing-label"></a>
      <a href="/contest/missing-name" aria-label="Contest"></a>
    </main>
  `);

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    tags: [
      { name: "わたしの旅行記", url: "https://note.com/contest/%E3%82%8F%E3%81%9F%E3%81%97%E3%81%AE%E6%97%85%E8%A1%8C%E8%A8%98?f=popular" },
      { name: "スキしてみて", url: "https://note.com/contest/%E3%82%B9%E3%82%AD%E3%81%97%E3%81%A6%E3%81%BF%E3%81%A6?f=popular" }
    ]
  });
});

test("decodes HTML entities in aria-label and href attributes", () => {
  const result = extractTags(`<a href='/contest/guide?f=popular&amp;sort=hot' aria-label='#Tom &amp; Jerry'></a>`);

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    tags: [{ name: "Tom & Jerry", url: "https://note.com/contest/guide?f=popular&sort=hot" }]
  });
});

test("returns an empty list when there are no qualifying links", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(extractTags(`<h2>Anything</h2><a href='/article' aria-label='#not-a-contest'></a>`))), { tags: [] });
});
