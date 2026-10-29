#!/bin/sh
set -eu

extension_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
version=$(python3 - "$extension_dir/manifest.json" <<'PY'
import json
import sys
from pathlib import Path

print(json.loads(Path(sys.argv[1]).read_text())["version"])
PY
)
output_dir="$extension_dir/dist"
archive="$output_dir/note-contest-tag-highlighter-v$version.zip"

mkdir -p "$output_dir"
rm -f "$archive"
(
  cd "$extension_dir"
  zip -q -r "$archive" manifest.json _locales/ja/messages.json icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png src styles/highlight.css
)

printf '%s\n' "$archive"
