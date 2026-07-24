import {
  AttachmentUseCases,
  ProjectUseCases,
  QuestionUseCases,
  SystemClock,
  TaskUseCases,
  UlidIdGenerator,
  AgentProfileUseCases,
  ConnectionUseCases,
  RunUseCases,
  MessageUseCases,
} from "@aiws/core";
import { FileAttachmentBlobStore, openDatabase, SqliteUnitOfWork } from "@aiws/sqlite";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ConfigError, type Config } from "../config.ts";
import { createApp } from "../http/app.ts";
import { JsonLogger } from "../logging/logger.ts";
import { RepositoryValidator } from "../repositories/repository-validator.ts";
import { GitHubAppGateway } from "../integrations/github-app.ts";
import { RunnerModelCatalogClient } from "../integrations/runner-model-catalog.ts";
import { RunnerActivityMonitor } from "../runner-activity.ts";
import {
  NotificationDispatcher,
  NotificationSettingsService,
  NtfyPublisher,
  parseNotificationEncryptionKey,
} from "../notifications.ts";

export async function composeServer(config: Config) {
  const credentials = requireCredentials(config);
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  const migrationsDirectory = await findMigrationsDirectory();
  const database = openDatabase({
    path: join(config.dataDir, "aiws.sqlite"),
    ...(migrationsDirectory === undefined ? {} : { migrationsDirectory }),
  });
  try {
    const unitOfWork = new SqliteUnitOfWork(database);
    const clock = new SystemClock();
    const ids = new UlidIdGenerator(clock);
    const blobStore = await FileAttachmentBlobStore.create(config.dataDir);
    await blobStore.cleanupOrphans(
      new Date(clock.now().getTime() - config.orphanTtlSeconds * 1_000),
      (storageKey) =>
        database
          .query<{ readonly found: number }, [string]>(
            "SELECT 1 AS found FROM attachments WHERE storage_key = ? LIMIT 1",
          )
          .get(storageKey) !== null,
    );
    const projects = new ProjectUseCases(unitOfWork, {
      clock,
      ids,
    });
    const tasks = new TaskUseCases(unitOfWork, { clock, ids });
    const questions = new QuestionUseCases(unitOfWork, { clock, ids });
    const attachments = new AttachmentUseCases(
      unitOfWork,
      blobStore,
      { clock, ids },
      {
        maximumAttachmentsPerTask: config.maxAttachmentsPerTask,
        maximumAttachmentBytes: config.maxAttachmentBytes,
      },
    );
    const connections = new ConnectionUseCases(unitOfWork, { clock, ids });
    const agentProfiles = new AgentProfileUseCases(unitOfWork, { clock, ids });
    const runs = new RunUseCases(unitOfWork, { clock, ids });
    const messages = new MessageUseCases(
      unitOfWork,
      blobStore,
      { clock, ids },
      {
        maximumAttachmentsPerTask: config.maxAttachmentsPerTask,
        maximumAttachmentBytes: config.maxAttachmentBytes,
      },
    );
    const github =
      config.githubAppId === undefined ||
      config.githubAppSlug === undefined ||
      config.githubPrivateKeyBase64 === undefined
        ? undefined
        : new GitHubAppGateway({
            appId: config.githubAppId,
            appSlug: config.githubAppSlug,
            privateKey: Buffer.from(config.githubPrivateKeyBase64, "base64").toString("utf8"),
          });
    const repositoryValidator = await RepositoryValidator.create(credentials.allowedRepoRoots);
    const openApiDocument = await readOpenApiSnapshot();
    const webAssetsDirectory = await findWebAssets();
    const modelCatalog =
      config.runnerControlUrl === undefined || config.runnerControlSecret === undefined
        ? undefined
        : new RunnerModelCatalogClient(config.runnerControlUrl, config.runnerControlSecret);
    const runnerActivity = new RunnerActivityMonitor();
    const ntfyPublisher = new NtfyPublisher();
    const notificationSettings = new NotificationSettingsService(
      database,
      parseNotificationEncryptionKey(config.notificationEncryptionKey),
      ntfyPublisher,
      (work) => unitOfWork.coordinate(work),
    );
    const notificationDispatcher = new NotificationDispatcher(
      database,
      notificationSettings,
      ntfyPublisher,
      credentials.publicUrl,
      () => new Date(),
      (work) => unitOfWork.coordinate(work),
    );
    const app = createApp({
      projects,
      tasks,
      questions,
      attachments,
      connections,
      agentProfiles,
      runs,
      messages,
      repositoryValidator,
      openApiDocument,
      healthCheck: () => {
        database.query("SELECT 1").get();
        return true;
      },
      logger: new JsonLogger(),
      publicUrl: credentials.publicUrl,
      adminUsername: credentials.adminUsername,
      adminPasswordHash: credentials.adminPasswordHash,
      sessionSecret: credentials.sessionSecret,
      apiTokenHash: credentials.apiTokenHash,
      ...(config.runnerTokenHash === undefined ? {} : { runnerTokenHash: config.runnerTokenHash }),
      ...(github === undefined ? {} : { github }),
      ...(modelCatalog === undefined ? {} : { modelCatalog }),
      runnerActivity,
      notificationSettings,
      repositoriesDir: config.repositoriesDir,
      runLogsDirectory: join(config.dataDir, "run-logs"),
      sessionTtlSeconds: config.sessionTtlSeconds,
      loginAttempts: config.loginAttempts,
      loginWindowSeconds: config.loginWindowSeconds,
      production: config.env === "production",
      trustProxy: config.trustProxy,
      ...(webAssetsDirectory === undefined ? {} : { webAssetsDirectory }),
    });
    return { app, unitOfWork, notificationDispatcher };
  } catch (error) {
    database.close();
    throw error;
  }
}

async function findWebAssets(): Promise<string | undefined> {
  const candidates = [
    join(process.cwd(), "apps/web/dist"),
    join(process.cwd(), "web/dist"),
    join(process.cwd(), "public"),
  ];
  for (const candidate of candidates) {
    if (await Bun.file(join(candidate, "index.html")).exists()) return candidate;
  }
  return undefined;
}

async function findMigrationsDirectory(): Promise<string | undefined> {
  const candidates = [
    join(process.cwd(), "migrations"),
    join(process.cwd(), "packages/sqlite/migrations"),
  ];
  for (const candidate of candidates) {
    if (await Bun.file(join(candidate, "0001_initial.sql")).exists()) return candidate;
  }
  return undefined;
}

async function readOpenApiSnapshot(): Promise<Readonly<Record<string, unknown>>> {
  const candidates = [
    new URL("../../../../docs/contracts/openapi.yaml", import.meta.url),
    new URL("../../../docs/contracts/openapi.yaml", import.meta.url),
    join(process.cwd(), "docs/contracts/openapi.yaml"),
  ];
  const path = await firstExisting(candidates);
  if (path === null) throw new Error("OpenAPI snapshot was not found.");
  const document: unknown = Bun.YAML.parse(await Bun.file(path).text());
  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    throw new Error("OpenAPI snapshot is invalid.");
  }
  return document as Readonly<Record<string, unknown>>;
}

async function firstExisting(candidates: readonly (URL | string)[]): Promise<URL | string | null> {
  for (const candidate of candidates) {
    if (await Bun.file(candidate).exists()) return candidate;
  }
  return null;
}

function requireCredentials(config: Config) {
  const names = [
    "publicUrl",
    "allowedRepoRoots",
    "adminUsername",
    "adminPasswordHash",
    "sessionSecret",
    "apiTokenHash",
  ] as const;
  for (const name of names) {
    if (config[name] === undefined) throw new ConfigError(name, "is required to start the server");
  }
  return config as Config & {
    publicUrl: string;
    allowedRepoRoots: string[];
    adminUsername: string;
    adminPasswordHash: string;
    sessionSecret: string;
    apiTokenHash: string;
  };
}
