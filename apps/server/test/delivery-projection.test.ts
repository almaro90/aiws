import { afterEach, describe, expect, test } from "bun:test";
import {
  ConnectionUseCases,
  ProjectUseCases,
  SystemClock,
  TaskUseCases,
  UlidIdGenerator,
} from "@aiws/core";
import { openDatabase, SqliteUnitOfWork } from "@aiws/sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DeliveryProjectionService,
  DeliverySynchronizationError,
} from "../src/delivery-projection.ts";
import {
  ManagedGitProviderRegistry,
  type ManagedGitProvider,
} from "../src/integrations/managed-git-provider.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("Delivery Projection", () => {
  test("persists provider-neutral observations, preserves Task state and keeps stale evidence on error", async () => {
    const directory = mkdtempSync(join(tmpdir(), "aiws-delivery-projection-"));
    directories.push(directory);
    const database = openDatabase({ path: join(directory, "aiws.sqlite") });
    const unitOfWork = new SqliteUnitOfWork(database);
    const clock = new SystemClock();
    const ids = new UlidIdGenerator(clock);
    const projects = new ProjectUseCases(unitOfWork, { clock, ids });
    const tasks = new TaskUseCases(unitOfWork, { clock, ids });
    const connections = new ConnectionUseCases(unitOfWork, { clock, ids });
    const connection = await connections.register({
      host: "https://github.com",
      externalAccountId: "delivery",
      displayName: "Delivery",
      installationId: "delivery",
    });
    const project = await projects.createManaged({
      name: "Delivery",
      repositoryPath: "/repos/delivery",
      accountScope: "work",
      connectionId: connection.id,
      remoteRepositoryId: "42",
      remoteFullName: "acme/delivery",
      remoteWebUrl: "https://github.com/acme/delivery",
      defaultBranch: "main",
    });
    let task = await tasks.create({
      projectId: project.id,
      userRequest: "Observe the PR",
      actorType: "web",
    });
    task = await tasks.update({
      taskId: task.id,
      expectedVersion: task.version,
      changes: { prUrl: "https://github.com/acme/delivery/pull/7" },
      actorType: "web",
    });
    if (task.currentDelivery === null) throw new Error("Expected a managed Delivery.");
    let fail = false;
    const provider: ManagedGitProvider = {
      provider: "github",
      listRepositories: async () => [],
      getRepository: async () => {
        throw new Error("unused");
      },
      listBranches: async () => [],
      gitCredentials: async () => {
        throw new Error("unused");
      },
      publishPullRequest: async () => {
        throw new Error("unused");
      },
      observeDelivery: async () => {
        if (fail) throw new Error("upstream token=secret-value failed");
        return {
          prState: "merged",
          checksState: "failed",
          checksPassed: 3,
          checksFailed: 1,
          checksPending: 0,
          externalUpdatedAt: "2026-07-26T12:00:00.000Z",
        };
      },
    };
    const service = new DeliveryProjectionService(
      database,
      connections,
      new ManagedGitProviderRegistry([provider]),
      (work) => unitOfWork.coordinate(work),
      () => new Date("2026-07-26T12:01:00.000Z"),
    );
    const observed = await service.refresh(task.currentDelivery.id);
    expect(observed).toMatchObject({
      prState: "merged",
      checksState: "failed",
      checksPassed: 3,
      checksFailed: 1,
      lastSynchronizedAt: "2026-07-26T12:01:00.000Z",
      synchronizationError: null,
    });
    expect((await tasks.get(task.id)).status).toBe("draft");
    fail = true;
    await expect(service.refresh(task.currentDelivery.id)).rejects.toBeInstanceOf(
      DeliverySynchronizationError,
    );
    const stale = await service.get(task.currentDelivery.id);
    expect(stale).toMatchObject({
      prState: "merged",
      checksState: "failed",
      synchronizationError: "upstream token=[REDACTED] failed",
    });
    await unitOfWork.close();
  });
});
