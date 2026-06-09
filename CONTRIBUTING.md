# Contributing to becuz

Thanks for your interest in improving **becuz**! This project is MIT-licensed
and contributions of all kinds — bug reports, docs, features — are welcome.

## Getting started

```bash
git clone https://github.com/mickymultani/becuz.git
cd becuz
npm install
```

Useful scripts:

| Command | What it does |
|---|---|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run typecheck` | Type-check without emitting |
| `npm run server` | Run the MCP server from source (via `tsx`) |
| `node scripts/smoke.mjs` | End-to-end stdio smoke test (record → query → supersede) |

Before opening a PR, please make sure this passes:

```bash
npm run typecheck && npm run build && node scripts/smoke.mjs
```

CI runs the same on Node 18, 20, and 22.

## Project layout

```
src/
  schema.ts      Zod schemas (Decision Record, index, config) — the data contract
  store.ts       JSON store: read/write records + index maintenance
  git.ts         git evidence capture + code-comment scanner
  decisions.ts   core logic: create / supersede / update / deprecate / query / list
  index.ts       MCP server (stdio) — wires the 7 tools
  cli.ts         CLI entry: serve / init / guidance / rebuild-index / version
  mcpconfig.ts   writes OS-correct MCP config for Claude / Cursor / Codex
  guidance.ts    the agent-guidance snippet (CLAUDE.md / AGENTS.md)
  version.ts     resolves the version from package.json
scripts/
  smoke.mjs        stdio MCP roundtrip test
  sync-version.mjs mirrors package.json version into the VERSION file
```

## Guidelines

- **Match the surrounding style** — TypeScript, ESM imports with `.js`
  extensions, `strict` mode. Keep functions small and readable.
- **Schema changes are contracts.** If you change a decision record's shape,
  bump `SCHEMA_VERSION` and describe the migration in your PR.
- **Records are never deleted.** Preserve the supersede/deprecate semantics —
  history is the whole point of the product.
- **Keep it dependency-light.** The MVP intentionally avoids heavy deps.
- Keep PRs focused; one logical change per PR is easier to review.

## We dogfood becuz

This repo uses becuz on itself (see `CLAUDE.md`). If your PR makes a meaningful
architectural, dependency, or API decision, record it so the reasoning lands in
`.becuz/` alongside the diff.

## Reporting bugs / requesting features

Open an issue using the templates. For bugs, include your Node version, the
agent/MCP client you're using, and steps to reproduce.

## License

By contributing, you agree that your contributions will be licensed under the
project's [MIT License](LICENSE).
