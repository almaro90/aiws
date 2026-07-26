import type { ProjectId } from "../domain/ids.ts";
import {
  createVerificationContractRevision,
  type VerificationCommand,
  type VerificationContractRevision,
  type VerificationContractState,
  verificationContractState,
} from "../domain/verification.ts";
import {
  InvalidTransitionError,
  NotFoundError,
  RevisionConflictError,
} from "../errors/domain-errors.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { CoreDependencies } from "./context.ts";
import { timestamp } from "./context.ts";

export class VerificationContractUseCases {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly dependencies: CoreDependencies,
  ) {}

  async get(projectId: ProjectId): Promise<VerificationContractState> {
    return this.unitOfWork.execute(async (stores) => {
      if ((await stores.projects.getById(projectId)) === null) {
        throw new NotFoundError("Project", projectId);
      }
      return verificationContractState(
        projectId,
        await stores.verificationContracts.getLatest(projectId),
      );
    });
  }

  async history(projectId: ProjectId): Promise<readonly VerificationContractRevision[]> {
    return this.unitOfWork.execute(async (stores) => {
      if ((await stores.projects.getById(projectId)) === null) {
        throw new NotFoundError("Project", projectId);
      }
      return stores.verificationContracts.list(projectId);
    });
  }

  async replace(input: {
    readonly projectId: ProjectId;
    readonly expectedRevision: number | null;
    readonly commands: readonly VerificationCommand[];
  }): Promise<VerificationContractState> {
    return this.unitOfWork.execute(async (stores) => {
      const project = await stores.projects.getById(input.projectId);
      if (project === null) throw new NotFoundError("Project", input.projectId);
      if (project.archivedAt !== null) {
        throw new InvalidTransitionError("Archived Projects are read-only.");
      }
      const latest = await stores.verificationContracts.getLatest(input.projectId);
      this.assertRevision(input.expectedRevision, latest?.revision ?? null);
      const revision = createVerificationContractRevision({
        projectId: input.projectId,
        revision: (latest?.revision ?? 0) + 1,
        enabled: true,
        commands: input.commands,
        now: timestamp(this.dependencies.clock),
      });
      await stores.verificationContracts.insert(revision);
      return verificationContractState(input.projectId, revision);
    });
  }

  async disable(input: {
    readonly projectId: ProjectId;
    readonly expectedRevision: number;
  }): Promise<VerificationContractState> {
    return this.unitOfWork.execute(async (stores) => {
      const project = await stores.projects.getById(input.projectId);
      if (project === null) throw new NotFoundError("Project", input.projectId);
      if (project.archivedAt !== null) {
        throw new InvalidTransitionError("Archived Projects are read-only.");
      }
      const latest = await stores.verificationContracts.getLatest(input.projectId);
      this.assertRevision(input.expectedRevision, latest?.revision ?? null);
      if (latest === null || !latest.enabled) {
        throw new InvalidTransitionError("Project has no active Verification Contract.");
      }
      const revision = createVerificationContractRevision({
        projectId: input.projectId,
        revision: latest.revision + 1,
        enabled: false,
        commands: [],
        now: timestamp(this.dependencies.clock),
      });
      await stores.verificationContracts.insert(revision);
      return verificationContractState(input.projectId, revision);
    });
  }

  private assertRevision(expected: number | null, current: number | null): void {
    if (expected !== current) throw new RevisionConflictError(expected, current);
  }
}
