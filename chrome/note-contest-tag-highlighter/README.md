# note Contest Tag Highlighter

This Chrome extension highlights contest and theme tags on the note.com publish page. It uses Manifest V3.

## Load the extension in Chrome

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Select **Load unpacked** and choose this directory.

## Use the extension

Open `https://editor.note.com/notes/<article-id>/publish/`. The extension marks selected tags and suggestion tags that exactly match its tag data in green.

The extension saves tag data on your device and updates it every 24 hours. If the first data request fails, it tries again each time you open a target page. The popup shows the data status, last update time, and number of tags. You can also start an update from the popup.

## Tag data and safe handling

The extension reads contest tags and tags from the **Find a theme to write about** section as separate groups. It removes duplicate tags before use.

Each contest name shown on `/contests` is treated as a current tag. The extension does not check contest pages that have ended.

If the extension cannot find the expected headings or tag names, or if many theme tags are missing, it does not save the new data. It keeps the last data that it read successfully.

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
