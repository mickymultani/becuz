# becuz

[![npm version](https://img.shields.io/npm/v/becuz.svg)](https://www.npmjs.com/package/becuz)
[![npm downloads](https://img.shields.io/npm/dm/becuz.svg)](https://www.npmjs.com/package/becuz)
[![CI](https://github.com/mickymultani/becuz/actions/workflows/ci.yml/badge.svg)](https://github.com/mickymultani/becuz/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/node/v/becuz.svg)](https://www.npmjs.com/package/becuz)

**Record _why_ decisions are made during AI-assisted coding — _becuz_ the reasoning shouldn't die in a chat log.**

`becuz` is an agent-agnostic [MCP](https://modelcontextprotocol.io) server. When
you and a coding agent (Claude Code, Cursor, Copilot-via-MCP, …) settle a
meaningful decision — a library choice, a schema, an API shape, an infra call —
the agent records it through becuz. Each decision is stored as a clean,
versioned JSON record that lives in your repo, correlated with the conversation
reasoning, the git diff, and any related code comments — **without cluttering
your source files**.

Months later you (or a new teammate) can ask _"why did we pick Postgres?"_ and
get the real answer, including the alternatives that were rejected.

![becuz records a decision as you code, then answers "why did we…?" later](assets/demo.svg)

> The demo above is an animated SVG and plays on GitHub. (Source: [assets/demo.cast](assets/demo.cast).)

---

## Why

The reasoning behind decisions usually leaks into three lossy places: inline
comments (clutter, decay), commit messages (terse, disconnected), and the agent
chat transcript (ephemeral, unsearchable). becuz captures decisions as
first-class, structured, versioned artifacts instead.

## Setup

Requires **Node ≥ 18**. Works on **macOS, Linux, and Windows**.

There are two steps: **(1) initialize**, then **(2) connect your agent**. The only
thing that differs between macOS and Windows is the launch command — and `init`
handles that for you.

### Step 1 — Run `init` for your agent

In your project root, run **one** of these. `init` creates the `.becuz/` store,
drops the guidance into the right instructions file, **and writes the OS-correct
MCP config for you** (`npx` on macOS/Linux, `cmd /c npx` on Windows — you never
have to know the difference, and there's nothing to hand-edit):

```bash
npx -y becuz init                    # Claude Code (default)
npx -y becuz init --client cursor    # Cursor
npx -y becuz init --client codex     # Codex CLI
npx -y becuz init --client all       # all three
```

| Agent | What `init` writes | Guidance file |
|---|---|---|
| Claude Code | `./.mcp.json` | `CLAUDE.md` |
| Cursor | `./.cursor/mcp.json` | `AGENTS.md` |
| Codex CLI | `~/.codex/config.toml` | `AGENTS.md` |

It merges into existing config and leaves your other MCP servers untouched.

> **Installing on an existing repo?** `init` is non-destructive — it never
> overwrites your files:
> - **MCP config** (`.mcp.json` / `.cursor/mcp.json` / `config.toml`): becuz is
>   added alongside any servers you already have.
> - **Guidance file** (`CLAUDE.md` / `AGENTS.md`): the snippet is wrapped in
>   `<!-- becuz:begin -->` … `<!-- becuz:end -->` markers. If the file exists, the
>   block is **appended** (your content is preserved); if not, it's created; and
>   re-running **updates just that block** — no duplicates.
>
> Prefer to add the guidance by hand? Run `npx becuz guidance` to print the block
> and paste it into your instructions file yourself, and use `init --no-mcp` to
> skip writing MCP config.

### Step 2 — Reload, then verify

<details open>
<summary><b>Claude Code</b></summary>

**Reload:** VS Code → Command Palette → **Developer: Reload Window** (or restart
the `claude` CLI session). Approve the `becuz` server when prompted.

**Verify:** run **`/mcp`** (or `claude mcp list`) → you should see **becuz** with
7 tools.
</details>

<details>
<summary><b>Cursor</b></summary>

**Reload:** restart Cursor, then open **Settings → Cursor Settings → MCP** and
make sure `becuz` is toggled **on**.

**Verify:** that MCP panel shows `becuz` with a **green dot** and **7 tools** (or
ask Cursor *"list our decisions with becuz"*).
</details>

<details>
<summary><b>Codex CLI</b></summary>

**Reload:** restart `codex`.

**Verify:** run `codex mcp list` (you should see `becuz`), or start `codex` and
ask *"list our decisions with becuz."*
</details>

### Step 3 — Sanity check (works for any agent / OS)

1. **Prove the package runs at all** — independent of any agent config:
   ```bash
   npx -y becuz --version      # prints the version, e.g. 0.1.0
   ```
   If that prints a version, the install is fine and any remaining issue is just
   the agent's config path or a missing reload.
2. **Prove the agent sees it** — ask your agent: *"Record a decision with becuz:
   we chose X over Y because Z,"* then confirm a new file appeared in
   `.becuz/decisions/`. Ask *"why did we choose X?"* and it should answer from the
   record.

### Troubleshooting

| Symptom | Fix |
|---|---|
| Agent shows **no becuz tools** | You didn't reload/restart the agent after adding the config. MCP servers load at startup. |
| **Windows:** server shows **"failed"** | You used bare `npx`. Use the `cmd /c` variant (for Claude Code, just re-run `npx -y becuz init`). |
| `npx -y becuz --version` **fails** | Node isn't installed or is < 18, or no network for the first `npx` fetch. |
| Cursor server is **greyed out** | Toggle it **on** in Settings → MCP. |

### Sharing with your team

- **Solo / single-OS team:** commit `.mcp.json` (Claude) or `.cursor/mcp.json`
  (Cursor) and everyone inherits it.
- **Mixed macOS/Windows team:** the launch command is OS-specific — `.gitignore`
  the config file and have each teammate run `npx -y becuz init` (Claude) or paste
  their OS's block (Cursor/Codex). Always commit `.becuz/` and `CLAUDE.md`.

## How it works

An MCP server can't passively eavesdrop on your conversation — the agent decides
when to call tools. So becuz exposes **tools the agent is instructed to call**
when a decision is reached (via the guidance snippet `init` installs), and the
server gathers the diff/comment evidence automatically at that moment.

```
Agent reaches a decision ──▶ calls record_decision(...)
                                      │
                                      ▼
                          becuz MCP server
                          • captures branch/HEAD/working diff
                          • scans referenced files for comments
                          • assigns DR-id, status=active
                          • writes .becuz/decisions/DR-XXXX.json
                          • updates index.json
```

## MCP tools

| Tool | Purpose |
|---|---|
| `record_decision` | Log a new decision; auto-captures git diff + code comments. |
| `supersede_decision` | Replace a decision; links both, flips the old to `superseded`. |
| `update_decision` | Edit a record in place; bumps its `version`. |
| `deprecate_decision` | Retire a decision with no replacement (`deprecated`). |
| `query_decisions` | Keyword + filter search; powers "why did we…?". |
| `get_decision` | Fetch one full record by id. |
| `list_decisions` | Browse lightweight index entries. |

A `becuz://index` MCP **resource** also exposes `index.json` directly.

## Storage layout

```
<repo-root>/
└── .becuz/
    ├── config.json        # categories, store path, capture mode, privacy toggles
    ├── index.json         # rolled-up list for fast lookup
    └── decisions/
        ├── DR-0001.json
        └── DR-0002.json
```

Everything is plain JSON, committed to git, and reviewable in PRs. **Records are
never deleted** — the history is the value.

### A decision record

```jsonc
{
  "id": "DR-0007",
  "schema_version": 1,
  "title": "Use PostgreSQL for primary datastore",
  "category": "infrastructure",        // architecture | infrastructure | dependency |
                                       // api | data-model | ui | product | security |
                                       // performance | process | other
  "status": "active",                  // active | superseded | deprecated
  "decision": "Adopt PostgreSQL 16 …",
  "rationale": "Need strong relational integrity …",
  "alternatives_considered": [
    { "option": "MongoDB", "reason_rejected": "Weaker multi-doc transactions." }
  ],
  "consequences": "Adds an ops dependency; requires connection pooling.",
  "tags": ["database", "backend"],
  "evidence": {
    "conversation": { "summary": "…", "excerpt": "…" },
    "diff": { "branch": "main", "base_commit": "…", "head_commit": "…",
              "files_changed": ["prisma/schema.prisma"], "summary": "…" },
    "code_comments": [{ "file": "prisma/schema.prisma", "line": 3, "text": "…" }]
  },
  "version": 1,
  "supersedes": null,
  "superseded_by": null,
  "created_at": "2026-06-08T17:22:31Z",
  "updated_at": "2026-06-08T17:22:31Z",
  "created_by": "claude-code",
  "session_id": "sess_8c2f"
}
```

## Versioning & status

- **Record edits** (`update_decision`) bump the `version` field — same identity.
- **Supersession** (`supersede_decision`) creates a _new_ record, flips the old
  one to `superseded`, and cross-links them (`supersedes` / `superseded_by`).
- **Deprecation** (`deprecate_decision`) retires a decision with no replacement.

```
record_decision ─▶ active ──supersede──▶ superseded
                      │
                      └────deprecate────▶ deprecated
```

## Configuration (`.becuz/config.json`)

| Key | Default | Meaning |
|---|---|---|
| `store_path` | `.becuz` | Where records live. |
| `categories` | (the 11 above) | Allowed categories. |
| `capture_mode` | `inline` | `inline` or `session-summary`. |
| `store_excerpts` | `false` | If true, verbatim conversation excerpts are stored. |
| `capture_git` | `true` | If false, skips git diff capture. |

## CLI

```bash
becuz [serve]        # start the stdio MCP server (default)
becuz init           # create .becuz/ + add guidance to CLAUDE.md
becuz guidance       # print the agent-guidance snippet
becuz rebuild-index  # rebuild index.json from the decision files
```

## Development

```bash
npm install
npm run build      # compile to dist/
npm run server     # run the server from source (tsx)
node scripts/smoke.mjs   # end-to-end stdio smoke test
```

## Releasing (maintainers)

Publishing is automated via GitHub Actions ([.github/workflows/publish.yml](.github/workflows/publish.yml))
using npm **OIDC Trusted Publishing** — no tokens or secrets, and provenance is
signed automatically.

**One-time setup** (on npmjs.com → the `becuz` package → Settings → Trusted
Publisher): add a GitHub Actions publisher for repo `mickymultani/becuz`,
workflow `publish.yml`. That's it — no `NPM_TOKEN` to manage.

**To cut a release:**

```bash
npm version patch        # bumps package.json + creates the vX.Y.Z tag
git push --follow-tags   # pushing the tag triggers the publish workflow
```

The workflow builds, verifies the tag matches `package.json`, and runs
`npm publish` over OIDC. (You can also trigger it manually from the Actions tab.)

## Contributing

Contributions are very welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). The
short version: fork, `npm install`, make your change, `npm run typecheck && npm run build && node scripts/smoke.mjs`,
and open a PR. If your change settles a meaningful design decision, record it
with becuz so the reasoning lands in `.becuz/` alongside the diff.

## Status

v0.1 (MVP). Deferred: VS Code extension, HTTP transport, semantic search,
multi-repo aggregation, Claude Code auto-flush hooks. See `becuz-PRD.md`.

## License

MIT
