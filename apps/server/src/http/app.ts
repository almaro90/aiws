import {
  type ActorType,
  type AttachmentId,
  type AttachmentUseCases,
  DomainError,
  type ProjectChanges,
  type ProjectId,
  type Project,
  type ProjectListQuery,
  type ProjectUseCases,
  type QuestionId,
  type QuestionOptionId,
  type QuestionUseCases,
  type TaskAggregate,
  type TaskChanges,
  type TaskId,
  type TaskListQuery,
  type TaskUseCases,
  type ConnectionUseCases,
  type AgentProfileUseCases,
  type RunUseCases,
  type ConnectionId,
  type AgentProfileId,
  type RunId,
  type MessageUseCases,
  type AgentModelCatalog,
  type AgentAuthMode,
  type VerificationContractUseCases,
} from "@aiws/core";
import {
  attachmentIdSchema,
  createProjectSchema,
  createTaskSchema,
  answerQuestionSchema,
  listActivitySchema,
  listProjectsSchema,
  listTasksSchema,
  loginSchema,
  projectIdSchema,
  projectReadinessRequestSchema,
  questionDefinitionSchema,
  questionIdSchema,
  reasonSchema,
  taskIdSchema,
  transitionTaskSchema,
  updateTaskSchema,
  updateProjectSchema,
  validationDetails,
  advanceRunSchema,
  agentProfileIdSchema,
  cancelRunSchema,
  completeRunSchema,
  completeCurationRunSchema,
  connectionIdSchema,
  createAgentProfileSchema,
  createPullRequestSchema,
  failRunSchema,
  importRepositorySchema,
  runIdSchema,
  reconcileRunsSchema,
  retryRunSchema,
  setAgentProfileEnabledSchema,
  listTimelineSchema,
  messageTextSchema,
  modelCatalogRequestSchema,
  updateNotificationSettingsSchema,
  azureAuthorizationIdSchema,
  completeAzureAuthorizationSchema,
  replaceVerificationContractSchema,
  disableVerificationContractSchema,
  recordVerificationResultsSchema,
  waiveVerificationSchema,
  recordRunProvenanceSchema,
  deliveryIdSchema,
} from "@aiws/contracts";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Logger } from "../logging/logger.ts";
import { LoginRateLimiter } from "../auth/rate-limit.ts";
import { createSession, safeEqual, sha256Matches, verifySession } from "../auth/session.ts";
import type { RepositoryValidator } from "../repositories/repository-validator.ts";
import { domainStatus, HttpError } from "./errors.ts";
import type { z } from "zod";
import { parseSingleFileMultipart } from "./multipart.ts";
import type { GitHubAppGateway } from "../integrations/github-app.ts";
import type { RunnerControlClient } from "../integrations/runner-model-catalog.ts";
import type { ProjectReadinessService } from "../readiness.ts";
import type { RunnerActivityMonitor } from "../runner-activity.ts";
import type { AttentionService } from "../attention.ts";
import {
  DeliverySynchronizationError,
  type DeliveryProjectionService,
} from "../delivery-projection.ts";
import type { ProductMetricsService } from "../metrics.ts";
import { createOauthState, verifyOauthState } from "../integrations/github-app.ts";
import { join } from "node:path";
import { mkdir, rename, rm } from "node:fs/promises";
import type { NotificationSettings, NotificationSettingsPatch } from "../notifications.ts";
import type { AzureDevOpsAuthorizationService } from "../integrations/azure-devops.ts";
import type { ManagedGitProviderRegistry } from "../integrations/managed-git-provider.ts";

type Authentication = { readonly actorType: ActorType; readonly username?: string };

type Variables = {
  requestId: string;
  authentication: Authentication;
};

export interface AppOptions {
  readonly projects: ProjectUseCases;
  readonly tasks: TaskUseCases;
  readonly questions: QuestionUseCases;
  readonly attachments: AttachmentUseCases;
  readonly connections: ConnectionUseCases;
  readonly agentProfiles: AgentProfileUseCases;
  readonly runs: RunUseCases;
  readonly messages: MessageUseCases;
  readonly verificationContracts: VerificationContractUseCases;
  readonly repositoryValidator: RepositoryValidator;
  readonly openApiDocument: Readonly<Record<string, unknown>>;
  readonly healthCheck: () => boolean | Promise<boolean>;
  readonly logger: Logger;
  readonly publicUrl: string;
  readonly adminUsername: string;
  readonly adminPasswordHash: string;
  readonly sessionSecret: string;
  readonly apiTokenHash: string;
  readonly runnerTokenHash?: string;
  readonly github?: GitHubAppGateway;
  readonly azureAuthorization?: AzureDevOpsAuthorizationService;
  readonly managedGitProviders?: ManagedGitProviderRegistry;
  readonly modelCatalog?: Pick<RunnerControlClient, "list">;
  readonly projectReadiness?: Pick<ProjectReadinessService, "check">;
  readonly runnerActivity?: Pick<RunnerActivityMonitor, "seen" | "status">;
  readonly attention?: Pick<AttentionService, "list">;
  readonly deliveryProjection?: Pick<DeliveryProjectionService, "get" | "refresh">;
  readonly metrics?: Pick<ProductMetricsService, "project">;
  readonly repositoriesDir: string;
  readonly runLogsDirectory?: string;
  readonly sessionTtlSeconds: number;
  readonly loginAttempts: number;
  readonly loginWindowSeconds: number;
  readonly production: boolean;
  readonly trustProxy: boolean;
  readonly webAssetsDirectory?: string;
  readonly now?: () => Date;
  readonly notificationSettings?: {
    get(): NotificationSettings;
    update(patch: NotificationSettingsPatch, now?: Date): Promise<NotificationSettings>;
    test(): Promise<void>;
  };
}

export function createApp(options: AppOptions): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>();
  const now = options.now ?? (() => new Date());
  const rateLimiter = new LoginRateLimiter(options.loginAttempts, options.loginWindowSeconds, () =>
    now().getTime(),
  );
  const managedBranches = async (project: Project) => {
    if (
      project.repositoryMode !== "managed" ||
      project.connectionId === null ||
      project.remoteFullName === null
    ) {
      throw new HttpError(
        409,
        "invalid_repository_mode",
        "Project does not use a managed repository.",
      );
    }
    const connection = await options.connections.get(project.connectionId);
    if (connection.status !== "active")
      throw new HttpError(409, "integration_unavailable", "Managed Git Connection is not active.");
    const provider = managedProvider(connection);
    return provider.listBranches(
      connection,
      project.remoteFullName,
      project.remoteRepositoryId ?? undefined,
    );
  };
  const managedProvider = (connection: Awaited<ReturnType<ConnectionUseCases["get"]>>) => {
    try {
      if (options.managedGitProviders !== undefined) {
        return options.managedGitProviders.resolve(connection);
      }
      if (connection.provider === "github" && options.github !== undefined) return options.github;
      throw new Error("Provider is unavailable.");
    } catch {
      throw new HttpError(
        409,
        "integration_unavailable",
        `Managed Git provider '${connection.provider}' is not configured.`,
      );
    }
  };
  const assertRemoteBranch = async (
    project: Project,
    branchName: string,
    field: "baseBranch" | "defaultBranch",
  ) => {
    const branches = await managedBranches(project);
    if (!branches.some((branch) => branch.name === branchName)) {
      throw new HttpError(422, "validation_error", "Input validation failed.", {
        fields: [{ path: field, message: "Branch does not exist in the managed repository." }],
      });
    }
  };

  app.use("*", async (context, next) => {
    const requestId = `req_${crypto.randomUUID()}`;
    const startedAt = performance.now();
    context.set("requestId", requestId);
    await next();
    context.header("X-Request-Id", requestId);
    context.header("Content-Security-Policy", securityPolicy);
    context.header("X-Content-Type-Options", "nosniff");
    context.header("Referrer-Policy", "no-referrer");
    context.header("X-Frame-Options", "DENY");
    context.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    options.logger.log({
      level: "info",
      time: now().toISOString(),
      requestId,
      method: context.req.method,
      path: new URL(context.req.url).pathname,
      status: context.res.status,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    });
  });

  app.onError((error, context) => {
    const requestId = context.get("requestId") ?? `req_${crypto.randomUUID()}`;
    context.header("X-Request-Id", requestId);
    if (error instanceof HttpError) {
      logFailure(options.logger, now(), requestId, context.req.raw, error.status, error.name);
      for (const [name, value] of Object.entries(error.headers ?? {})) context.header(name, value);
      return context.json(
        errorEnvelope(error.code, error.message, requestId, error.details),
        error.status as ContentfulStatusCode,
      );
    }
    if (error instanceof DomainError) {
      const status = domainStatus(error);
      logFailure(options.logger, now(), requestId, context.req.raw, status, error.name);
      return context.json(
        errorEnvelope(error.code, error.message, requestId, error.details),
        status as ContentfulStatusCode,
      );
    }
    options.logger.log({
      level: "error",
      time: now().toISOString(),
      requestId,
      method: context.req.method,
      path: new URL(context.req.url).pathname,
      status: 500,
      durationMs: 0,
      error: error instanceof Error ? error.name : "UnknownError",
    });
    return context.json(errorEnvelope("internal_error", "Internal server error.", requestId), 500);
  });

  app.use("/api/v1/*", async (context, next) => {
    const path = new URL(context.req.url).pathname;
    if (
      path === "/api/v1/health" ||
      path === "/api/v1/auth/login" ||
      path === "/api/v1/connections/github/callback" ||
      path === "/api/v1/connections/azure-devops/callback"
    ) {
      return next();
    }

    const authorization = context.req.header("Authorization");
    const session = getCookie(context, "aiws_session");
    let authentication: Authentication | null = null;
    if (authorization?.startsWith("Bearer ")) {
      const token = authorization.slice("Bearer ".length);
      if (
        token.length > 0 &&
        options.runnerTokenHash !== undefined &&
        sha256Matches(token, options.runnerTokenHash)
      ) {
        authentication = { actorType: "system" };
      } else if (token.length > 0 && sha256Matches(token, options.apiTokenHash)) {
        authentication = { actorType: "cli" };
      }
    } else if (session !== undefined) {
      const payload = verifySession(session, options.sessionSecret, now());
      if (payload !== null) authentication = { actorType: "web", username: payload.sub };
    }
    if (authentication === null) throw unauthorized();
    context.set("authentication", authentication);
    if (authentication.actorType === "system") options.runnerActivity?.seen();

    if (authentication.actorType === "web" && isMutation(context.req.method)) {
      if (context.req.header("Origin") !== options.publicUrl) {
        throw new HttpError(403, "forbidden", "Origin is not allowed.");
      }
    }
    return next();
  });

  app.get("/api/v1/health", async (context) => {
    try {
      if (await options.healthCheck()) return context.json({ status: "ok", version: "0.8.0" });
    } catch {
      // Health responses intentionally do not disclose storage failures.
    }
    return context.json({ status: "unhealthy", version: "0.8.0" }, 503);
  });
  app.get("/api/v1/system/runner", (context) =>
    context.json(
      options.runnerActivity?.status() ?? {
        status: "unknown",
        lastSeenAt: null,
        offlineAfterSeconds: 45,
      },
    ),
  );
  app.get("/api/v1/attention", (context) => {
    const limitValue = context.req.query("limit") ?? "50";
    const limit = Number(limitValue);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new HttpError(422, "validation_error", "Attention limit is invalid.");
    }
    try {
      const cursor = context.req.query("cursor");
      return context.json(
        options.attention?.list({
          limit,
          ...(cursor === undefined ? {} : { cursor }),
          runner: options.runnerActivity?.status() ?? {
            status: "unknown",
            lastSeenAt: null,
            offlineAfterSeconds: 45,
          },
        }) ?? { items: [], nextCursor: null },
      );
    } catch {
      throw new HttpError(422, "validation_error", "Attention cursor is invalid.");
    }
  });
  app.get("/api/v1/deliveries/:deliveryId/projection", async (context) => {
    const deliveryId = parse(deliveryIdSchema, context.req.param("deliveryId"));
    const delivery = await options.deliveryProjection?.get(deliveryId);
    if (delivery === null || delivery === undefined)
      throw new HttpError(404, "not_found", "Delivery was not found.");
    return context.json(delivery);
  });
  app.get("/api/v1/projects/:projectId/metrics", (context) => {
    const projectId = parse(projectIdSchema, context.req.param("projectId"));
    const from = context.req.query("from");
    const to = context.req.query("to");
    const utc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
    if (from === undefined || to === undefined || !utc.test(from) || !utc.test(to))
      throw new HttpError(
        422,
        "validation_error",
        "Metrics require from/to UTC timestamps with milliseconds.",
      );
    try {
      const result = options.metrics?.project(projectId, from, to);
      if (result === undefined)
        throw new HttpError(503, "service_unavailable", "Product metrics are unavailable.");
      return context.json(result);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof Error && error.message === "Project was not found.")
        throw new HttpError(404, "not_found", error.message);
      throw new HttpError(
        422,
        "validation_error",
        error instanceof Error ? error.message : "Metrics range is invalid.",
      );
    }
  });
  app.post("/api/v1/deliveries/:deliveryId/projection/refresh", async (context) => {
    const deliveryId = parse(deliveryIdSchema, context.req.param("deliveryId"));
    try {
      const delivery = await options.deliveryProjection?.refresh(deliveryId);
      if (delivery === undefined)
        throw new HttpError(503, "service_unavailable", "Delivery synchronization is unavailable.");
      return context.json(delivery);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof DeliverySynchronizationError)
        throw new HttpError(502, "delivery_synchronization_failed", error.message);
      if (error instanceof Error && error.message === "Delivery was not found.")
        throw new HttpError(404, "not_found", error.message);
      throw new HttpError(
        409,
        "delivery_not_synchronizable",
        error instanceof Error ? error.message : "Delivery cannot be synchronized.",
      );
    }
  });

  app.post("/api/v1/auth/login", async (context) => {
    const limited = rateLimiter.consume(clientIp(context.req.raw, options.trustProxy));
    if (!limited.allowed) {
      throw new HttpError(429, "rate_limit_exceeded", "Too many login attempts.", undefined, {
        "Retry-After": String(limited.retryAfter),
      });
    }
    const input = parse(loginSchema, await parseJson(context.req.raw));
    const passwordMatches = await Bun.password.verify(input.password, options.adminPasswordHash);
    const usernameMatches = safeEqual(input.username, options.adminUsername);
    if (!passwordMatches || !usernameMatches) throw unauthorized();

    setCookie(
      context,
      "aiws_session",
      createSession(options.adminUsername, options.sessionSecret, now(), options.sessionTtlSeconds),
      {
        httpOnly: true,
        secure: options.production,
        sameSite: "Strict",
        path: "/",
        maxAge: options.sessionTtlSeconds,
      },
    );
    return context.body(null, 204);
  });

  app.post("/api/v1/auth/logout", (context) => {
    requireWeb(context.get("authentication"));
    deleteCookie(context, "aiws_session", {
      secure: options.production,
      sameSite: "Strict",
      path: "/",
    });
    return context.body(null, 204);
  });

  app.get("/api/v1/auth/session", (context) => {
    const authentication = context.get("authentication");
    requireWeb(authentication);
    return context.json({ authenticated: true, username: authentication.username as string });
  });

  app.get("/api/v1/openapi.json", (context) => context.json(options.openApiDocument));

  app.get("/api/v1/notification-settings", (context) => {
    if (options.notificationSettings === undefined) {
      throw new HttpError(503, "notification_unavailable", "Notifications are unavailable.");
    }
    return context.json(options.notificationSettings.get());
  });

  app.patch("/api/v1/notification-settings", async (context) => {
    if (options.notificationSettings === undefined) {
      throw new HttpError(503, "notification_unavailable", "Notifications are unavailable.");
    }
    const input = parse(updateNotificationSettingsSchema, await parseJson(context.req.raw));
    return context.json(
      await options.notificationSettings.update(
        {
          ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
          ...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }),
          ...(input.topic === undefined ? {} : { topic: input.topic }),
          ...(input.accessToken === undefined ? {} : { accessToken: input.accessToken }),
        },
        now(),
      ),
    );
  });

  app.post("/api/v1/notification-settings/test", async (context) => {
    if (options.notificationSettings === undefined) {
      throw new HttpError(503, "notification_unavailable", "Notifications are unavailable.");
    }
    try {
      await options.notificationSettings.test();
      return context.body(null, 204);
    } catch {
      throw new HttpError(
        503,
        "notification_unavailable",
        "The test notification could not be delivered.",
      );
    }
  });

  app.get("/api/v1/projects", async (context) => {
    const input = parse(listProjectsSchema, context.req.query());
    const query: ProjectListQuery = {
      archived: input.archived,
      limit: input.limit,
      ...(input.gitProvider === undefined ? {} : { gitProvider: input.gitProvider }),
      ...(input.accountScope === undefined ? {} : { accountScope: input.accountScope }),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    };
    return context.json(await options.projects.list(query));
  });

  app.post("/api/v1/projects", async (context) => {
    const input = parse(createProjectSchema, await parseJson(context.req.raw));
    const repositoryPath = await options.repositoryValidator.validate(input.repositoryPath);
    const project = await options.projects.create({ ...input, repositoryPath });
    return context.json(project, 201);
  });

  app.get("/api/v1/projects/:projectId", async (context) => {
    const id = parse(projectIdSchema, context.req.param("projectId")) as ProjectId;
    return context.json(await options.projects.get(id));
  });

  app.get("/api/v1/projects/:projectId/branches", async (context) => {
    const id = parse(projectIdSchema, context.req.param("projectId")) as ProjectId;
    return context.json(await managedBranches(await options.projects.get(id)));
  });

  app.post("/api/v1/projects/:projectId/readiness-check", async (context) => {
    const id = parse(projectIdSchema, context.req.param("projectId")) as ProjectId;
    const input = parse(projectReadinessRequestSchema, await parseJson(context.req.raw));
    if (options.projectReadiness === undefined) {
      throw new HttpError(503, "readiness_unavailable", "Project Readiness is unavailable.");
    }
    return context.json(await options.projectReadiness.check(id, input.depth));
  });

  app.get("/api/v1/projects/:projectId/verification-contract", async (context) => {
    const id = parse(projectIdSchema, context.req.param("projectId")) as ProjectId;
    return context.json(await options.verificationContracts.get(id));
  });

  app.get("/api/v1/projects/:projectId/verification-contract/revisions", async (context) => {
    const id = parse(projectIdSchema, context.req.param("projectId")) as ProjectId;
    return context.json(await options.verificationContracts.history(id));
  });

  app.put("/api/v1/projects/:projectId/verification-contract", async (context) => {
    const projectId = parse(projectIdSchema, context.req.param("projectId")) as ProjectId;
    const input = parse(replaceVerificationContractSchema, await parseJson(context.req.raw));
    return context.json(await options.verificationContracts.replace({ projectId, ...input }));
  });

  app.post("/api/v1/projects/:projectId/verification-contract/disable", async (context) => {
    const projectId = parse(projectIdSchema, context.req.param("projectId")) as ProjectId;
    const input = parse(disableVerificationContractSchema, await parseJson(context.req.raw));
    return context.json(await options.verificationContracts.disable({ projectId, ...input }));
  });

  app.patch("/api/v1/projects/:projectId", async (context) => {
    const id = parse(projectIdSchema, context.req.param("projectId")) as ProjectId;
    const input = parse(updateProjectSchema, await parseJson(context.req.raw));
    if (input.defaultBranch !== undefined) {
      const project = await options.projects.get(id);
      await assertRemoteBranch(project, input.defaultBranch, "defaultBranch");
    }
    const changes: ProjectChanges = {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.gitProvider === undefined ? {} : { gitProvider: input.gitProvider }),
      ...(input.accountScope === undefined ? {} : { accountScope: input.accountScope }),
      ...(input.defaultBranch === undefined ? {} : { defaultBranch: input.defaultBranch }),
      ...(input.repositoryPath === undefined
        ? {}
        : { repositoryPath: await options.repositoryValidator.validate(input.repositoryPath) }),
      ...(input.automationEnabled === undefined
        ? {}
        : { automationEnabled: input.automationEnabled }),
      ...(input.curationAgentProfileId === undefined
        ? {}
        : {
            curationAgentProfileId: input.curationAgentProfileId as AgentProfileId | null,
          }),
      ...(input.implementationAgentProfileId === undefined
        ? {}
        : {
            implementationAgentProfileId:
              input.implementationAgentProfileId as AgentProfileId | null,
          }),
      ...(input.scheduleCron === undefined ? {} : { scheduleCron: input.scheduleCron }),
      ...(input.scheduleTimezone === undefined ? {} : { scheduleTimezone: input.scheduleTimezone }),
      ...(input.maxConcurrency === undefined ? {} : { maxConcurrency: input.maxConcurrency }),
      ...(input.readyPolicy === undefined ? {} : { readyPolicy: input.readyPolicy }),
    };
    return context.json(await options.projects.update(id, changes));
  });

  app.post("/api/v1/projects/:projectId/archive", async (context) => {
    const id = parse(projectIdSchema, context.req.param("projectId")) as ProjectId;
    return context.json(await options.projects.archive(id));
  });

  app.post("/api/v1/projects/:projectId/unarchive", async (context) => {
    const id = parse(projectIdSchema, context.req.param("projectId")) as ProjectId;
    return context.json(await options.projects.unarchive(id));
  });

  app.get("/api/v1/connections", async (context) => context.json(await options.connections.list()));

  app.get("/api/v1/connections/github/install", (context) => {
    if (context.get("authentication").actorType === "system") {
      throw new HttpError(403, "forbidden", "Runner authentication cannot install integrations.");
    }
    if (options.github === undefined)
      throw new HttpError(409, "integration_unavailable", "GitHub App is not configured.");
    const returnTo = safeReturnTo(context.req.query("returnTo"));
    const state = createOauthState(options.sessionSecret, returnTo);
    return context.json({ url: options.github.installationUrl(state) });
  });

  app.get("/api/v1/connections/github/callback", async (context) => {
    if (options.github === undefined)
      throw new HttpError(409, "integration_unavailable", "GitHub App is not configured.");
    const state = context.req.query("state") ?? "";
    const verified = verifyOauthState(state, options.sessionSecret);
    if (verified === null)
      throw new HttpError(403, "forbidden", "GitHub installation state is invalid or expired.");
    const installationId = context.req.query("installation_id");
    if (installationId === undefined || !/^\d+$/u.test(installationId))
      throw new HttpError(422, "validation_error", "GitHub installation ID is invalid.");
    const account = await options.github.inspectInstallation(installationId);
    const connection = await options.connections.register({
      host: "https://github.com",
      installationId,
      ...account,
    });
    const location = new URL(verified.returnTo, options.publicUrl);
    location.searchParams.set("connectionId", connection.id);
    return context.redirect(location.toString(), 303);
  });

  app.get("/api/v1/connections/azure-devops/authorize", (context) => {
    if (context.get("authentication").actorType === "system") {
      throw new HttpError(403, "forbidden", "Runner authentication cannot install integrations.");
    }
    if (options.azureAuthorization === undefined) {
      throw new HttpError(409, "integration_unavailable", "Azure DevOps OAuth is not configured.");
    }
    return context.json(options.azureAuthorization.begin());
  });

  app.get("/api/v1/connections/azure-devops/callback", async (context) => {
    if (options.azureAuthorization === undefined) {
      throw new HttpError(409, "integration_unavailable", "Azure DevOps OAuth is not configured.");
    }
    const state = context.req.query("state");
    const code = context.req.query("code");
    if (state === undefined || code === undefined) {
      throw new HttpError(422, "validation_error", "Azure DevOps callback is incomplete.");
    }
    let authorizationId: string;
    try {
      authorizationId = await options.azureAuthorization.callback(state, code);
    } catch {
      throw new HttpError(
        403,
        "forbidden",
        "Azure DevOps authorization is invalid, expired or already used.",
      );
    }
    const location = new URL("/automation", options.publicUrl);
    location.searchParams.set("azureAuthorizationId", authorizationId);
    return context.redirect(location.toString(), 303);
  });

  app.get(
    "/api/v1/connections/azure-devops/authorizations/:authorizationId/organizations",
    (context) => {
      if (options.azureAuthorization === undefined) {
        throw new HttpError(
          409,
          "integration_unavailable",
          "Azure DevOps OAuth is not configured.",
        );
      }
      const authorizationId = parse(
        azureAuthorizationIdSchema,
        context.req.param("authorizationId"),
      );
      try {
        return context.json(options.azureAuthorization.organizations(authorizationId));
      } catch {
        throw new HttpError(
          409,
          "authorization_unavailable",
          "Azure DevOps authorization is invalid, expired or already used.",
        );
      }
    },
  );

  app.post(
    "/api/v1/connections/azure-devops/authorizations/:authorizationId/complete",
    async (context) => {
      if (options.azureAuthorization === undefined) {
        throw new HttpError(
          409,
          "integration_unavailable",
          "Azure DevOps OAuth is not configured.",
        );
      }
      const authorizationId = parse(
        azureAuthorizationIdSchema,
        context.req.param("authorizationId"),
      );
      const input = parse(completeAzureAuthorizationSchema, await parseJson(context.req.raw));
      try {
        return context.json(
          options.azureAuthorization.complete(authorizationId, input.organizationId),
          201,
        );
      } catch {
        throw new HttpError(
          409,
          "authorization_unavailable",
          "Azure DevOps authorization is invalid, expired or the organization is unavailable.",
        );
      }
    },
  );

  app.get("/api/v1/connections/:connectionId/reauthorize", async (context) => {
    const id = parse(connectionIdSchema, context.req.param("connectionId")) as ConnectionId;
    const connection = await options.connections.get(id);
    if (connection.provider === "github") {
      if (options.github === undefined) {
        throw new HttpError(409, "integration_unavailable", "GitHub App is not configured.");
      }
      const state = createOauthState(options.sessionSecret, "/automation");
      return context.json({ url: options.github.installationUrl(state) });
    }
    if (options.azureAuthorization === undefined) {
      throw new HttpError(409, "integration_unavailable", "Azure DevOps OAuth is not configured.");
    }
    return context.json(options.azureAuthorization.begin(id));
  });

  app.get("/api/v1/connections/:connectionId/repositories", async (context) => {
    const id = parse(connectionIdSchema, context.req.param("connectionId")) as ConnectionId;
    const connection = await options.connections.get(id);
    if (connection.status !== "active") {
      throw new HttpError(409, "integration_unavailable", "Connection is not active.");
    }
    return context.json(await managedProvider(connection).listRepositories(connection));
  });

  app.post("/api/v1/connections/:connectionId/import", async (context) => {
    const id = parse(connectionIdSchema, context.req.param("connectionId")) as ConnectionId;
    const input = parse(importRepositorySchema, await parseJson(context.req.raw));
    const connection = await options.connections.get(id);
    if (connection.status !== "active") {
      throw new HttpError(409, "integration_unavailable", "Connection is not active.");
    }
    const repository = await managedProvider(connection).getRepository(
      connection,
      input.repositoryId,
    );
    const project = await options.projects.createManaged({
      name: input.name ?? repository.name,
      description: input.description,
      repositoryPath: join(options.repositoriesDir, "projects", connection.id, repository.id),
      accountScope: input.accountScope,
      connectionId: connection.id,
      remoteRepositoryId: repository.id,
      remoteFullName: repository.fullName,
      remoteWebUrl: repository.webUrl,
      defaultBranch: repository.defaultBranch,
    });
    return context.json(project, 201);
  });

  app.post("/api/v1/connections/:connectionId/revoke", async (context) => {
    const id = parse(connectionIdSchema, context.req.param("connectionId")) as ConnectionId;
    return context.json(await options.connections.revoke(id));
  });

  app.get("/api/v1/agent-profiles", async (context) =>
    context.json(await options.agentProfiles.list()),
  );
  app.post("/api/v1/agent-profiles/model-catalog", async (context) => {
    const input = parse(modelCatalogRequestSchema, await parseJson(context.req.raw));
    return context.json(await loadModelCatalog(options.modelCatalog, input));
  });
  app.post("/api/v1/agent-profiles", async (context) => {
    const input = parse(createAgentProfileSchema, await parseJson(context.req.raw));
    const catalog = await loadModelCatalog(options.modelCatalog, input);
    return context.json(
      await options.agentProfiles.create({
        name: input.name,
        authMode: input.authMode,
        credentialReference: input.credentialReference,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        catalog,
      }),
      201,
    );
  });
  app.patch("/api/v1/agent-profiles/:agentProfileId/enabled", async (context) => {
    const id = parse(agentProfileIdSchema, context.req.param("agentProfileId")) as AgentProfileId;
    const input = parse(setAgentProfileEnabledSchema, await parseJson(context.req.raw));
    return context.json(await options.agentProfiles.setEnabled(id, input.enabled));
  });

  app.get("/api/v1/tasks/:taskId/runs", async (context) => {
    const taskId = parse(taskIdSchema, context.req.param("taskId")) as TaskId;
    const kind = context.req.query("kind");
    if (kind !== undefined && kind !== "curation" && kind !== "implementation") {
      throw new HttpError(422, "validation_error", "Run kind is invalid.");
    }
    return context.json(await options.runs.listForTask(taskId, kind));
  });
  app.get("/api/v1/runs/:runId", async (context) => {
    const runId = parse(runIdSchema, context.req.param("runId")) as RunId;
    return context.json(await options.runs.get(runId));
  });
  app.put("/api/v1/runs/:runId/logs", async (context) => {
    requireSystem(context.get("authentication"));
    const runId = parse(runIdSchema, context.req.param("runId")) as RunId;
    await options.runs.get(runId);
    if (options.runLogsDirectory === undefined) {
      throw new HttpError(503, "service_unavailable", "Run log storage is unavailable.");
    }
    const logs = await context.req.text();
    if (Buffer.byteLength(logs) > 5_000_000) {
      throw new HttpError(413, "payload_too_large", "Run logs exceed the 5 MB limit.");
    }
    await mkdir(options.runLogsDirectory, { recursive: true, mode: 0o700 });
    const destination = join(options.runLogsDirectory, `${runId}.jsonl`);
    const temporary = join(options.runLogsDirectory, `.${runId}.${crypto.randomUUID()}.tmp`);
    try {
      await Bun.write(temporary, logs, { mode: 0o600 });
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
    return context.body(null, 204);
  });
  app.get("/api/v1/runs/:runId/logs", async (context) => {
    const runId = parse(runIdSchema, context.req.param("runId")) as RunId;
    await options.runs.get(runId);
    if (options.runLogsDirectory === undefined) {
      throw new HttpError(404, "not_found", "Run logs were not found.");
    }
    const file = Bun.file(join(options.runLogsDirectory, `${runId}.jsonl`));
    if (!(await file.exists())) throw new HttpError(404, "not_found", "Run logs were not found.");
    return new Response(file, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  });
  app.post("/api/v1/runs/claim", async (context) => {
    requireSystem(context.get("authentication"));
    const assignment = await options.runs.claimNext();
    return assignment === null
      ? context.body(null, 204)
      : context.json({
          ...assignment,
          task: {
            ...assignment.task,
            attachments: assignment.task.attachments.map(attachmentResponse),
          },
        });
  });
  app.post("/api/v1/runs/reconcile", async (context) => {
    requireSystem(context.get("authentication"));
    const input = parse(reconcileRunsSchema, await parseJson(context.req.raw));
    return context.json(await options.runs.reconcileStale(input.before));
  });
  app.post("/api/v1/runs/:runId/advance", async (context) => {
    requireSystem(context.get("authentication"));
    const runId = parse(runIdSchema, context.req.param("runId")) as RunId;
    const input = parse(advanceRunSchema, await parseJson(context.req.raw));
    return context.json(
      await options.runs.advance(runId, input.status, {
        ...(input.baseSha === undefined ? {} : { baseSha: input.baseSha }),
        ...(input.headSha === undefined ? {} : { headSha: input.headSha }),
        ...(input.logsStorageKey === undefined ? {} : { logsStorageKey: input.logsStorageKey }),
        ...(input.summary === undefined ? {} : { summary: input.summary }),
      }),
    );
  });
  app.post("/api/v1/runs/:runId/heartbeat", async (context) => {
    requireSystem(context.get("authentication"));
    const runId = parse(runIdSchema, context.req.param("runId")) as RunId;
    return context.json(await options.runs.heartbeat(runId));
  });
  app.get("/api/v1/runs/:runId/verification", async (context) => {
    const runId = parse(runIdSchema, context.req.param("runId")) as RunId;
    return context.json({ items: await options.runs.verificationResults(runId) });
  });
  app.post("/api/v1/runs/:runId/verification-results", async (context) => {
    requireSystem(context.get("authentication"));
    const runId = parse(runIdSchema, context.req.param("runId")) as RunId;
    const input = parse(recordVerificationResultsSchema, await parseJson(context.req.raw));
    return context.json(await options.runs.recordVerification(runId, input.results));
  });
  app.get("/api/v1/runs/:runId/provenance", async (context) => {
    const runId = parse(runIdSchema, context.req.param("runId")) as RunId;
    const provenance = await options.runs.provenance(runId);
    if (provenance === null) throw new HttpError(404, "not_found", "Run provenance was not found.");
    return context.json(provenance);
  });
  app.put("/api/v1/runs/:runId/provenance", async (context) => {
    requireSystem(context.get("authentication"));
    const runId = parse(runIdSchema, context.req.param("runId")) as RunId;
    const input = parse(recordRunProvenanceSchema, await parseJson(context.req.raw));
    return context.json(await options.runs.recordProvenance(runId, input), 201);
  });
  app.post("/api/v1/runs/:runId/complete", async (context) => {
    requireSystem(context.get("authentication"));
    const runId = parse(runIdSchema, context.req.param("runId")) as RunId;
    return context.json(
      await options.runs.complete(
        runId,
        parse(completeRunSchema, await parseJson(context.req.raw)),
      ),
    );
  });
  app.post("/api/v1/runs/:runId/curation-result", async (context) => {
    requireSystem(context.get("authentication"));
    const runId = parse(runIdSchema, context.req.param("runId")) as RunId;
    const input = parse(completeCurationRunSchema, await parseJson(context.req.raw));
    return context.json(
      await options.runs.completeCuration(
        runId,
        input.outcome === "ready"
          ? {
              outcome: "ready",
              curatorSpec: input.curatorSpec,
              summary: input.summary,
              ...(input.title === undefined ? {} : { title: input.title }),
            }
          : {
              outcome: "blocked",
              questions: input.questions,
              summary: input.summary,
              ...(input.title === undefined ? {} : { title: input.title }),
              ...(input.curatorSpec === undefined ? {} : { curatorSpec: input.curatorSpec }),
            },
      ),
    );
  });
  app.post("/api/v1/runs/:runId/git-credentials", async (context) => {
    requireSystem(context.get("authentication"));
    const runId = parse(runIdSchema, context.req.param("runId")) as RunId;
    const run = await options.runs.get(runId);
    const project = await options.projects.get(run.projectId);
    if (
      project.repositoryMode !== "managed" ||
      project.connectionId === null ||
      project.remoteRepositoryId === null
    ) {
      throw new HttpError(409, "invalid_repository_mode", "Run does not use a managed repository.");
    }
    const connection = await options.connections.get(project.connectionId);
    if (connection.status !== "active") {
      throw new HttpError(409, "integration_unavailable", "Connection is not active.");
    }
    return context.json(
      await managedProvider(connection).gitCredentials(connection, project.remoteRepositoryId),
    );
  });
  app.post("/api/v1/runs/:runId/pull-request", async (context) => {
    requireSystem(context.get("authentication"));
    const runId = parse(runIdSchema, context.req.param("runId")) as RunId;
    const input = parse(createPullRequestSchema, await parseJson(context.req.raw));
    const run = await options.runs.get(runId);
    const project = await options.projects.get(run.projectId);
    if (
      project.connectionId === null ||
      project.remoteFullName === null ||
      project.remoteRepositoryId === null
    )
      throw new HttpError(409, "invalid_repository_mode", "Run does not use a managed repository.");
    const connection = await options.connections.get(project.connectionId);
    if (connection.status !== "active") {
      throw new HttpError(409, "integration_unavailable", "Connection is not active.");
    }
    const task = await options.tasks.get(run.taskId);
    if (
      task.currentDelivery?.baseBranch === null ||
      task.currentDelivery?.baseBranch !== input.base
    ) {
      throw new HttpError(
        409,
        "delivery_base_branch_mismatch",
        "Pull Request base does not match the Delivery Base Branch.",
      );
    }
    return context.json({
      prUrl: await managedProvider(connection).publishPullRequest(
        connection,
        project.remoteFullName,
        project.remoteRepositoryId,
        input,
        task.currentDelivery?.prUrl ?? null,
      ),
    });
  });
  app.post("/api/v1/runs/:runId/fail", async (context) => {
    requireSystem(context.get("authentication"));
    const runId = parse(runIdSchema, context.req.param("runId")) as RunId;
    const input = parse(failRunSchema, await parseJson(context.req.raw));
    return context.json(
      await options.runs.fail(runId, {
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        ...(input.summary === undefined ? {} : { summary: input.summary }),
      }),
    );
  });
  app.post("/api/v1/runs/:runId/retry", async (context) => {
    const runId = parse(runIdSchema, context.req.param("runId")) as RunId;
    const input = parse(retryRunSchema, await parseOptionalJson(context.req.raw));
    return context.json(
      await options.runs.retry(runId, parseIfMatch(context.req.header("If-Match")), input.mode),
      201,
    );
  });
  app.post("/api/v1/runs/:runId/waive-verification", async (context) => {
    const runId = parse(runIdSchema, context.req.param("runId")) as RunId;
    const input = parse(waiveVerificationSchema, await parseJson(context.req.raw));
    return context.json(
      await options.runs.waiveVerification(
        runId,
        parseIfMatch(context.req.header("If-Match")),
        input.reason,
      ),
      201,
    );
  });
  app.post("/api/v1/runs/:runId/cancel", async (context) => {
    const runId = parse(runIdSchema, context.req.param("runId")) as RunId;
    const input = parse(cancelRunSchema, await parseJson(context.req.raw));
    return context.json(
      await options.runs.cancel(runId, input.reason, parseIfMatch(context.req.header("If-Match"))),
    );
  });

  app.get("/api/v1/tasks", async (context) => {
    const queryValues: Record<string, unknown> = { ...context.req.query() };
    const statuses = context.req.queries("status");
    if (statuses !== undefined && statuses.length > 0) queryValues.status = statuses;
    const input = parse(listTasksSchema, queryValues);
    const query: TaskListQuery = {
      archived: input.archived,
      sort: input.sort,
      order: input.order,
      limit: input.limit,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId as ProjectId }),
      ...(input.status === undefined ? {} : { statuses: input.status }),
      ...(input.accountScope === undefined ? {} : { accountScope: input.accountScope }),
      ...(input.gitProvider === undefined ? {} : { gitProvider: input.gitProvider }),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    };
    return context.json(await options.tasks.list(query));
  });

  app.post("/api/v1/tasks", async (context) => {
    const input = parse(createTaskSchema, await parseJson(context.req.raw));
    const project = await options.projects.get(input.projectId as ProjectId);
    const baseBranch =
      project.repositoryMode === "managed" ? (input.baseBranch ?? project.defaultBranch) : null;
    if (baseBranch !== null) await assertRemoteBranch(project, baseBranch, "baseBranch");
    const aggregate = await options.tasks.create({
      projectId: input.projectId as ProjectId,
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.userRequest === undefined ? {} : { userRequest: input.userRequest }),
      userRequest: input.userRequest,
      ...(input.baseBranch === undefined ? {} : { baseBranch: input.baseBranch }),
      actorType: context.get("authentication").actorType,
    });
    context.header("ETag", taskEtag(aggregate.version));
    return context.json(taskResponse(aggregate), 201);
  });

  app.get("/api/v1/tasks/:taskId", async (context) => {
    const taskId = parse(taskIdSchema, context.req.param("taskId")) as TaskId;
    const aggregate = await options.tasks.get(taskId);
    context.header("ETag", taskEtag(aggregate.version));
    return context.json(taskResponse(aggregate));
  });

  app.post("/api/v1/tasks/:taskId/messages", async (context) => {
    const taskId = parse(taskIdSchema, context.req.param("taskId")) as TaskId;
    const expectedVersion = parseIfMatch(context.req.header("If-Match"));
    let form: FormData;
    try {
      form = await context.req.raw.formData();
    } catch {
      throw new HttpError(400, "bad_request", "Malformed multipart request body.");
    }
    const textValue = form.get("text");
    const text = parse(messageTextSchema, typeof textValue === "string" ? textValue : null);
    const files = form.getAll("file").filter((value): value is File => value instanceof File);
    const result = await options.messages.create({
      taskId,
      expectedVersion,
      ...(text === undefined ? {} : { text }),
      actorType: context.get("authentication").actorType,
      attachments: files.map((file) => ({
        originalName: file.name,
        declaredMimeType: file.type || "application/octet-stream",
        content: file.stream(),
      })),
    });
    context.header("ETag", taskEtag(result.taskVersion));
    return context.json(result, 201);
  });

  app.get("/api/v1/tasks/:taskId/timeline", async (context) => {
    const taskId = parse(taskIdSchema, context.req.param("taskId")) as TaskId;
    const input = parse(listTimelineSchema, context.req.query());
    return context.json(await options.messages.timeline(taskId, input.limit, input.cursor));
  });

  app.patch("/api/v1/tasks/:taskId", async (context) => {
    const taskId = parse(taskIdSchema, context.req.param("taskId")) as TaskId;
    const expectedVersion = parseIfMatch(context.req.header("If-Match"));
    const input = parse(updateTaskSchema, await parseJson(context.req.raw));
    const changes: TaskChanges = {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.userRequest === undefined ? {} : { userRequest: input.userRequest }),
      ...(input.curatorSpec === undefined ? {} : { curatorSpec: input.curatorSpec }),
      ...(input.prUrl === undefined ? {} : { prUrl: input.prUrl }),
    };
    const aggregate = await options.tasks.update({
      taskId,
      expectedVersion,
      changes,
      actorType: context.get("authentication").actorType,
    });
    context.header("ETag", taskEtag(aggregate.version));
    return context.json(taskResponse(aggregate));
  });

  app.post("/api/v1/tasks/:taskId/transition", async (context) => {
    const taskId = parse(taskIdSchema, context.req.param("taskId")) as TaskId;
    const expectedVersion = parseIfMatch(context.req.header("If-Match"));
    const input = parse(transitionTaskSchema, await parseJson(context.req.raw));
    const aggregate = await options.tasks.transition({
      taskId,
      expectedVersion,
      from: input.from,
      to: input.to,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      actorType: context.get("authentication").actorType,
    });
    context.header("ETag", taskEtag(aggregate.version));
    return context.json(taskResponse(aggregate));
  });

  app.post("/api/v1/tasks/:taskId/automation/resume", async (context) => {
    const taskId = parse(taskIdSchema, context.req.param("taskId")) as TaskId;
    const aggregate = await options.tasks.resumeAutomation({
      taskId,
      expectedVersion: parseIfMatch(context.req.header("If-Match")),
      actorType: context.get("authentication").actorType,
    });
    context.header("ETag", taskEtag(aggregate.version));
    return context.json(taskResponse(aggregate));
  });

  app.post("/api/v1/tasks/:taskId/archive", async (context) => {
    const taskId = parse(taskIdSchema, context.req.param("taskId")) as TaskId;
    const expectedVersion = parseIfMatch(context.req.header("If-Match"));
    const input = parse(reasonSchema, await parseOptionalJson(context.req.raw));
    const aggregate = await options.tasks.archive({
      taskId,
      expectedVersion,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      actorType: context.get("authentication").actorType,
    });
    context.header("ETag", taskEtag(aggregate.version));
    return context.json(taskResponse(aggregate));
  });

  app.post("/api/v1/tasks/:taskId/unarchive", async (context) => {
    const taskId = parse(taskIdSchema, context.req.param("taskId")) as TaskId;
    const expectedVersion = parseIfMatch(context.req.header("If-Match"));
    const aggregate = await options.tasks.unarchive({
      taskId,
      expectedVersion,
      actorType: context.get("authentication").actorType,
    });
    context.header("ETag", taskEtag(aggregate.version));
    return context.json(taskResponse(aggregate));
  });

  app.get("/api/v1/tasks/:taskId/questions", async (context) => {
    const taskId = parse(taskIdSchema, context.req.param("taskId")) as TaskId;
    return context.json(await options.questions.list(taskId));
  });

  app.post("/api/v1/tasks/:taskId/questions", async (context) => {
    const taskId = parse(taskIdSchema, context.req.param("taskId")) as TaskId;
    const expectedVersion = parseIfMatch(context.req.header("If-Match"));
    const input = parse(questionDefinitionSchema, await parseJson(context.req.raw));
    const aggregate = await options.questions.create({
      taskId,
      expectedVersion,
      ...input,
      actorType: context.get("authentication").actorType,
    });
    context.header("ETag", taskEtag(aggregate.version));
    return context.json(taskResponse(aggregate), 201);
  });

  app.get("/api/v1/tasks/:taskId/questions/:questionId", async (context) => {
    const taskId = parse(taskIdSchema, context.req.param("taskId")) as TaskId;
    const questionId = parse(questionIdSchema, context.req.param("questionId")) as QuestionId;
    return context.json(await options.questions.get(taskId, questionId));
  });

  app.patch("/api/v1/tasks/:taskId/questions/:questionId", async (context) => {
    const taskId = parse(taskIdSchema, context.req.param("taskId")) as TaskId;
    const questionId = parse(questionIdSchema, context.req.param("questionId")) as QuestionId;
    const expectedVersion = parseIfMatch(context.req.header("If-Match"));
    const definition = parse(questionDefinitionSchema, await parseJson(context.req.raw));
    const aggregate = await options.questions.update({
      taskId,
      questionId,
      expectedVersion,
      definition,
      actorType: context.get("authentication").actorType,
    });
    context.header("ETag", taskEtag(aggregate.version));
    return context.json(taskResponse(aggregate));
  });

  app.post("/api/v1/tasks/:taskId/questions/:questionId/answer", async (context) => {
    const taskId = parse(taskIdSchema, context.req.param("taskId")) as TaskId;
    const questionId = parse(questionIdSchema, context.req.param("questionId")) as QuestionId;
    const expectedVersion = parseIfMatch(context.req.header("If-Match"));
    const input = parse(answerQuestionSchema, await parseJson(context.req.raw));
    const aggregate = await options.questions.answer({
      taskId,
      questionId,
      expectedVersion,
      selectedOptionIds: input.selectedOptionIds as QuestionOptionId[],
      answerText: input.answerText,
      actorType: context.get("authentication").actorType,
    });
    context.header("ETag", taskEtag(aggregate.version));
    return context.json(taskResponse(aggregate));
  });

  app.post("/api/v1/tasks/:taskId/questions/:questionId/dismiss", async (context) => {
    const taskId = parse(taskIdSchema, context.req.param("taskId")) as TaskId;
    const questionId = parse(questionIdSchema, context.req.param("questionId")) as QuestionId;
    const expectedVersion = parseIfMatch(context.req.header("If-Match"));
    const input = parse(reasonSchema, await parseOptionalJson(context.req.raw));
    const aggregate = await options.questions.dismiss({
      taskId,
      questionId,
      expectedVersion,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      actorType: context.get("authentication").actorType,
    });
    context.header("ETag", taskEtag(aggregate.version));
    return context.json(taskResponse(aggregate));
  });

  app.post("/api/v1/tasks/:taskId/questions/:questionId/reopen", async (context) => {
    const taskId = parse(taskIdSchema, context.req.param("taskId")) as TaskId;
    const questionId = parse(questionIdSchema, context.req.param("questionId")) as QuestionId;
    const expectedVersion = parseIfMatch(context.req.header("If-Match"));
    const input = parse(reasonSchema, await parseOptionalJson(context.req.raw));
    const aggregate = await options.questions.reopen({
      taskId,
      questionId,
      expectedVersion,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      actorType: context.get("authentication").actorType,
    });
    context.header("ETag", taskEtag(aggregate.version));
    return context.json(taskResponse(aggregate));
  });

  app.get("/api/v1/tasks/:taskId/attachments", async (context) => {
    const taskId = parse(taskIdSchema, context.req.param("taskId")) as TaskId;
    const attachments = await options.attachments.list(taskId);
    return context.json(attachments.map((attachment) => attachmentResponse(attachment)));
  });

  app.post("/api/v1/tasks/:taskId/attachments", async (context) => {
    const taskId = parse(taskIdSchema, context.req.param("taskId")) as TaskId;
    const expectedVersion = parseIfMatch(context.req.header("If-Match"));
    const file = await parseSingleFileMultipart(context.req.raw);
    const result = await options.attachments.add({
      taskId,
      expectedVersion,
      originalName: file.fileName,
      declaredMimeType: file.declaredMimeType,
      content: file.content,
      actorType: context.get("authentication").actorType,
    });
    context.header("ETag", taskEtag(result.taskVersion));
    return context.json(
      {
        attachment: attachmentResponse(result.attachment),
        taskVersion: result.taskVersion,
      },
      201,
    );
  });

  app.get("/api/v1/tasks/:taskId/attachments/:attachmentId", async (context) => {
    const taskId = parse(taskIdSchema, context.req.param("taskId")) as TaskId;
    const attachmentId = parse(
      attachmentIdSchema,
      context.req.param("attachmentId"),
    ) as AttachmentId;
    return context.json(attachmentResponse(await options.attachments.get(taskId, attachmentId)));
  });

  app.get("/api/v1/tasks/:taskId/attachments/:attachmentId/content", async (context) => {
    const taskId = parse(taskIdSchema, context.req.param("taskId")) as TaskId;
    const attachmentId = parse(
      attachmentIdSchema,
      context.req.param("attachmentId"),
    ) as AttachmentId;
    const opened = await options.attachments.openContent(taskId, attachmentId);
    return context.body(opened.content, 200, {
      "Content-Type": opened.attachment.mimeType,
      "Content-Length": String(opened.attachment.sizeBytes),
      "Content-Disposition": contentDisposition(opened.attachment.originalName),
      "X-Content-Type-Options": "nosniff",
      ETag: `"${opened.attachment.sha256}"`,
    });
  });

  app.delete("/api/v1/tasks/:taskId/attachments/:attachmentId", async (context) => {
    const taskId = parse(taskIdSchema, context.req.param("taskId")) as TaskId;
    const attachmentId = parse(
      attachmentIdSchema,
      context.req.param("attachmentId"),
    ) as AttachmentId;
    const expectedVersion = parseIfMatch(context.req.header("If-Match"));
    const result = await options.attachments.remove({
      taskId,
      attachmentId,
      expectedVersion,
      actorType: context.get("authentication").actorType,
    });
    context.header("ETag", taskEtag(result.taskVersion));
    return context.json(result);
  });

  app.get("/api/v1/tasks/:taskId/activity", async (context) => {
    const taskId = parse(taskIdSchema, context.req.param("taskId")) as TaskId;
    const input = parse(listActivitySchema, context.req.query());
    return context.json(
      await options.tasks.activity({
        taskId,
        limit: input.limit,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      }),
    );
  });

  if (options.webAssetsDirectory !== undefined) {
    app.get("/aiws-logo.png", async (context) => {
      const fileName = "aiws-logo.png";
      const asset = Bun.file(`${options.webAssetsDirectory}/${fileName}`);
      if (!(await asset.exists())) return context.notFound();
      return new Response(asset, {
        headers: {
          "Content-Type": assetType(fileName),
          "Cache-Control": "public, max-age=3600",
          "X-Content-Type-Options": "nosniff",
        },
      });
    });
    app.get("/assets/:file", async (context) => {
      const fileName = context.req.param("file");
      if (!/^[A-Za-z0-9._-]+$/u.test(fileName)) return context.notFound();
      const asset = Bun.file(`${options.webAssetsDirectory}/assets/${fileName}`);
      if (!(await asset.exists())) return context.notFound();
      return new Response(asset, {
        headers: {
          "Content-Type": assetType(fileName),
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
        },
      });
    });
    app.get("*", async (context) => {
      const path = new URL(context.req.url).pathname;
      if (path.startsWith("/api/")) return context.notFound();
      const index = Bun.file(`${options.webAssetsDirectory}/index.html`);
      if (!(await index.exists())) return context.notFound();
      return new Response(index, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
          "Content-Security-Policy": securityPolicy,
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
          "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        },
      });
    });
  }

  return app;
}

const securityPolicy =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

function assetType(fileName: string): string {
  if (fileName.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (fileName.endsWith(".css")) return "text/css; charset=utf-8";
  if (fileName.endsWith(".map")) return "application/json; charset=utf-8";
  if (fileName.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(
      422,
      "validation_error",
      "Input validation failed.",
      validationDetails(result.error),
    );
  }
  return result.data;
}

async function parseJson(request: Request): Promise<unknown> {
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    throw new HttpError(400, "bad_request", "A JSON request body is required.");
  }
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "bad_request", "Malformed JSON request body.");
  }
}

async function parseOptionalJson(request: Request): Promise<unknown> {
  if (request.body === null || request.headers.get("Content-Length") === "0") return {};
  const contentType = request.headers.get("Content-Type");
  if (contentType === null && request.headers.get("Content-Length") === null) return {};
  return parseJson(request);
}

function parseIfMatch(value: string | undefined): number {
  if (value === undefined) {
    throw new HttpError(428, "expected_version_required", "If-Match is required.");
  }
  if (!/^"?[1-9][0-9]*"?$/.test(value) || value.startsWith('"') !== value.endsWith('"')) {
    throw new HttpError(422, "validation_error", "Input validation failed.", {
      fields: [{ path: "If-Match", message: "Must be a positive integer, optionally quoted." }],
    });
  }
  const parsed = Number(value.replaceAll('"', ""));
  if (!Number.isSafeInteger(parsed)) {
    throw new HttpError(422, "validation_error", "Input validation failed.", {
      fields: [{ path: "If-Match", message: "Must be a safe positive integer." }],
    });
  }
  return parsed;
}

function taskEtag(version: number): string {
  return `"${version}"`;
}

function taskResponse(aggregate: TaskAggregate) {
  return {
    id: aggregate.id,
    version: aggregate.version,
    title: aggregate.title,
    userRequest: aggregate.userRequest,
    curatorSpec: aggregate.curatorSpec,
    status: aggregate.status,
    prUrl: aggregate.prUrl,
    project: aggregate.project,
    questions: aggregate.questions,
    attachments: aggregate.attachments.map((attachment) => attachmentResponse(attachment)),
    createdAt: aggregate.createdAt,
    updatedAt: aggregate.updatedAt,
    archivedAt: aggregate.archivedAt,
    automationPaused: aggregate.automationPaused,
    readyApprovalPending: aggregate.readyApprovalPending,
    specRevisions: aggregate.specRevisions,
    currentCycle: aggregate.currentCycle,
    currentDelivery: aggregate.currentDelivery,
  };
}

function attachmentResponse(attachment: {
  readonly id: AttachmentId;
  readonly taskId: TaskId;
  readonly cycleId: string;
  readonly messageId: string | null;
  readonly originalName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly createdAt: string;
}) {
  return {
    id: attachment.id,
    taskId: attachment.taskId,
    cycleId: attachment.cycleId,
    messageId: attachment.messageId,
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    sha256: attachment.sha256,
    createdAt: attachment.createdAt,
    downloadUrl: `/api/v1/tasks/${attachment.taskId}/attachments/${attachment.id}/content`,
  };
}

function contentDisposition(fileName: string): string {
  const encoded = encodeURIComponent(fileName).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename*=UTF-8''${encoded}`;
}

function errorEnvelope(
  code: string,
  message: string,
  requestId: string,
  details?: Readonly<Record<string, unknown>>,
): { error: Record<string, unknown> } {
  return {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
      requestId,
    },
  };
}

function unauthorized(): HttpError {
  return new HttpError(401, "unauthorized", "Authentication is required.");
}

async function loadModelCatalog(
  client: AppOptions["modelCatalog"],
  input: { readonly authMode: AgentAuthMode; readonly credentialReference: string },
): Promise<AgentModelCatalog> {
  if (client === undefined) {
    throw new HttpError(503, "catalog_unavailable", "The Codex model catalog is unavailable.");
  }
  try {
    return await client.list(input.authMode, input.credentialReference);
  } catch {
    throw new HttpError(503, "catalog_unavailable", "The Codex model catalog is unavailable.");
  }
}

function requireWeb(authentication: Authentication): void {
  if (authentication.actorType !== "web") throw unauthorized();
}

function requireSystem(authentication: Authentication): void {
  if (authentication.actorType !== "system")
    throw new HttpError(403, "forbidden", "Runner authentication is required.");
}

function safeReturnTo(value: string | undefined): string {
  if (value === undefined || !value.startsWith("/") || value.startsWith("//")) return "/projects";
  return value;
}

function isMutation(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

function clientIp(request: Request, trustProxy: boolean): string {
  if (trustProxy) return request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() || "unknown";
  return request.headers.get("X-Real-IP") ?? "unknown";
}

function logFailure(
  logger: Logger,
  now: Date,
  requestId: string,
  request: Request,
  status: number,
  error: string,
): void {
  logger.log({
    level: status >= 500 ? "error" : "info",
    time: now.toISOString(),
    requestId,
    method: request.method,
    path: new URL(request.url).pathname,
    status,
    durationMs: 0,
    error,
  });
}
