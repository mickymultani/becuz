import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Generates and maintains the MCP server registration for each supported agent.
 *
 * The launch command differs by OS: native Windows can't spawn `npx` directly
 * through an MCP client, so it must go through `cmd /c`. macOS/Linux use `npx`
 * directly. Generating these at `init` time means users never hand-author config
 * or have to know the OS difference.
 *
 * Supported agents:
 *   - claude  -> <repo>/.mcp.json                 (JSON)
 *   - cursor  -> <repo>/.cursor/mcp.json          (JSON)
 *   - codex   -> ~/.codex/config.toml             (TOML)
 */

export type ClientTarget = "claude" | "cursor" | "codex";
export const ALL_CLIENTS: ClientTarget[] = ["claude", "cursor", "codex"];

export interface McpServerSpec {
  command: string;
  args: string[];
}

/** The becuz MCP server launch spec, correct for the given platform. */
export function becuzServerSpec(platform: NodeJS.Platform = process.platform): McpServerSpec {
  if (platform === "win32") {
    return { command: "cmd", args: ["/c", "npx", "-y", "becuz"] };
  }
  return { command: "npx", args: ["-y", "becuz"] };
}

export interface McpWriteResult {
  client: ClientTarget;
  /** Absolute path of the config file written. */
  path: string;
  /** True if a becuz entry already existed (and was refreshed). */
  alreadyHad: boolean;
  /** True if the config file already existed and was merged into. */
  mergedIntoExisting: boolean;
  /** Human-readable launch command, e.g. "cmd /c npx -y becuz". */
  command: string;
}

/** Shared writer for JSON-based clients (Claude `.mcp.json`, Cursor `.cursor/mcp.json`). */
async function writeJsonMcp(
  client: ClientTarget,
  file: string,
  platform: NodeJS.Platform,
): Promise<McpWriteResult> {
  let json: { mcpServers?: Record<string, unknown> } & Record<string, unknown> = {};
  let mergedIntoExisting = false;
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    if (parsed && typeof parsed === "object") {
      json = parsed;
      mergedIntoExisting = true;
    }
  } catch {
    /* no existing file, or invalid -> start fresh */
  }

  if (!json.mcpServers || typeof json.mcpServers !== "object") {
    json.mcpServers = {};
  }
  const servers = json.mcpServers as Record<string, unknown>;
  const alreadyHad = Boolean(servers.becuz);
  const spec = becuzServerSpec(platform);
  servers.becuz = spec;

  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(json, null, 2) + "\n", "utf8");
  return {
    client,
    path: file,
    alreadyHad,
    mergedIntoExisting,
    command: `${spec.command} ${spec.args.join(" ")}`,
  };
}

/** Claude Code: `<repo>/.mcp.json`. */
export function writeMcpConfig(
  repoRoot: string,
  platform: NodeJS.Platform = process.platform,
): Promise<McpWriteResult> {
  return writeJsonMcp("claude", path.resolve(repoRoot, ".mcp.json"), platform);
}

/** Cursor: `<repo>/.cursor/mcp.json` (same JSON shape as Claude). */
export function writeCursorConfig(
  repoRoot: string,
  platform: NodeJS.Platform = process.platform,
): Promise<McpWriteResult> {
  return writeJsonMcp("cursor", path.resolve(repoRoot, ".cursor", "mcp.json"), platform);
}

/**
 * Codex CLI: `~/.codex/config.toml`. Appends a `[mcp_servers.becuz]` table, or
 * replaces it in place if already present, leaving the rest of the file intact.
 */
export async function writeCodexConfig(
  homeDir: string = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): Promise<McpWriteResult> {
  const file = path.resolve(homeDir, ".codex", "config.toml");
  const spec = becuzServerSpec(platform);

  // TOML string/array literals use the same syntax as JSON for our values.
  const block =
    `[mcp_servers.becuz]\n` +
    `command = ${JSON.stringify(spec.command)}\n` +
    `args = ${JSON.stringify(spec.args)}\n`;

  let existing = "";
  let mergedIntoExisting = false;
  try {
    existing = await fs.readFile(file, "utf8");
    mergedIntoExisting = existing.trim().length > 0;
  } catch {
    /* no existing file */
  }

  // Matches the [mcp_servers.becuz] table: its header line plus all following
  // lines that don't start a new [table]. (The `args = [...]` line starts with
  // `args`, not `[`, so it isn't mistaken for a new table.)
  const sectionRe = /^\[mcp_servers\.becuz\][^\n]*\n(?:(?!\[)[^\n]*\n?)*/m;
  const alreadyHad = sectionRe.test(existing);

  let next: string;
  if (alreadyHad) {
    next = existing.replace(sectionRe, block);
  } else {
    const sep = existing && !existing.endsWith("\n") ? "\n\n" : existing ? "\n" : "";
    next = `${existing}${sep}${block}`;
  }

  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, next, "utf8");
  return {
    client: "codex",
    path: file,
    alreadyHad,
    mergedIntoExisting,
    command: `${spec.command} ${spec.args.join(" ")}`,
  };
}

/** Dispatch to the right writer for a client. */
export function writeClientConfig(
  client: ClientTarget,
  repoRoot: string,
  platform: NodeJS.Platform = process.platform,
): Promise<McpWriteResult> {
  switch (client) {
    case "claude":
      return writeMcpConfig(repoRoot, platform);
    case "cursor":
      return writeCursorConfig(repoRoot, platform);
    case "codex":
      return writeCodexConfig(os.homedir(), platform);
  }
}
