import {
  archiveProject,
  createProject,
  type Project,
  type ProjectChanges,
  unarchiveProject,
  updateProject,
  type AccountScope,
  type GitProvider,
} from "../domain/project.ts";
import type { ProjectId } from "../domain/ids.ts";
import type { AgentProfileId, ConnectionId } from "../domain/ids.ts";
import type { Page, ProjectListQuery } from "../ports/stores.ts";
import {
  NotFoundError,
  ProjectHasActiveTasksError,
  ValidationError,
} from "../errors/domain-errors.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import { timestamp, type CoreDependencies } from "./context.ts";

export interface CreateProjectInput {
  readonly name: string;
  readonly description?: string;
  readonly repositoryPath: string;
  readonly gitProvider: GitProvider;
  readonly accountScope: AccountScope;
}

export interface CreateManagedProjectInput {
  readonly name: string;
  readonly description?: string;
  readonly repositoryPath: string;
  readonly accountScope: AccountScope;
  readonly connectionId: ConnectionId;
  readonly remoteRepositoryId: string;
  readonly remoteFullName: string;
  readonly remoteWebUrl: string;
  readonly defaultBranch: string;
}

export class ProjectUseCases {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly dependencies: CoreDependencies,
  ) {}

  async list(query: ProjectListQuery): Promise<Page<Project>> {
    return this.unitOfWork.execute((stores) => stores.projects.list(query));
  }

  async create(input: CreateProjectInput): Promise<Project> {
    const now = timestamp(this.dependencies.clock);
    const project = createProject({
      ...input,
      id: this.dependencies.ids.projectId(),
      now,
    });
    return this.unitOfWork.execute(async (stores) => {
      if (await stores.projects.repositoryPathExists(project.repositoryPath)) {
        throw new ValidationError([
          { path: "repositoryPath", message: "Repository path is already registered." },
        ]);
      }
      await stores.projects.insert(project);
      return project;
    });
  }

  async createManaged(input: CreateManagedProjectInput): Promise<Project> {
    const now = timestamp(this.dependencies.clock);
    return this.unitOfWork.execute(async (stores) => {
      const connection = await stores.connections.getById(input.connectionId);
      if (connection === null || connection.status !== "active") {
        throw new ValidationError([
          { path: "connectionId", message: "Connection is unavailable." },
        ]);
      }
      const project = createProject({
        ...input,
        id: this.dependencies.ids.projectId(),
        repositoryMode: "managed",
        gitProvider: connection.provider,
        now,
      });
      if (await stores.projects.repositoryPathExists(project.repositoryPath)) {
        throw new ValidationError([
          { path: "repositoryPath", message: "Repository is already registered." },
        ]);
      }
      await stores.projects.insert(project);
      return project;
    });
  }

  async get(id: ProjectId): Promise<Project> {
    return this.unitOfWork.execute(async (stores) => {
      const project = await stores.projects.getById(id);
      if (project === null) throw new NotFoundError("Project", id);
      return project;
    });
  }

  async update(id: ProjectId, changes: ProjectChanges): Promise<Project> {
    return this.unitOfWork.execute(async (stores) => {
      const current = await stores.projects.getById(id);
      if (current === null) throw new NotFoundError("Project", id);
      const project = updateProject(current, changes, timestamp(this.dependencies.clock));
      const profileFields = new Set<"curationAgentProfileId" | "implementationAgentProfileId">();
      if (changes.curationAgentProfileId !== undefined) profileFields.add("curationAgentProfileId");
      if (changes.implementationAgentProfileId !== undefined || project.automationEnabled)
        profileFields.add("implementationAgentProfileId");
      for (const field of profileFields) {
        const profileId = project[field];
        if (profileId === null) continue;
        const profile = await stores.agentProfiles.getById(profileId as AgentProfileId);
        if (profile === null || !profile.enabled)
          throw new ValidationError([{ path: field, message: "Agent Profile is unavailable." }]);
      }
      if (
        changes.repositoryPath !== undefined &&
        (await stores.projects.repositoryPathExists(changes.repositoryPath, id))
      ) {
        throw new ValidationError([
          { path: "repositoryPath", message: "Repository path is already registered." },
        ]);
      }
      await stores.projects.update(project);
      return project;
    });
  }

  async archive(id: ProjectId): Promise<Project> {
    return this.unitOfWork.execute(async (stores) => {
      const current = await stores.projects.getById(id);
      if (current === null) throw new NotFoundError("Project", id);
      if (current.archivedAt !== null) return current;
      if ((await stores.projects.countActiveTasks(id)) > 0) {
        throw new ProjectHasActiveTasksError(id);
      }
      const project = archiveProject(current, timestamp(this.dependencies.clock));
      await stores.projects.update(project);
      return project;
    });
  }

  async unarchive(id: ProjectId): Promise<Project> {
    return this.unitOfWork.execute(async (stores) => {
      const current = await stores.projects.getById(id);
      if (current === null) throw new NotFoundError("Project", id);
      if (current.archivedAt === null) return current;
      const project = unarchiveProject(current, timestamp(this.dependencies.clock));
      await stores.projects.update(project);
      return project;
    });
  }
}
