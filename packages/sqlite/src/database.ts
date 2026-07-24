import { Database } from "bun:sqlite";
import { join } from "node:path";
import { runMigrations } from "./migrations.ts";

export interface OpenDatabaseOptions {
  readonly path: string;
  readonly migrationsDirectory?: string;
  readonly now?: () => string;
}

export function openDatabase(options: OpenDatabaseOptions): Database {
  const database = new Database(options.path, { create: true, strict: true });
  try {
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA busy_timeout = 5000");
    database.exec("PRAGMA synchronous = NORMAL");
    runMigrations(database, {
      directory: options.migrationsDirectory ?? join(import.meta.dir, "../migrations"),
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
