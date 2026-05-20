# Repository Guidelines

## Project Structure & Module Organization

Streamline is a Python-backed Steam Workshop downloader with a browser UI and an Electron shell.

- `downloader.py` contains the main desktop API wrapper.
- `web_backend.py` contains queue, Workshop scraping, settings, and download logic.
- `electron_backend.py` exposes the Python API to Electron over a local HTTP bridge.
- `electron/` contains Electron main/preload code.
- `Files/webui/` contains the HTML, CSS, and browser-side JavaScript.
- `Files/` also contains assets, requirements, config, logs, and SteamCMD runtime data.
- `tests/` is currently ignored/local-only unless explicitly added.

## Build, Test, and Development Commands

- `python downloader.py` runs the original Python/pywebview app.
- `npm run dev` runs the Electron shell in development mode.
- `npm run check:electron` checks Electron `main.js` and `preload.js` syntax.
- `node --check Files\webui\app.js` checks renderer JavaScript syntax.
- `python -m py_compile web_backend.py downloader.py electron_backend.py` checks Python syntax.

Run the relevant checks after code changes, especially when touching API, Electron, or `Files/webui/`.

## Coding Style & Naming Conventions

Use existing style in nearby files. Python uses 4-space indentation and snake_case functions. JavaScript uses `const`/`let`, camelCase functions, and DOM IDs/classes that match existing UI naming. Keep CSS class names descriptive and scoped to the feature, for example `.browse-status-row` or `.queue-list-section`.

Avoid broad refactors in unrelated areas. Preserve existing behavior unless the change requires it.

## Testing Guidelines

There is no formal test suite configured in this repo. Use syntax checks and targeted manual UI verification. For frontend changes, verify the affected flow in the running app and check for console errors, blank UI, layout overlap, and broken controls. For backend changes, prefer the Python compile check plus a real API/UI flow when practical.

## Commit & Pull Request Guidelines

Recent commits use short imperative or descriptive subjects, for example `Update README.md` and `fix Linux account selector avatars by inlining avatars as data URLs`. Keep subjects concise and focused.

PRs should include:

- A clear summary of user-visible changes.
- Verification commands run and results.
- Screenshots or short notes for UI changes.
- Linked issues when applicable.
- Any caveats, skipped tests, or platform-specific risks.

## Security & Configuration Tips

Do not commit `Files/config.json`, `Files/steamcmd/`, `Downloads/`, `node_modules/`, `venv/`, logs, or local cache folders. Avoid adding secrets, tokens, account credentials, or machine-specific paths to tracked files.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Streamline-Workshop-Downloader** (2359 symbols, 5143 relationships, 213 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/Streamline-Workshop-Downloader/context` | Codebase overview, check index freshness |
| `gitnexus://repo/Streamline-Workshop-Downloader/clusters` | All functional areas |
| `gitnexus://repo/Streamline-Workshop-Downloader/processes` | All execution flows |
| `gitnexus://repo/Streamline-Workshop-Downloader/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
