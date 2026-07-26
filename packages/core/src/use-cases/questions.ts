import type { ActorType, TaskEvent, TaskEventFact } from "../domain/task-event.ts";
import type { QuestionId, QuestionOptionId, TaskId } from "../domain/ids.ts";
import {
  answerQuestion,
  createQuestion,
  dismissQuestion,
  type Question,
  type QuestionAnswer,
  type QuestionDefinition,
  type QuestionType,
  reopenQuestion,
  updateQuestion,
} from "../domain/question.ts";
import { assertTaskActive, mutateTaskForQuestion, type Task } from "../domain/task.ts";
import {
  InvalidTransitionError,
  NotFoundError,
  VersionConflictError,
} from "../errors/domain-errors.ts";
import type { Stores, TaskAggregate } from "../ports/stores.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import {
  assertExpectedVersion,
  type CoreDependencies,
  eventFor,
  timestamp,
  validateReason,
} from "./context.ts";

export interface QuestionDefinitionInput {
  readonly text: string;
  readonly type: QuestionType;
  readonly options: readonly { readonly label: string }[];
  readonly allowOther: boolean;
}

interface QuestionMutationInput {
  readonly taskId: TaskId;
  readonly questionId: QuestionId;
  readonly expectedVersion: number;
  readonly actorType: ActorType;
}

export interface CreateQuestionInput extends QuestionDefinitionInput {
  readonly taskId: TaskId;
  readonly expectedVersion: number;
  readonly actorType: ActorType;
}

export interface UpdateQuestionInput extends QuestionMutationInput {
  readonly definition: QuestionDefinitionInput;
}

export interface AnswerQuestionInput extends QuestionMutationInput {
  readonly selectedOptionIds: readonly QuestionOptionId[];
  readonly answerText: string | null;
}

export interface DismissQuestionInput extends QuestionMutationInput {
  readonly reason?: string | null;
}

export interface ReopenQuestionInput extends QuestionMutationInput {
  readonly reason?: string | null;
}

export class QuestionUseCases {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly dependencies: CoreDependencies,
  ) {}

  async list(taskId: TaskId): Promise<readonly Question[]> {
    return this.unitOfWork.execute(async (stores) => {
      await this.loadTask(stores, taskId);
      return stores.questions.listByTaskId(taskId);
    });
  }

  async get(taskId: TaskId, questionId: QuestionId): Promise<Question> {
    return this.unitOfWork.execute(async (stores) => {
      await this.loadTask(stores, taskId);
      return this.loadQuestion(stores, taskId, questionId);
    });
  }

  async create(input: CreateQuestionInput): Promise<TaskAggregate> {
    return this.unitOfWork.execute(async (stores) => {
      const current = await this.loadMutableTask(stores, input.taskId, input.expectedVersion);
      if (current.status === "draft" || current.status === "done") {
        throw new InvalidTransitionError(
          "Questions require a Task under curation or implementation.",
          {
            taskId: current.id,
          },
        );
      }
      const now = timestamp(this.dependencies.clock);
      const question = createQuestion({
        id: this.dependencies.ids.questionId(),
        taskId: input.taskId,
        cycleId: current.currentCycleId,
        ...this.definition(input),
        now,
      });
      const task = mutateTaskForQuestion(current, now, "blocked", true);
      const facts: TaskEventFact[] = [this.definitionFact("question_created", question)];
      if (current.status !== "blocked") {
        facts.push({
          type: "status_changed",
          from: current.status,
          to: "blocked",
          automatic: true,
        });
      }
      const events = await this.eventsFor(task, input.actorType, facts, now);
      await this.persistTask(stores, task, input.expectedVersion);
      await stores.questions.insert(question);
      await stores.events.append(events);
      return this.aggregate(stores, task);
    });
  }

  async update(input: UpdateQuestionInput): Promise<TaskAggregate> {
    return this.unitOfWork.execute(async (stores) => {
      const current = await this.loadMutableTask(stores, input.taskId, input.expectedVersion);
      const existing = await this.loadQuestion(stores, input.taskId, input.questionId);
      this.assertCurrentCycle(current, existing);
      const now = timestamp(this.dependencies.clock);
      const question = updateQuestion(existing, this.definition(input.definition), now);
      const task = mutateTaskForQuestion(current, now);
      const event = await eventFor(
        task,
        input.actorType,
        this.definitionFact("question_updated", question),
        this.dependencies,
        now,
      );
      await this.persistTask(stores, task, input.expectedVersion);
      await stores.questions.update(question);
      await stores.events.append([event]);
      return this.aggregate(stores, task);
    });
  }

  async answer(input: AnswerQuestionInput): Promise<TaskAggregate> {
    return this.resolve(input, {
      selectedOptionIds: input.selectedOptionIds,
      answerText: input.answerText,
    });
  }

  async dismiss(input: DismissQuestionInput): Promise<TaskAggregate> {
    validateReason(input.reason);
    return this.resolve(input);
  }

  async reopen(input: ReopenQuestionInput): Promise<TaskAggregate> {
    validateReason(input.reason);
    return this.unitOfWork.execute(async (stores) => {
      const current = await this.loadMutableTask(stores, input.taskId, input.expectedVersion);
      if (current.status === "done") {
        throw new InvalidTransitionError("Questions cannot be reopened for a Done Task.", {
          taskId: current.id,
        });
      }
      const existing = await this.loadQuestion(stores, input.taskId, input.questionId);
      this.assertCurrentCycle(current, existing);
      const now = timestamp(this.dependencies.clock);
      const question = reopenQuestion(existing, now);
      const task = mutateTaskForQuestion(current, now, "blocked", true);
      const facts: TaskEventFact[] = [
        {
          type: "question_reopened",
          questionId: question.id,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
        },
      ];
      if (current.status !== "blocked") {
        facts.push({
          type: "status_changed",
          from: current.status,
          to: "blocked",
          automatic: true,
        });
      }
      const events = await this.eventsFor(task, input.actorType, facts, now);
      await this.persistTask(stores, task, input.expectedVersion);
      await stores.questions.update(question);
      await stores.events.append(events);
      return this.aggregate(stores, task);
    });
  }

  private async resolve(
    input: AnswerQuestionInput | DismissQuestionInput,
    answer?: QuestionAnswer,
  ): Promise<TaskAggregate> {
    return this.unitOfWork.execute(async (stores) => {
      const current = await this.loadMutableTask(stores, input.taskId, input.expectedVersion);
      const existing = await this.loadQuestion(stores, input.taskId, input.questionId);
      this.assertCurrentCycle(current, existing);
      const now = timestamp(this.dependencies.clock);
      const question =
        answer === undefined
          ? dismissQuestion(existing, now)
          : answerQuestion(existing, answer, now);
      const reason = "reason" in input ? input.reason : undefined;
      const isLastOpen =
        (await stores.questions.countOpenByTaskId(input.taskId, current.currentCycleId)) === 1;
      const nextStatus = current.status === "blocked" && isLastOpen ? "curating" : current.status;
      const task = mutateTaskForQuestion(current, now, nextStatus);
      const facts: TaskEventFact[] = [
        answer === undefined
          ? {
              type: "question_dismissed",
              questionId: question.id,
              ...(reason === undefined ? {} : { reason }),
            }
          : { type: "question_answered", questionId: question.id },
      ];
      if (nextStatus !== current.status) {
        facts.push({
          type: "status_changed",
          from: current.status,
          to: nextStatus,
          automatic: true,
        });
      }
      const events = await this.eventsFor(task, input.actorType, facts, now);
      await this.persistTask(stores, task, input.expectedVersion);
      await stores.questions.update(question);
      if (answer !== undefined) {
        await stores.questionAnswers.insert({
          id: this.dependencies.ids.questionAnswerId(),
          questionId: question.id,
          cycleId: question.cycleId,
          revision: await stores.questionAnswers.nextRevision(question.id),
          answerText: question.answerText,
          selectedOptionIds: question.selectedOptionIds,
          createdAt: now,
        });
      }
      await stores.events.append(events);
      return this.aggregate(stores, task);
    });
  }

  private definition(input: QuestionDefinitionInput): QuestionDefinition {
    return {
      text: input.text,
      type: input.type,
      options: input.options.map((option, position) => ({
        id: this.dependencies.ids.optionId(),
        label: option.label,
        position,
      })),
      allowOther: input.allowOther,
    };
  }

  private definitionFact(
    type: "question_created" | "question_updated",
    question: Question,
  ): TaskEventFact {
    return {
      type,
      questionId: question.id,
      questionType: question.type,
      optionCount: question.options.length,
      allowOther: question.allowOther,
    };
  }

  private async loadMutableTask(
    stores: Stores,
    taskId: TaskId,
    expectedVersion: number,
  ): Promise<Task> {
    const task = await this.loadTask(stores, taskId);
    assertExpectedVersion(task, expectedVersion);
    assertTaskActive(task);
    return task;
  }

  private async loadTask(stores: Stores, taskId: TaskId): Promise<Task> {
    const task = await stores.tasks.getById(taskId);
    if (task === null) throw new NotFoundError("Task", taskId);
    return task;
  }

  private async loadQuestion(
    stores: Stores,
    taskId: TaskId,
    questionId: QuestionId,
  ): Promise<Question> {
    const question = await stores.questions.getById(questionId);
    if (question === null || question.taskId !== taskId) {
      throw new NotFoundError("Question", questionId);
    }
    return question;
  }

  private assertCurrentCycle(task: Task, question: Question): void {
    if (question.cycleId !== task.currentCycleId) {
      throw new InvalidTransitionError("Historical Questions are read-only.", {
        questionId: question.id,
        cycleId: question.cycleId,
        currentCycleId: task.currentCycleId,
      });
    }
  }

  private async persistTask(stores: Stores, task: Task, expectedVersion: number): Promise<void> {
    if (!(await stores.tasks.updateIfVersion(task, expectedVersion))) {
      throw new VersionConflictError(expectedVersion);
    }
  }

  private async aggregate(stores: Stores, task: Task): Promise<TaskAggregate> {
    const [project, questions, attachments, specRevisions, currentCycle, currentDelivery] =
      await Promise.all([
        stores.projects.getById(task.projectId),
        stores.questions.listByTaskId(task.id),
        stores.attachments.listByTaskId(task.id),
        stores.specRevisions.listByTaskId(task.id),
        stores.cycles.getById(task.currentCycleId),
        task.currentDeliveryId === null
          ? Promise.resolve(null)
          : stores.deliveries.getById(task.currentDeliveryId),
      ]);
    if (project === null) throw new NotFoundError("Project", task.projectId);
    if (currentCycle === null) throw new NotFoundError("Task", task.id);
    return {
      ...task,
      project,
      questions,
      attachments,
      specRevisions,
      currentCycle,
      currentDelivery,
    };
  }

  private async eventsFor(
    task: Task,
    actorType: ActorType,
    facts: readonly TaskEventFact[],
    createdAt: string,
  ): Promise<TaskEvent[]> {
    return Promise.all(
      facts.map((fact) =>
        eventFor(
          task,
          fact.type === "status_changed" && fact.automatic ? "system" : actorType,
          fact,
          this.dependencies,
          createdAt,
        ),
      ),
    );
  }
}
