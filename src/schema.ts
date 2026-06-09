import { z } from "zod";

/**
 * Schema definitions for becuz.
 *
 * The Decision Record is the heart of the product. Everything else
 * (store, index, tools) is built around keeping these records valid,
 * versioned, and queryable.
 */

export const SCHEMA_VERSION = 1 as const;

/** Allowed decision categories (MVP). */
export const CATEGORIES = [
  "architecture",
  "infrastructure",
  "dependency",
  "api",
  "data-model",
  "ui",
  "product",
  "security",
  "performance",
  "process",
  "other",
] as const;

export const CategorySchema = z.enum(CATEGORIES);
export type Category = z.infer<typeof CategorySchema>;

/** Lifecycle status of a decision. */
export const STATUSES = ["active", "superseded", "deprecated"] as const;
export const StatusSchema = z.enum(STATUSES);
export type Status = z.infer<typeof StatusSchema>;

export const AlternativeSchema = z.object({
  option: z.string().min(1),
  reason_rejected: z.string().min(1),
});
export type Alternative = z.infer<typeof AlternativeSchema>;

export const ConversationEvidenceSchema = z.object({
  summary: z.string(),
  excerpt: z.string().optional(),
});

export const DiffEvidenceSchema = z.object({
  branch: z.string().nullable(),
  base_commit: z.string().nullable(),
  head_commit: z.string().nullable(),
  files_changed: z.array(z.string()),
  summary: z.string(),
});
export type DiffEvidence = z.infer<typeof DiffEvidenceSchema>;

export const CodeCommentSchema = z.object({
  file: z.string(),
  line: z.number().int().nonnegative(),
  text: z.string(),
});
export type CodeComment = z.infer<typeof CodeCommentSchema>;

export const EvidenceSchema = z.object({
  conversation: ConversationEvidenceSchema,
  diff: DiffEvidenceSchema.nullable(),
  code_comments: z.array(CodeCommentSchema),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

/** A single, fully-formed decision record (one JSON file on disk). */
export const DecisionRecordSchema = z.object({
  id: z.string().regex(/^DR-\d{4,}$/),
  schema_version: z.literal(SCHEMA_VERSION),
  title: z.string().min(1),
  category: CategorySchema,
  status: StatusSchema,

  decision: z.string().min(1),
  rationale: z.string().min(1),
  alternatives_considered: z.array(AlternativeSchema),
  consequences: z.string(),

  tags: z.array(z.string()),

  evidence: EvidenceSchema,

  version: z.number().int().positive(),
  supersedes: z.string().nullable(),
  superseded_by: z.string().nullable(),

  created_at: z.string(),
  updated_at: z.string(),
  created_by: z.string(),
  session_id: z.string().nullable(),
});
export type DecisionRecord = z.infer<typeof DecisionRecordSchema>;

/** A lightweight entry kept in index.json for fast listing/search. */
export const IndexEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  category: CategorySchema,
  status: StatusSchema,
  tags: z.array(z.string()),
  updated_at: z.string(),
});
export type IndexEntry = z.infer<typeof IndexEntrySchema>;

export const IndexSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  next_id: z.number().int().positive(),
  decisions: z.array(IndexEntrySchema),
});
export type DecisionIndex = z.infer<typeof IndexSchema>;

export const CaptureModeSchema = z.enum(["inline", "session-summary"]);

export const ConfigSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  store_path: z.string(),
  categories: z.array(z.string()),
  capture_mode: CaptureModeSchema,
  /** When false, only conversation summaries are stored (no raw excerpts). */
  store_excerpts: z.boolean(),
  /** When false, git evidence capture is skipped. */
  capture_git: z.boolean(),
});
export type Config = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG: Config = {
  schema_version: SCHEMA_VERSION,
  store_path: ".becuz",
  categories: [...CATEGORIES],
  capture_mode: "inline",
  store_excerpts: false,
  capture_git: true,
};

/* ------------------------------------------------------------------ */
/* Tool input schemas                                                  */
/* ------------------------------------------------------------------ */

/** Fields shared by record_decision and the new record in supersede_decision. */
export const DecisionInputShape = {
  title: z.string().min(1).describe("Short, human-readable title for the decision."),
  category: CategorySchema.describe(`One of: ${CATEGORIES.join(", ")}.`),
  decision: z.string().min(1).describe("The decision that was made, stated plainly."),
  rationale: z.string().min(1).describe("Why this decision was made."),
  alternatives_considered: z
    .array(AlternativeSchema)
    .optional()
    .describe("Other options weighed and why each was rejected."),
  consequences: z
    .string()
    .optional()
    .describe("Trade-offs, follow-on work, or ops impact this decision introduces."),
  tags: z.array(z.string()).optional().describe("Free-form tags for filtering/search."),
  conversation_summary: z
    .string()
    .optional()
    .describe("A 1-3 sentence summary of the conversation that led to this decision."),
  conversation_excerpt: z
    .string()
    .optional()
    .describe("Optional short verbatim snippet (stored only if config.store_excerpts is true)."),
  files: z
    .array(z.string())
    .optional()
    .describe("Files relevant to this decision; scanned for related code comments."),
  session_id: z.string().optional().describe("Identifier grouping decisions from one session."),
};
