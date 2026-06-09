import {
  Config,
  DecisionRecord,
  Evidence,
  IndexEntry,
  SCHEMA_VERSION,
  Status,
} from "./schema.js";
import { DecisionStore } from "./store.js";
import { captureGitEvidence, scanCodeComments } from "./git.js";

/** Normalized input for creating a new decision (from record/supersede tools). */
export interface NewDecisionInput {
  title: string;
  category: DecisionRecord["category"];
  decision: string;
  rationale: string;
  alternatives_considered?: { option: string; reason_rejected: string }[];
  consequences?: string;
  tags?: string[];
  conversation_summary?: string;
  conversation_excerpt?: string;
  files?: string[];
  session_id?: string;
  created_by?: string;
}

/** Assemble evidence (git diff + code comments) honoring config toggles. */
async function buildEvidence(
  store: DecisionStore,
  config: Config,
  input: NewDecisionInput,
): Promise<Evidence> {
  const diff = config.capture_git ? await captureGitEvidence(store.root) : null;

  const code_comments =
    input.files && input.files.length > 0
      ? await scanCodeComments(store.root, input.files)
      : [];

  const excerpt =
    config.store_excerpts && input.conversation_excerpt
      ? input.conversation_excerpt
      : undefined;

  return {
    conversation: {
      summary: input.conversation_summary ?? "",
      ...(excerpt ? { excerpt } : {}),
    },
    diff,
    code_comments,
  };
}

/** Create and persist a brand-new decision record (status=active). */
export async function createDecision(
  store: DecisionStore,
  config: Config,
  input: NewDecisionInput,
  opts: { supersedes?: string } = {},
): Promise<DecisionRecord> {
  const { id } = await store.allocateId();
  const now = new Date().toISOString();
  const evidence = await buildEvidence(store, config, input);

  const record: DecisionRecord = {
    id,
    schema_version: SCHEMA_VERSION,
    title: input.title,
    category: input.category,
    status: "active",
    decision: input.decision,
    rationale: input.rationale,
    alternatives_considered: input.alternatives_considered ?? [],
    consequences: input.consequences ?? "",
    tags: input.tags ?? [],
    evidence,
    version: 1,
    supersedes: opts.supersedes ?? null,
    superseded_by: null,
    created_at: now,
    updated_at: now,
    created_by: input.created_by ?? "agent",
    session_id: input.session_id ?? null,
  };

  await store.writeRecord(record);
  return record;
}

/** Create a replacement decision and flip the old one to `superseded`. */
export async function supersedeDecision(
  store: DecisionStore,
  config: Config,
  oldId: string,
  input: NewDecisionInput,
): Promise<{ newRecord: DecisionRecord; oldRecord: DecisionRecord }> {
  const oldRecord = await store.readRecord(oldId);

  const newRecord = await createDecision(store, config, input, { supersedes: oldId });

  const updatedOld: DecisionRecord = {
    ...oldRecord,
    status: "superseded",
    superseded_by: newRecord.id,
    version: oldRecord.version + 1,
    updated_at: new Date().toISOString(),
  };
  await store.writeRecord(updatedOld);

  return { newRecord, oldRecord: updatedOld };
}

/** Editable fields for update_decision. */
export interface DecisionEdits {
  title?: string;
  category?: DecisionRecord["category"];
  decision?: string;
  rationale?: string;
  alternatives_considered?: { option: string; reason_rejected: string }[];
  consequences?: string;
  tags?: string[];
  conversation_summary?: string;
}

/** Apply small corrections to an existing record; bumps version + updated_at. */
export async function updateDecision(
  store: DecisionStore,
  id: string,
  edits: DecisionEdits,
): Promise<DecisionRecord> {
  const existing = await store.readRecord(id);

  const updated: DecisionRecord = {
    ...existing,
    ...("title" in edits && edits.title !== undefined ? { title: edits.title } : {}),
    ...("category" in edits && edits.category !== undefined
      ? { category: edits.category }
      : {}),
    ...("decision" in edits && edits.decision !== undefined
      ? { decision: edits.decision }
      : {}),
    ...("rationale" in edits && edits.rationale !== undefined
      ? { rationale: edits.rationale }
      : {}),
    ...("alternatives_considered" in edits && edits.alternatives_considered !== undefined
      ? { alternatives_considered: edits.alternatives_considered }
      : {}),
    ...("consequences" in edits && edits.consequences !== undefined
      ? { consequences: edits.consequences }
      : {}),
    ...("tags" in edits && edits.tags !== undefined ? { tags: edits.tags } : {}),
    version: existing.version + 1,
    updated_at: new Date().toISOString(),
  };

  if (edits.conversation_summary !== undefined) {
    updated.evidence = {
      ...existing.evidence,
      conversation: {
        ...existing.evidence.conversation,
        summary: edits.conversation_summary,
      },
    };
  }

  await store.writeRecord(updated);
  return updated;
}

/** Retire a decision with no replacement. */
export async function deprecateDecision(
  store: DecisionStore,
  id: string,
  reason?: string,
): Promise<DecisionRecord> {
  const existing = await store.readRecord(id);
  const updated: DecisionRecord = {
    ...existing,
    status: "deprecated",
    consequences: reason
      ? `${existing.consequences}\n\n[Deprecated] ${reason}`.trim()
      : existing.consequences,
    version: existing.version + 1,
    updated_at: new Date().toISOString(),
  };
  await store.writeRecord(updated);
  return updated;
}

export interface QueryFilter {
  query?: string;
  category?: string;
  status?: Status;
  tags?: string[];
}

/**
 * Filtered + keyword search over the store. The calling agent does the
 * natural-language reasoning; this just narrows the candidate set and ranks
 * by simple keyword overlap so the most relevant records surface first.
 */
export async function queryDecisions(
  store: DecisionStore,
  filter: QueryFilter,
): Promise<DecisionRecord[]> {
  let records = await store.readAllRecords();

  if (filter.category) {
    records = records.filter((r) => r.category === filter.category);
  }
  if (filter.status) {
    records = records.filter((r) => r.status === filter.status);
  }
  if (filter.tags && filter.tags.length > 0) {
    const wanted = filter.tags.map((t) => t.toLowerCase());
    records = records.filter((r) =>
      r.tags.some((t) => wanted.includes(t.toLowerCase())),
    );
  }

  if (filter.query && filter.query.trim()) {
    const terms = filter.query.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = records
      .map((r) => ({ r, score: keywordScore(r, terms) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.map((s) => s.r);
  }

  // No query: most-recently-updated first.
  return records.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

function keywordScore(record: DecisionRecord, terms: string[]): number {
  const haystack = [
    record.title,
    record.decision,
    record.rationale,
    record.consequences,
    record.tags.join(" "),
    record.category,
    record.evidence.conversation.summary,
    record.alternatives_considered.map((a) => `${a.option} ${a.reason_rejected}`).join(" "),
  ]
    .join(" ")
    .toLowerCase();

  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) score += 1;
    // Title matches are worth more.
    if (record.title.toLowerCase().includes(term)) score += 2;
  }
  return score;
}

export async function listDecisions(
  store: DecisionStore,
  filter: { status?: Status; category?: string } = {},
): Promise<IndexEntry[]> {
  let entries = await store.listEntries();
  if (filter.status) entries = entries.filter((e) => e.status === filter.status);
  if (filter.category) entries = entries.filter((e) => e.category === filter.category);
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}
