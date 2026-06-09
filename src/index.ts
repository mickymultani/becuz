#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  CategorySchema,
  Config,
  StatusSchema,
  AlternativeSchema,
} from "./schema.js";
import { DecisionStore } from "./store.js";
import {
  createDecision,
  deprecateDecision,
  listDecisions,
  queryDecisions,
  supersedeDecision,
  updateDecision,
  NewDecisionInput,
} from "./decisions.js";
import { VERSION } from "./version.js";

/**
 * becuz MCP server (stdio).
 *
 * Exposes the decision-capture/query tools described in the PRD. The repo root
 * defaults to the process working directory (where the agent launches the
 * server) and can be overridden with BECUZ_ROOT.
 */

const REPO_ROOT = process.env.BECUZ_ROOT || process.cwd();

/** Lazily ensure the store exists and return it with the resolved config. */
async function getContext(): Promise<{ store: DecisionStore; config: Config }> {
  // Resolve store path from an existing config if present.
  let store = new DecisionStore(REPO_ROOT);
  let config: Config;
  try {
    config = await store.readConfig();
    store = new DecisionStore(REPO_ROOT, config.store_path);
  } catch {
    config = await store.init();
  }
  await store.init(config);
  return { store, config };
}

function ok(text: string, data?: unknown) {
  const body = data !== undefined ? `${text}\n\n${JSON.stringify(data, null, 2)}` : text;
  return { content: [{ type: "text" as const, text: body }] };
}

function fail(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
}

const server = new McpServer({
  name: "becuz",
  version: VERSION,
});

/* ---- record_decision ------------------------------------------------ */
server.tool(
  "record_decision",
  "Log a new architectural/product/development decision with its reasoning. " +
    "Automatically captures the current git diff and any related code comments as evidence. " +
    "Call this whenever you and the user settle a meaningful decision.",
  {
    title: z.string().min(1),
    category: CategorySchema,
    decision: z.string().min(1),
    rationale: z.string().min(1),
    alternatives_considered: z.array(AlternativeSchema).optional(),
    consequences: z.string().optional(),
    tags: z.array(z.string()).optional(),
    conversation_summary: z.string().optional(),
    conversation_excerpt: z.string().optional(),
    files: z.array(z.string()).optional(),
    session_id: z.string().optional(),
  },
  async (input) => {
    const { store, config } = await getContext();
    const record = await createDecision(store, config, input as NewDecisionInput);
    return ok(`Recorded decision ${record.id}: "${record.title}" (status: active).`, record);
  },
);

/* ---- supersede_decision --------------------------------------------- */
server.tool(
  "supersede_decision",
  "Replace an existing decision with a new one. Creates a fresh record, links " +
    "the two, and flips the old decision's status to 'superseded'. Use this when " +
    "reversing or changing a previously recorded decision instead of recording a new disconnected one.",
  {
    old_id: z.string().describe("The id of the decision being replaced, e.g. DR-0003."),
    title: z.string().min(1),
    category: CategorySchema,
    decision: z.string().min(1),
    rationale: z.string().min(1),
    alternatives_considered: z.array(AlternativeSchema).optional(),
    consequences: z.string().optional(),
    tags: z.array(z.string()).optional(),
    conversation_summary: z.string().optional(),
    conversation_excerpt: z.string().optional(),
    files: z.array(z.string()).optional(),
    session_id: z.string().optional(),
  },
  async (input) => {
    const { store, config } = await getContext();
    const { old_id, ...rest } = input;
    const existing = await store.tryReadRecord(old_id);
    if (!existing) return fail(`No decision found with id ${old_id}.`);
    const { newRecord, oldRecord } = await supersedeDecision(
      store,
      config,
      old_id,
      rest as NewDecisionInput,
    );
    return ok(
      `Created ${newRecord.id} superseding ${oldRecord.id}. ${oldRecord.id} is now 'superseded'.`,
      { new: newRecord, superseded: oldRecord },
    );
  },
);

/* ---- update_decision ------------------------------------------------ */
server.tool(
  "update_decision",
  "Edit an existing decision record in place (fix a typo, add a consequence, " +
    "refine the rationale). Bumps the record's version. Does NOT change identity " +
    "or status; use supersede_decision to replace a decision.",
  {
    id: z.string(),
    title: z.string().optional(),
    category: CategorySchema.optional(),
    decision: z.string().optional(),
    rationale: z.string().optional(),
    alternatives_considered: z.array(AlternativeSchema).optional(),
    consequences: z.string().optional(),
    tags: z.array(z.string()).optional(),
    conversation_summary: z.string().optional(),
  },
  async (input) => {
    const { store } = await getContext();
    const { id, ...edits } = input;
    const existing = await store.tryReadRecord(id);
    if (!existing) return fail(`No decision found with id ${id}.`);
    const record = await updateDecision(store, id, edits);
    return ok(`Updated ${record.id} (now version ${record.version}).`, record);
  },
);

/* ---- deprecate_decision --------------------------------------------- */
server.tool(
  "deprecate_decision",
  "Retire a decision that no longer applies and has no direct replacement " +
    "(e.g. a removed feature). Sets status to 'deprecated'. The record is kept.",
  {
    id: z.string(),
    reason: z.string().optional(),
  },
  async ({ id, reason }) => {
    const { store } = await getContext();
    const existing = await store.tryReadRecord(id);
    if (!existing) return fail(`No decision found with id ${id}.`);
    const record = await deprecateDecision(store, id, reason);
    return ok(`Deprecated ${record.id}.`, record);
  },
);

/* ---- query_decisions ------------------------------------------------ */
server.tool(
  "query_decisions",
  "Search recorded decisions to answer 'why did we …?' questions. Combine a " +
    "free-text query with optional category/status/tag filters. Returns matching " +
    "full records (ranked by keyword relevance) for you to reason over.",
  {
    query: z.string().optional(),
    category: CategorySchema.optional(),
    status: StatusSchema.optional(),
    tags: z.array(z.string()).optional(),
  },
  async (filter) => {
    const { store } = await getContext();
    const results = await queryDecisions(store, filter);
    if (results.length === 0) return ok("No matching decisions found.", []);
    return ok(`Found ${results.length} matching decision(s).`, results);
  },
);

/* ---- get_decision --------------------------------------------------- */
server.tool(
  "get_decision",
  "Fetch one decision record in full by its id.",
  { id: z.string() },
  async ({ id }) => {
    const { store } = await getContext();
    const record = await store.tryReadRecord(id);
    if (!record) return fail(`No decision found with id ${id}.`);
    return ok(`Decision ${record.id}:`, record);
  },
);

/* ---- list_decisions ------------------------------------------------- */
server.tool(
  "list_decisions",
  "List/browse decisions from the index (lightweight entries, not full records). " +
    "Optionally filter by status or category.",
  {
    status: StatusSchema.optional(),
    category: CategorySchema.optional(),
  },
  async (filter) => {
    const { store } = await getContext();
    const entries = await listDecisions(store, filter);
    return ok(`${entries.length} decision(s).`, entries);
  },
);

/* ---- resources ------------------------------------------------------ */
server.resource("becuz-index", "becuz://index", async () => {
  const { store } = await getContext();
  const index = await store.readIndex();
  return {
    contents: [
      {
        uri: "becuz://index",
        mimeType: "application/json",
        text: JSON.stringify(index, null, 2),
      },
    ],
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Stderr is safe for logs; stdout is the MCP channel.
  console.error(`becuz MCP server running (root: ${REPO_ROOT})`);
}

main().catch((err) => {
  console.error("becuz fatal error:", err);
  process.exit(1);
});
