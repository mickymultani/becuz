// Mirrors package.json's version into the top-level VERSION file.
//
// Runs automatically as npm's `version` lifecycle script (see package.json), so
// `npm version <patch|minor|major>` updates package.json AND VERSION in the same
// commit/tag. Can also be run by hand: `node scripts/sync-version.mjs`.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const versionFile = path.join(root, "VERSION");

writeFileSync(versionFile, `${pkg.version}\n`, "utf8");
console.log(`VERSION -> ${pkg.version}`);
