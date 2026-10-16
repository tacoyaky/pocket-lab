# AGENTS.md

## Repository purpose

This repository contains small personal tools, extensions, and experiments for everyday use.

## General guidance

- Keep each tool in its own directory.
- Keep tool-specific dependencies, configuration, and documentation with that tool.
- Add or update a tool's README with its purpose, setup, and usage instructions.
- Before changing files, inspect the relevant tool's structure and follow its existing conventions.
- Keep changes scoped to the requested tool. Check for effects on other tools before changing shared files.
- Do not commit API keys, tokens, personal data, or machine-specific settings.
  Keep local configuration out of version control.
- Check the licenses of third-party code and dependencies before adding them.

## Tool-specific instructions

Follow any `AGENTS.md` files inside a tool's directory in addition to these repository-wide instructions.

## Branch structure

```text
main       Production branch. Keep it in a releasable state at all times.
staging    Pre-release review branch for team members and the fixed Vercel Preview environment.
feature/*  New feature development.
news/*     Adding or updating announcement posts.
page/*     Adding or updating static pages.
fix/*      Bug fixes.
style/*    Visual and layout changes.
chore/*    Configuration, dependency, and maintenance work.
docs/*     Documentation changes, such as README updates.
hotfix/*   Urgent fixes for the production environment.
```

## Branch name format

- Use lowercase English letters and hyphens.
- Do not use Japanese characters, spaces, or underscores.
- Keep names short and descriptive of the work.
- If a date is included, use the `YYYYMMDD` format (for example, `20260815`).
- Include an issue number when appropriate.
