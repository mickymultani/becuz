# Changelog

All notable changes to this project are documented here.

## 0.1.1

- Now published via GitHub Actions **OIDC trusted publishing**, so releases carry
  signed npm provenance ("Built and signed on GitHub Actions").
- CI: the publish workflow skips any version already on npm (safe re-tagging).
- Docs: removed a stale reference and tidied the project layout.

## 0.1.0

First release.

- stdio MCP server built on the official `@modelcontextprotocol/sdk`.
- `.becuz/` JSON decision store: `config.json`, `index.json`, and one file per
  decision under `decisions/`.
- Seven tools: `record_decision`, `supersede_decision`, `update_decision`,
  `deprecate_decision`, `query_decisions`, `get_decision`, `list_decisions`.
- Automatic git evidence capture (branch / commit / working diff) and
  language-aware code-comment scanning.
- `becuz://index` MCP resource.
- `init` sets up everything in one command: the store, the agent guidance, and
  the **OS-correct MCP config** (no hand-editing, works on macOS/Linux/Windows).
  Configures **Claude Code** (`.mcp.json`), **Cursor** (`.cursor/mcp.json`), or
  **Codex CLI** (`~/.codex/config.toml`) via `--client claude|cursor|codex|all`,
  routing guidance to the right file (`CLAUDE.md` or `AGENTS.md`) and merging
  into existing config without disturbing other servers.
- CLI: `serve`, `init` (`--client`, `--no-mcp`), `guidance`, `rebuild-index`,
  `version`.
- Zod-validated schema (`schema_version = 1`) and the agent-guidance snippet.
