import { InvalidTransitionError, type ValidationIssue } from "../errors/domain-errors.ts";
import type { QuestionId, QuestionOptionId, TaskCycleId, TaskId } from "./ids.ts";
import { assertNonBlank, throwIfIssues } from "./validation.ts";

export type QuestionType = "text" | "single_choice" | "multiple_choice";
export type QuestionStatus = "open" | "answered" | "dismissed";

export interface QuestionOption {
  readonly id: QuestionOptionId;
  readonly label: string;
  readonly position: number;
}

export interface Question {
  readonly id: QuestionId;
  readonly taskId: TaskId;
  readonly cycleId: TaskCycleId;
  readonly text: string;
  readonly type: QuestionType;
  readonly options: readonly QuestionOption[];
  readonly allowOther: boolean;
  readonly answerText: string | null;
  readonly selectedOptionIds: readonly QuestionOptionId[];
  readonly status: QuestionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly answeredAt: string | null;
  readonly dismissedAt: string | null;
}

export interface QuestionDefinition {
  readonly text: string;
  readonly type: QuestionType;
  readonly options: readonly QuestionOption[];
  readonly allowOther: boolean;
}

export interface NewQuestion extends QuestionDefinition {
  readonly id: QuestionId;
  readonly taskId: TaskId;
  readonly cycleId?: TaskCycleId;
  readonly now: string;
}

export interface QuestionAnswer {
  readonly selectedOptionIds: readonly QuestionOptionId[];
  readonly answerText: string | null;
}

export function createQuestion(input: NewQuestion): Question {
  validateDefinition(input);
  return {
    id: input.id,
    taskId: input.taskId,
    cycleId: input.cycleId ?? (`cyc_${input.taskId.slice(4)}` as TaskCycleId),
    text: input.text,
    type: input.type,
    options: input.options,
    allowOther: input.allowOther,
    answerText: null,
    selectedOptionIds: [],
    status: "open",
    createdAt: input.now,
    updatedAt: input.now,
    answeredAt: null,
    dismissedAt: null,
  };
}

export function updateQuestion(
  question: Question,
  definition: QuestionDefinition,
  now: string,
): Question {
  if (question.status !== "open" || question.answeredAt !== null) {
    throw new InvalidTransitionError("Question definition is frozen after its first answer.", {
      questionId: question.id,
      status: question.status,
    });
  }
  validateDefinition(definition);
  return { ...question, ...definition, updatedAt: now };
}

export function answerQuestion(question: Question, answer: QuestionAnswer, now: string): Question {
  assertOpen(question);
  validateAnswer(question, answer);
  return {
    ...question,
    answerText: answer.answerText,
    selectedOptionIds: [...answer.selectedOptionIds],
    status: "answered",
    updatedAt: now,
    answeredAt: now,
    dismissedAt: null,
  };
}

export function dismissQuestion(question: Question, now: string): Question {
  assertOpen(question);
  return { ...question, status: "dismissed", updatedAt: now, dismissedAt: now };
}

export function reopenQuestion(question: Question, now: string): Question {
  if (question.status === "open") {
    throw new InvalidTransitionError("Question is already open.", {
      questionId: question.id,
    });
  }
  return { ...question, status: "open", updatedAt: now };
}

function validateDefinition(definition: QuestionDefinition): void {
  const issues: ValidationIssue[] = [];
  assertNonBlank(definition.text, "text", 5_000, issues);
  if (
    !(["text", "single_choice", "multiple_choice"] as readonly unknown[]).includes(definition.type)
  ) {
    issues.push({ path: "type", message: "Question type is invalid." });
  }
  const optionIds = new Set<string>();
  for (const [index, option] of definition.options.entries()) {
    assertNonBlank(option.label, `options[${index}].label`, 500, issues);
    if (optionIds.has(option.id)) {
      issues.push({ path: `options[${index}].id`, message: "Option IDs must be unique." });
    }
    optionIds.add(option.id);
    if (option.position !== index) {
      issues.push({
        path: `options[${index}].position`,
        message: "Option positions must be consecutive from zero.",
      });
    }
  }
  if (definition.type === "text" && definition.options.length !== 0) {
    issues.push({ path: "options", message: "Text Questions cannot have options." });
  }
  if (
    (definition.type === "single_choice" || definition.type === "multiple_choice") &&
    (definition.options.length < 2 || definition.options.length > 20)
  ) {
    issues.push({ path: "options", message: "Choice Questions require between 2 and 20 options." });
  }
  throwIfIssues(issues);
}

function validateAnswer(question: Question, answer: QuestionAnswer): void {
  const issues: ValidationIssue[] = [];
  const selected = answer.selectedOptionIds;
  const unique = new Set(selected);
  if (unique.size !== selected.length) {
    issues.push({ path: "selectedOptionIds", message: "Option IDs must be unique." });
  }
  const validIds = new Set(question.options.map((option) => option.id));
  for (const [index, id] of selected.entries()) {
    if (!validIds.has(id)) {
      issues.push({
        path: `selectedOptionIds[${index}]`,
        message: "Selected option does not belong to this Question.",
      });
    }
  }
  if (answer.answerText !== null && Array.from(answer.answerText).length > 10_000) {
    issues.push({ path: "answerText", message: "Must contain at most 10000 characters." });
  }
  const hasText = answer.answerText !== null && answer.answerText.trim().length > 0;
  if (question.type === "text") {
    if (selected.length !== 0) {
      issues.push({ path: "selectedOptionIds", message: "Text Questions cannot select options." });
    }
    if (!hasText) issues.push({ path: "answerText", message: "A text answer is required." });
  } else if (question.type === "single_choice") {
    if (selected.length > 1) {
      issues.push({ path: "selectedOptionIds", message: "Select exactly one option." });
    }
    if (selected.length === 0 && !(question.allowOther && hasText)) {
      issues.push({
        path: "selectedOptionIds",
        message: "Select one option or provide an Other answer when allowed.",
      });
    }
  } else if (selected.length === 0 && !(question.allowOther && hasText)) {
    issues.push({
      path: "selectedOptionIds",
      message: "Select at least one option or provide an Other answer when allowed.",
    });
  }
  throwIfIssues(issues);
}

function assertOpen(question: Question): void {
  if (question.status !== "open") {
    throw new InvalidTransitionError("Question is not open.", {
      questionId: question.id,
      status: question.status,
    });
  }
}
