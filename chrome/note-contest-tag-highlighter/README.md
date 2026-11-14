# note Contest Tag Highlighter

This Chrome extension highlights contest and theme tags on the note.com publish page. It uses Manifest V3.

## Load the extension in Chrome

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Select **Load unpacked** and choose this directory.

## Use the extension

Open `https://editor.note.com/notes/<article-id>/publish/`. The extension marks selected tags and suggestion tags that exactly match its tag data in green.

On first use, the popup explains the page data the extension handles. Select **Agree and use** before it reads the editor URL or hashtag text. You can withdraw consent from the popup at any time; the extension stops observing the page and removes its highlights.

The extension fetches the public `https://note.com/contests` HTML from its service worker without sending authentication cookies. An offscreen document parses the HTML and collects links whose `aria-label` starts with `#` and whose URL points to a note.com contest page. The tag name and URL are normalized, and repeated names are removed without relying on page headings, categories, or CSS classes.

The extension saves tag data on your device and updates it every 24 hours. If a request fails or the result looks incomplete, the last successful tag list and its update time are kept. If the first data request fails, it tries again each time you open a target page. The popup shows the data status, last update time, and number of tags. You can also start an update from the popup.

## Tag data and safe handling

Each qualifying contest link on `/contests` is treated as a current tag. The extension does not check contest pages that have ended. If a refresh returns no qualifying links, invalid URLs, or fewer than half the number of tags in a substantial previous cache, it does not save the result and logs a warning.

The page structure on note.com may change. If it changes, the data reading and tag detection code may need an update.

## Files and folders

- `manifest.json`: extension settings and permissions
- `src/background/`: update schedule, saved data, and source page parser
- `src/content/`: page checks and tag highlighting
- `src/popup/`: status display and manual update
- `styles/`: highlight styles

## Run tests

Run the extension tests with Node.js:

```sh
node --test test/*.test.cjs
```

## Prepare a Chrome Web Store package

Create a ZIP containing only runtime files:

```sh
./scripts/package.sh
```

See `STORE_LISTING.md` for the listing draft and remaining submission checklist.
