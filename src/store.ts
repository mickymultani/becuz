import { promises as fs } from "node:fs";
import path from "node:path";
import {
  Config,
  ConfigSchema,
  DEFAULT_CONFIG,
  DecisionIndex,
  DecisionRecord,
  DecisionRecordSchema,
  IndexEntry,
  IndexSchema,
  SCHEMA_VERSION,
} from "./schema.js";

/**
 * The on-disk decision store.
 *
 * Layout (relative to repo root):
 *   .becuz/
 *     config.json
 *     index.json
 *     decisions/
 *       DR-0001.json
 *       ...
 *
 * Records are never deleted. The index is a derived, rolled-up view kept in
 * sync on every write, but can be rebuilt from the decision files if needed.
 */
export class DecisionStore {
  readonly root: string;
  readonly storeDir: string;
  readonly decisionsDir: string;
  readonly indexPath: string;
  readonly configPath: string;

  constructor(repoRoot: string, storePath = ".becuz") {
    this.root = repoRoot;
    this.storeDir = path.resolve(repoRoot, storePath);
    this.decisionsDir = path.join(this.storeDir, "decisions");
    this.indexPath = path.join(this.storeDir, "index.json");
    this.configPath = path.join(this.storeDir, "config.json");
  }

  async exists(): Promise<boolean> {
    try {
      await fs.access(this.indexPath);
      return true;
    } catch {
      return false;
    }
  }

  /** Create the store directories and seed config/index if missing. */
  async init(config: Partial<Config> = {}): Promise<Config> {
    await fs.mkdir(this.decisionsDir, { recursive: true });

    let cfg: Config;
    try {
      cfg = await this.readConfig();
    } catch {
      cfg = ConfigSchema.parse({ ...DEFAULT_CONFIG, ...config });
      await this.writeConfig(cfg);
    }

    if (!(await this.exists())) {
      const emptyIndex: DecisionIndex = {
        schema_version: SCHEMA_VERSION,
        next_id: 1,
        decisions: [],
      };
      await this.writeIndex(emptyIndex);
    }

    return cfg;
  }

  async readConfig(): Promise<Config> {
    const raw = await fs.readFile(this.configPath, "utf8");
    return ConfigSchema.parse(JSON.parse(raw));
  }

  async writeConfig(config: Config): Promise<void> {
    await fs.mkdir(this.storeDir, { recursive: true });
    await writeJson(this.configPath, config);
  }

  async readIndex(): Promise<DecisionIndex> {
    const raw = await fs.readFile(this.indexPath, "utf8");
    return IndexSchema.parse(JSON.parse(raw));
  }

  async writeIndex(index: DecisionIndex): Promise<void> {
    await writeJson(this.indexPath, index);
  }

  recordPath(id: string): string {
    return path.join(this.decisionsDir, `${id}.json`);
  }

  async readRecord(id: string): Promise<DecisionRecord> {
    const raw = await fs.readFile(this.recordPath(id), "utf8");
    return DecisionRecordSchema.parse(JSON.parse(raw));
  }

  async tryReadRecord(id: string): Promise<DecisionRecord | null> {
    try {
      return await this.readRecord(id);
    } catch {
      return null;
    }
  }

  async writeRecord(record: DecisionRecord): Promise<void> {
    DecisionRecordSchema.parse(record);
    await fs.mkdir(this.decisionsDir, { recursive: true });
    await writeJson(this.recordPath(record.id), record);
    await this.upsertIndexEntry(record);
  }

  /** Reserve the next sequential ID, advancing the index counter. */
  async allocateId(): Promise<{ id: string; index: DecisionIndex }> {
    const index = await this.readIndex();
    const id = `DR-${String(index.next_id).padStart(4, "0")}`;
    index.next_id += 1;
    await this.writeIndex(index);
    return { id, index };
  }

  /** Insert or replace a record's index entry and persist the index. */
  async upsertIndexEntry(record: DecisionRecord): Promise<void> {
    const index = await this.readIndex();
    const entry: IndexEntry = {
      id: record.id,
      title: record.title,
      category: record.category,
      status: record.status,
      tags: record.tags,
      updated_at: record.updated_at,
    };
    const i = index.decisions.findIndex((d) => d.id === record.id);
    if (i >= 0) index.decisions[i] = entry;
    else index.decisions.push(entry);
    await this.writeIndex(index);
  }

  async listEntries(): Promise<IndexEntry[]> {
    const index = await this.readIndex();
    return index.decisions;
  }

  async readAllRecords(): Promise<DecisionRecord[]> {
    const entries = await this.listEntries();
    const records: DecisionRecord[] = [];
    for (const entry of entries) {
      const rec = await this.tryReadRecord(entry.id);
      if (rec) records.push(rec);
    }
    return records;
  }

  /** Rebuild index.json from the decision files on disk. */
  async rebuildIndex(): Promise<DecisionIndex> {
    let files: string[] = [];
    try {
      files = await fs.readdir(this.decisionsDir);
    } catch {
      files = [];
    }
    const decisions: IndexEntry[] = [];
    let maxId = 0;
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const id = file.replace(/\.json$/, "");
      const rec = await this.tryReadRecord(id);
      if (!rec) continue;
      decisions.push({
        id: rec.id,
        title: rec.title,
        category: rec.category,
        status: rec.status,
        tags: rec.tags,
        updated_at: rec.updated_at,
      });
      const n = Number(rec.id.replace("DR-", ""));
      if (Number.isFinite(n)) maxId = Math.max(maxId, n);
    }
    decisions.sort((a, b) => a.id.localeCompare(b.id));
    const index: DecisionIndex = {
      schema_version: SCHEMA_VERSION,
      next_id: maxId + 1,
      decisions,
    };
    await this.writeIndex(index);
    return index;
  }
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  const json = JSON.stringify(data, null, 2) + "\n";
  await fs.writeFile(filePath, json, "utf8");
}
