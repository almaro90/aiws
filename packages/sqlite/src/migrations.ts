import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";

interface MigrationFile {
  readonly version: string;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

interface AppliedMigrationRow {
  readonly version: string;
  readonly name: string;
  readonly checksum_sha256: string;
}

export class MigrationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MigrationError";
  }
}

export interface MigrationRunnerOptions {
  readonly directory: string;
  readonly now?: () => string;
}

export function runMigrations(database: Database, options: MigrationRunnerOptions): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      checksum_sha256 TEXT NOT NULL CHECK (length(checksum_sha256) = 64),
      applied_at TEXT NOT NULL
    ) STRICT
  `);

  const migrations = loadMigrations(options.directory);
  const applied = database
    .query<AppliedMigrationRow, []>(
      "SELECT version, name, checksum_sha256 FROM schema_migrations ORDER BY version",
    )
    .all();
  const availableByVersion = new Map(migrations.map((migration) => [migration.version, migration]));

  for (const row of applied) {
    const migration = availableByVersion.get(row.version);
    if (migration === undefined) {
      throw new MigrationError(`Applied migration ${row.version} is missing from disk.`);
    }
    if (migration.name !== row.name || migration.checksum !== row.checksum_sha256) {
      throw new MigrationError(`Checksum mismatch for applied migration ${row.version}.`);
    }
  }

  const appliedVersions = new Set(applied.map((row) => row.version));
  const latestAppliedVersion = applied.at(-1)?.version;
  if (
    latestAppliedVersion !== undefined &&
    migrations.some(
      (migration) =>
        migration.version < latestAppliedVersion && !appliedVersions.has(migration.version),
    )
  ) {
    throw new MigrationError(
      `Pending migration precedes already applied migration ${latestAppliedVersion}.`,
    );
  }
  const now = options.now ?? (() => new Date().toISOString());
  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue;
    applyMigration(database, migration, now());
  }
}

function loadMigrations(directory: string): MigrationFile[] {
  const filenames = readdirSync(directory)
    .filter((filename) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(filename))
    .sort();
  const seenVersions = new Set<string>();
  return filenames.map((filename) => {
    const match = /^(\d{4})_([a-z0-9_]+)\.sql$/u.exec(filename);
    if (match === null) throw new MigrationError(`Invalid migration filename ${filename}.`);
    const version = match[1];
    const name = match[2];
    if (version === undefined || name === undefined) {
      throw new MigrationError(`Invalid migration filename ${filename}.`);
    }
    if (seenVersions.has(version)) {
      throw new MigrationError(`Duplicate migration version ${version}.`);
    }
    seenVersions.add(version);
    const sql = readFileSync(join(directory, filename), "utf8");
    return {
      version,
      name,
      sql,
      checksum: createHash("sha256").update(sql).digest("hex"),
    };
  });
}

function applyMigration(database: Database, migration: MigrationFile, appliedAt: string): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(migration.sql);
    database
      .query<void, [string, string, string, string]>(
        `INSERT INTO schema_migrations(version, name, checksum_sha256, applied_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(migration.version, migration.name, migration.checksum, appliedAt);
    database.exec("COMMIT");
  } catch (error) {
    if (database.inTransaction) database.exec("ROLLBACK");
    throw new MigrationError(`Migration ${migration.version}_${migration.name} failed.`, {
      cause: error,
    });
  }
}
