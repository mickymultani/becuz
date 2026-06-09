import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * The single source of truth for the version is package.json. Everything else
 * (the MCP server handshake, the VERSION mirror file) derives from it, so a
 * `npm version` bump is the only place a version number ever changes.
 */
function readVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url)); // dist/
    const pkg = JSON.parse(readFileSync(path.join(here, "..", "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const VERSION = readVersion();
