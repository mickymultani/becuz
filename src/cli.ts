#!/usr/bin/env node
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DecisionStore } from "./store.js";
import { GUIDANCE_SNIPPET, GUIDANCE_BEGIN, GUIDANCE_END } from "./guidance.js";
import {
  writeClientConfig,
  ALL_CLIENTS,
  ClientTarget,
} from "./mcpconfig.js";
import { VERSION } from "./version.js";

/**
 * becuz CLI.
 *
 * With no args (or `serve`), it launches the stdio MCP server -- this is what
 * `npx -y becuz` does when an agent spawns it. `init` sets up the store
 * and writes the agent-guidance snippet.
 */

async function runServer(): Promise<void> {
  await import("./index.js");
}

/** Friendly label + reload hint per client, for the init output. */
const CLIENT_INFO: Record<ClientTarget, { label: string; reload: string }> = {
  claude: {
    label: "Claude Code",
    reload: "reload the window (VS Code: 'Developer: Reload Window') or restart the CLI session",
  },
  cursor: {
    label: "Cursor",
    reload: "restart Cursor, then enable becuz in Settings -> MCP",
  },
  codex: {
    label: "Codex CLI",
    reload: "restart codex (verify with `codex mcp list`)",
  },
};

async function init(
  repoRoot: string,
  opts: { clients: ClientTarget[] },
): Promise<void> {
  const store = new DecisionStore(repoRoot);
  await store.init();
  console.log(`Initialized becuz store at ${path.relative(repoRoot, store.storeDir) || "."}/`);
  console.log(`  - config.json`);
  console.log(`  - index.json`);
  console.log(`  - decisions/`);

  // Guidance goes to the instructions file each chosen agent actually reads:
  // Claude Code -> CLAUDE.md; Cursor / Codex -> AGENTS.md.
  for (const file of guidanceFilesFor(opts.clients)) {
    await appendGuidance(repoRoot, file);
  }

  const written: ClientTarget[] = [];
  for (const client of opts.clients) {
    const r = await writeClientConfig(client, repoRoot);
    const verb = r.alreadyHad ? "Refreshed" : r.mergedIntoExisting ? "Updated" : "Wrote";
    console.log(
      `${verb} ${CLIENT_INFO[client].label} config: ${friendlyPath(repoRoot, r.path)}  [${r.command}]`,
    );
    written.push(client);
  }

  console.log("");
  console.log("Next steps:");
  if (written.length === 0) {
    console.log("  (no agent config written — pass --client claude|cursor|codex|all)");
  } else {
    written.forEach((client, i) => {
      console.log(`  ${i + 1}. ${CLIENT_INFO[client].label}: ${CLIENT_INFO[client].reload}.`);
    });
    console.log(`  ${written.length + 1}. Confirm the tools appear, then start logging decisions.`);
  }
  console.log("");
}

/**
 * Parse which agent configs to write from `init` flags.
 *   --no-mcp            -> none
 *   --client <name>     -> that client (repeatable, comma-separated, or "all")
 *   (default)           -> claude
 */
/** The instructions file(s) to drop the guidance into for the chosen agents. */
function guidanceFilesFor(clients: ClientTarget[]): string[] {
  const files = new Set<string>();
  if (clients.includes("claude")) files.add("CLAUDE.md");
  if (clients.includes("cursor") || clients.includes("codex")) files.add("AGENTS.md");
  if (files.size === 0) files.add("CLAUDE.md"); // --no-mcp still seeds guidance
  return [...files];
}

function parseClients(rest: string[]): ClientTarget[] {
  if (rest.includes("--no-mcp")) return [];

  const raw: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--client" && rest[i + 1]) raw.push(rest[++i]);
    else if (arg.startsWith("--client=")) raw.push(arg.slice("--client=".length));
  }

  const set = new Set<ClientTarget>();
  for (const value of raw) {
    for (const part of value.split(",")) {
      const name = part.trim().toLowerCase();
      if (name === "all") ALL_CLIENTS.forEach((c) => set.add(c));
      else if ((ALL_CLIENTS as string[]).includes(name)) set.add(name as ClientTarget);
    }
  }

  if (set.size === 0) set.add("claude"); // sensible default
  return ALL_CLIENTS.filter((c) => set.has(c)); // stable order
}

/** Append the guidance snippet to a rules file, replacing any prior block. */
/**
 * Adds the guidance snippet to an instructions file (CLAUDE.md / AGENTS.md)
 * without ever clobbering existing content. The snippet lives between
 * `<!-- becuz:begin -->` / `<!-- becuz:end -->` markers, so on re-runs we update
 * just that block and leave everything the user wrote alone.
 */
async function appendGuidance(repoRoot: string, fileName: string): Promise<void> {
  const target = path.resolve(repoRoot, fileName);
  let existing = "";
  let fileExisted = false;
  try {
    existing = await fs.readFile(target, "utf8");
    fileExisted = true;
  } catch {
    /* file doesn't exist yet */
  }

  let next: string;
  if (existing.includes(GUIDANCE_BEGIN) && existing.includes(GUIDANCE_END)) {
    // Update the existing becuz block in place; touch nothing else.
    const before = existing.slice(0, existing.indexOf(GUIDANCE_BEGIN));
    const after = existing.slice(existing.indexOf(GUIDANCE_END) + GUIDANCE_END.length);
    next = `${before}${GUIDANCE_SNIPPET.trim()}${after}`;
    console.log(`Updated the becuz guidance block in ${fileName} (your other content untouched).`);
  } else if (fileExisted && existing.trim().length > 0) {
    // Append to the user's existing file, preserving everything above.
    const sep = existing.endsWith("\n") ? "\n" : "\n\n";
    next = `${existing}${sep}${GUIDANCE_SNIPPET}`;
    console.log(`Appended becuz guidance to your existing ${fileName} (nothing overwritten).`);
  } else {
    // No file (or empty) -> create it.
    next = GUIDANCE_SNIPPET;
    console.log(`Created ${fileName} with the becuz guidance.`);
  }
  await fs.writeFile(target, next, "utf8");
}

async function printGuidance(): Promise<void> {
  console.log(GUIDANCE_SNIPPET);
}

/** Repo-relative path when inside the repo, else a ~-shortened absolute path. */
function friendlyPath(repoRoot: string, target: string): string {
  const rel = path.relative(repoRoot, target);
  if (rel && !rel.startsWith("..")) return rel;
  const home = os.homedir();
  if (target.startsWith(home)) return "~" + target.slice(home.length).replace(/\\/g, "/");
  return target;
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  const repoRoot = process.env.BECUZ_ROOT || process.cwd();

  switch (cmd) {
    case undefined:
    case "serve":
      await runServer();
      break;
    case "init":
      await init(repoRoot, { clients: parseClients(rest) });
      break;
    case "guidance":
      await printGuidance();
      break;
    case "rebuild-index": {
      const store = new DecisionStore(repoRoot);
      const index = await store.rebuildIndex();
      console.log(`Rebuilt index.json with ${index.decisions.length} decision(s).`);
      break;
    }
    case "version":
    case "--version":
    case "-v":
      console.log(VERSION);
      break;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;
    default:
      console.error(`Unknown command: ${cmd}\n`);
      printHelp();
      process.exit(1);
  }
  void rest;
}

function printHelp(): void {
  console.log(`becuz -- record WHY decisions are made during AI-assisted coding

Usage:
  becuz [serve]        Start the stdio MCP server (default)
  becuz init           Set up becuz here: create the .becuz/ store, add agent
                       guidance to CLAUDE.md, and write the OS-correct MCP config
                       for your agent(s). Defaults to Claude Code.
  becuz guidance       Print the agent-guidance snippet
  becuz rebuild-index  Rebuild index.json from the decision files
  becuz version        Print the version (alias: --version, -v)
  becuz help           Show this help

init options:
  --client <name>      Which agent(s) to configure: claude, cursor, codex, or all.
                       Repeatable / comma-separated. Default: claude.
                         claude -> ./.mcp.json
                         cursor -> ./.cursor/mcp.json
                         codex  -> ~/.codex/config.toml
  --no-mcp             Set up the store + guidance only; write no agent config.

Examples:
  becuz init                         # Claude Code
  becuz init --client cursor         # Cursor
  becuz init --client codex          # Codex CLI
  becuz init --client all            # all three

Environment:
  BECUZ_ROOT           Override the repo root (defaults to current directory)
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
