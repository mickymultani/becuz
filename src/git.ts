import { promises as fs } from "node:fs";
import path from "node:path";
import { simpleGit, SimpleGit } from "simple-git";
import { CodeComment, DiffEvidence } from "./schema.js";

/**
 * Captures git evidence (branch, commits, working diff) for a decision.
 *
 * Everything here is best-effort: a repo with no git, no commits, or no
 * changes still produces a valid (mostly-null) DiffEvidence rather than
 * throwing, so recording a decision never fails because of git state.
 */
export async function captureGitEvidence(repoRoot: string): Promise<DiffEvidence | null> {
  const git: SimpleGit = simpleGit(repoRoot);

  let isRepo = false;
  try {
    isRepo = await git.checkIsRepo();
  } catch {
    isRepo = false;
  }
  if (!isRepo) return null;

  const evidence: DiffEvidence = {
    branch: null,
    base_commit: null,
    head_commit: null,
    files_changed: [],
    summary: "",
  };

  try {
    evidence.branch = (await git.revparse(["--abbrev-ref", "HEAD"])).trim() || null;
  } catch {
    /* detached or no branch */
  }

  try {
    evidence.head_commit = (await git.revparse(["HEAD"])).trim().slice(0, 40) || null;
  } catch {
    /* no commits yet */
  }

  // base_commit = parent of HEAD when available; otherwise HEAD itself.
  try {
    evidence.base_commit = (await git.revparse(["HEAD~1"])).trim().slice(0, 40) || null;
  } catch {
    evidence.base_commit = evidence.head_commit;
  }

  try {
    const status = await git.status();
    const changed = new Set<string>([
      ...status.modified,
      ...status.created,
      ...status.deleted,
      ...status.renamed.map((r) => r.to),
      ...status.not_added,
      ...status.staged,
    ]);
    evidence.files_changed = [...changed].sort();
  } catch {
    /* ignore */
  }

  try {
    const stat = await git.raw(["diff", "--stat"]);
    const stagedStat = await git.raw(["diff", "--stat", "--cached"]);
    const combined = [stat.trim(), stagedStat.trim()].filter(Boolean).join("\n");
    evidence.summary = combined
      ? truncate(combined, 4000)
      : "No uncommitted changes in the working tree at capture time.";
  } catch {
    evidence.summary = "Diff summary unavailable.";
  }

  return evidence;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "\n...(truncated)" : s;
}

/**
 * Comment markers by kind. Line markers are anchored to start-of-line or
 * whitespace so we don't mistake `https://`, `color: #fff`, or `this.#field`
 * for comments.
 */
const MARKERS = {
  slash: /(?:^|\s)\/\/\s?(.+)$/, // // ...
  hash: /(?:^|\s)#\s?(.+)$/, // # ...
  dash: /(?:^|\s)--\s?(.+)$/, // -- ...
  block: /\/\*\s?(.*?)\s?\*\//, // /* ... */ on one line
  html: /<!--\s?(.*?)\s?-->/, // <!-- ... -->
} as const;

type MarkerKind = keyof typeof MARKERS;

const SLASH_BLOCK: MarkerKind[] = ["slash", "block"];

/**
 * Which comment markers actually apply to a given file extension. Choosing by
 * language avoids false positives like JS private fields (`#x`) matching a
 * shell-style `#` comment.
 */
const EXT_MARKERS: Record<string, MarkerKind[]> = {
  // C-family / curly-brace languages
  js: SLASH_BLOCK, mjs: SLASH_BLOCK, cjs: SLASH_BLOCK, ts: SLASH_BLOCK,
  tsx: SLASH_BLOCK, jsx: SLASH_BLOCK, c: SLASH_BLOCK, h: SLASH_BLOCK,
  cpp: SLASH_BLOCK, cc: SLASH_BLOCK, hpp: SLASH_BLOCK, java: SLASH_BLOCK,
  go: SLASH_BLOCK, rs: SLASH_BLOCK, swift: SLASH_BLOCK, kt: SLASH_BLOCK,
  scala: SLASH_BLOCK, cs: SLASH_BLOCK, php: SLASH_BLOCK, dart: SLASH_BLOCK,
  proto: SLASH_BLOCK,
  // Hash-comment languages
  py: ["hash"], rb: ["hash"], sh: ["hash"], bash: ["hash"], zsh: ["hash"],
  yml: ["hash"], yaml: ["hash"], toml: ["hash"], pl: ["hash"], r: ["hash"],
  ex: ["hash"], exs: ["hash"], tf: ["hash"],
  // SQL / Lua / Haskell
  sql: ["dash"], lua: ["dash"], hs: ["dash"], elm: ["dash"],
  // Markup
  html: ["html"], htm: ["html"], xml: ["html"], vue: ["html"], svelte: ["html"],
  md: ["html"], markdown: ["html"],
  // Stylesheets
  css: ["block"], scss: SLASH_BLOCK, less: SLASH_BLOCK,
};

function markersFor(rel: string): RegExp[] {
  const ext = path.extname(rel).slice(1).toLowerCase();
  const kinds = EXT_MARKERS[ext] ?? SLASH_BLOCK; // sensible default
  return kinds.map((k) => MARKERS[k]);
}

/**
 * Scans the given files for code comments, returning a small sample so a
 * decision record can point at the in-code rationale without bloating.
 */
export async function scanCodeComments(
  repoRoot: string,
  files: string[],
  maxPerFile = 5,
): Promise<CodeComment[]> {
  const results: CodeComment[] = [];
  for (const rel of files) {
    const abs = path.resolve(repoRoot, rel);
    let content: string;
    try {
      const stat = await fs.stat(abs);
      if (!stat.isFile() || stat.size > 512 * 1024) continue; // skip huge/binary-ish
      content = await fs.readFile(abs, "utf8");
    } catch {
      continue;
    }
    const patterns = markersFor(rel);
    const lines = content.split(/\r?\n/);
    let found = 0;
    for (let i = 0; i < lines.length && found < maxPerFile; i++) {
      const line = lines[i];
      if (i === 0 && line.startsWith("#!")) continue; // skip shebang
      for (const pattern of patterns) {
        const m = line.match(pattern);
        if (m && m[1] && m[1].trim().length > 0) {
          results.push({ file: rel, line: i + 1, text: m[1].trim().slice(0, 300) });
          found++;
          break;
        }
      }
    }
  }
  return results;
}
