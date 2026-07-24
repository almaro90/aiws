import type { Stores, UnitOfWork } from "@aiws/core";
import type { Database } from "bun:sqlite";
import {
  SqliteAttachmentMetadataRepository,
  SqliteProjectRepository,
  SqliteQuestionRepository,
  SqliteTaskEventRepository,
  SqliteTaskRepository,
  SqliteConnectionRepository,
  SqliteAgentProfileRepository,
  SqliteRunRepository,
  SqliteCycleRepository,
  SqliteMessageRepository,
  SqliteSpecRevisionRepository,
  SqliteQuestionAnswerRepository,
  SqliteDeliveryRepository,
  SqliteTimelineRepository,
} from "./repositories.ts";

export class SqliteUnitOfWork implements UnitOfWork {
  readonly stores: Stores;
  private queue: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(private readonly database: Database) {
    this.stores = {
      projects: new SqliteProjectRepository(database),
      tasks: new SqliteTaskRepository(database),
      questions: new SqliteQuestionRepository(database),
      attachments: new SqliteAttachmentMetadataRepository(database),
      events: new SqliteTaskEventRepository(database),
      connections: new SqliteConnectionRepository(database),
      agentProfiles: new SqliteAgentProfileRepository(database),
      runs: new SqliteRunRepository(database),
      cycles: new SqliteCycleRepository(database),
      messages: new SqliteMessageRepository(database),
      specRevisions: new SqliteSpecRevisionRepository(database),
      questionAnswers: new SqliteQuestionAnswerRepository(database),
      deliveries: new SqliteDeliveryRepository(database),
      timeline: new SqliteTimelineRepository(database),
    };
  }

  async execute<T>(work: (stores: Stores) => Promise<T>): Promise<T> {
    return this.coordinate(async () => {
      this.database.exec("BEGIN IMMEDIATE");
      try {
        const result = await work(this.stores);
        this.database.exec("COMMIT");
        return result;
      } catch (error) {
        if (this.database.inTransaction) this.database.exec("ROLLBACK");
        throw error;
      }
    });
  }

  async coordinate<T>(work: () => Promise<T> | T): Promise<T> {
    if (this.closed) throw new Error("SQLite UnitOfWork is closed.");
    let release = (): void => {};
    const previous = this.queue;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    try {
      return await work();
    } finally {
      release();
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.queue;
    this.database.close();
  }
}
