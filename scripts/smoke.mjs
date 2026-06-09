// Minimal MCP stdio smoke test: spawns the server, initializes, then exercises
// record_decision -> list_decisions -> query_decisions -> supersede_decision.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Run against a throwaway temp store so the smoke test never pollutes the repo.
const sandbox = mkdtempSync(path.join(tmpdir(), "becuz-smoke-"));
const server = spawn(process.execPath, [path.join(root, "dist", "index.js")], {
  cwd: sandbox,
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, BECUZ_ROOT: sandbox },
});

let buf = "";
const pending = new Map();
server.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

let nextId = 1;
function send(method, params) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
function notify(method, params) {
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

const call = (name, args) => send("tools/call", { name, arguments: args });

function show(label, res) {
  const text = res?.result?.content?.[0]?.text ?? JSON.stringify(res);
  console.log(`\n=== ${label} ===\n${text}`);
}

(async () => {
  await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0" },
  });
  notify("notifications/initialized", {});

  const tools = await send("tools/list", {});
  console.log("Tools:", tools.result.tools.map((t) => t.name).join(", "));

  const rec = await call("record_decision", {
    title: "Use plain JSON files for the decision store",
    category: "architecture",
    decision: "Store each decision as a JSON file under .becuz/decisions.",
    rationale: "Human-readable, git-diffable, zero infra for the MVP.",
    alternatives_considered: [
      { option: "SQLite", reason_rejected: "Adds a binary, harder to diff in PRs." },
    ],
    consequences: "Index.json must be kept in sync on writes.",
    tags: ["storage", "mvp"],
    conversation_summary: "Weighed SQLite vs flat files; chose files for git-friendliness.",
    files: ["src/store.ts"],
  });
  show("record_decision", rec);

  show("list_decisions", await call("list_decisions", {}));
  show("query_decisions 'why json files'", await call("query_decisions", { query: "json files git" }));

  const sup = await call("supersede_decision", {
    old_id: "DR-0001",
    title: "Store decisions as JSON files with a derived index",
    category: "architecture",
    decision: "Keep JSON files but allow rebuilding index.json from disk.",
    rationale: "Avoids index merge-conflict pain on teams.",
    tags: ["storage"],
    conversation_summary: "Refined the storage decision to address index conflicts.",
  });
  show("supersede_decision", sup);

  show("get DR-0001 (should be superseded)", await call("get_decision", { id: "DR-0001" }));

  server.kill();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  server.kill();
  process.exit(1);
});
