import { describe, expect, test } from "bun:test";
import {
  answerQuestion,
  createQuestion,
  dismissQuestion,
  InvalidTransitionError,
  type Question,
  type QuestionId,
  type QuestionOption,
  type QuestionOptionId,
  reopenQuestion,
  type TaskId,
  updateQuestion,
  ValidationError,
} from "../src/index.ts";

const taskId = "tsk_01K0ABCDEFGHIJKLMNOPQRSTUV" as TaskId;
const questionId = "qst_01K0ABCDEFGHIJKLMNOPQRSTUV" as QuestionId;
const now = "2026-07-21T10:00:00.000Z";
const later = "2026-07-21T11:00:00.000Z";

function option(index: number, changes: Partial<QuestionOption> = {}): QuestionOption {
  return {
    id: `opt_${String(index).padStart(26, "0")}` as QuestionOptionId,
    label: `Option ${index}`,
    position: index,
    ...changes,
  };
}

function question(changes: Partial<Question> = {}): Question {
  return {
    ...createQuestion({
      id: questionId,
      taskId,
      text: "What is required?",
      type: "text",
      options: [],
      allowOther: false,
      now,
    }),
    ...changes,
  };
}

describe("Question definitions", () => {
  test.each([
    ["text", []],
    ["single_choice", [option(0), option(1)]],
    ["multiple_choice", [option(0), option(1)]],
  ] as const)("creates a valid %s Question", (type, options) => {
    expect(
      createQuestion({
        id: questionId,
        taskId,
        text: "Question?",
        type,
        options,
        allowOther: true,
        now,
      }),
    ).toMatchObject({ type, options, status: "open", answerText: null });
  });

  test.each([
    ["blank text", { text: " " }],
    ["text options", { type: "text", options: [option(0), option(1)] }],
    ["too few choices", { type: "single_choice", options: [option(0)] }],
    [
      "too many choices",
      { type: "multiple_choice", options: Array.from({ length: 21 }, (_, index) => option(index)) },
    ],
    [
      "duplicate IDs",
      { type: "single_choice", options: [option(0), option(1, { id: option(0).id })] },
    ],
    [
      "non-consecutive positions",
      { type: "single_choice", options: [option(0), option(1, { position: 3 })] },
    ],
    ["blank label", { type: "single_choice", options: [option(0), option(1, { label: " " })] }],
  ])("rejects %s", (_label, changes) => {
    expect(() => {
      const input = {
        id: questionId,
        taskId,
        text: "Question?",
        type: "text",
        options: [],
        allowOther: false,
        now,
        ...changes,
      } as Parameters<typeof createQuestion>[0];
      createQuestion(input);
    }).toThrow(ValidationError);
  });

  test("updates only an open Question that has never been answered", () => {
    const updated = updateQuestion(
      question(),
      {
        text: "Choose one",
        type: "single_choice",
        options: [option(0), option(1)],
        allowOther: true,
      },
      later,
    );
    expect(updated).toMatchObject({ type: "single_choice", updatedAt: later });
    expect(() => updateQuestion({ ...question(), answeredAt: now }, updated, later)).toThrow(
      InvalidTransitionError,
    );
  });
});

describe("Question answers", () => {
  test("text requires non-blank text and no options", () => {
    expect(
      answerQuestion(question(), { selectedOptionIds: [], answerText: "Details" }, later),
    ).toMatchObject({
      status: "answered",
      answerText: "Details",
      answeredAt: later,
    });
    expect(() =>
      answerQuestion(question(), { selectedOptionIds: [], answerText: " " }, later),
    ).toThrow(ValidationError);
    expect(() =>
      answerQuestion(
        question(),
        { selectedOptionIds: [option(0).id], answerText: "Details" },
        later,
      ),
    ).toThrow(ValidationError);
  });

  test("single choice requires exactly one owned option or allowed Other text", () => {
    const single = question({ type: "single_choice", options: [option(0), option(1)] });
    expect(
      answerQuestion(single, { selectedOptionIds: [option(0).id], answerText: "Comment" }, later),
    ).toMatchObject({ status: "answered", selectedOptionIds: [option(0).id] });
    expect(() =>
      answerQuestion(
        single,
        { selectedOptionIds: [option(0).id, option(1).id], answerText: null },
        later,
      ),
    ).toThrow(ValidationError);
    expect(() =>
      answerQuestion(single, { selectedOptionIds: [], answerText: "Other" }, later),
    ).toThrow(ValidationError);
    expect(
      answerQuestion(
        { ...single, allowOther: true },
        { selectedOptionIds: [], answerText: "Other" },
        later,
      ),
    ).toMatchObject({ status: "answered", answerText: "Other" });
  });

  test("multiple choice validates cardinality, ownership and duplicate IDs", () => {
    const multiple = question({ type: "multiple_choice", options: [option(0), option(1)] });
    expect(
      answerQuestion(
        multiple,
        { selectedOptionIds: [option(0).id, option(1).id], answerText: null },
        later,
      ),
    ).toMatchObject({ status: "answered" });
    for (const selectedOptionIds of [
      [],
      [option(0).id, option(0).id],
      [option(2).id],
    ] as QuestionOptionId[][]) {
      expect(() =>
        answerQuestion(multiple, { selectedOptionIds, answerText: null }, later),
      ).toThrow(ValidationError);
    }
  });

  test("dismiss and reopen preserve prior answer history and enforce status", () => {
    const answered = answerQuestion(
      question(),
      { selectedOptionIds: [], answerText: "First" },
      later,
    );
    const reopened = reopenQuestion(answered, "2026-07-21T12:00:00.000Z");
    expect(reopened).toMatchObject({ status: "open", answerText: "First", answeredAt: later });
    const dismissed = dismissQuestion(reopened, "2026-07-21T13:00:00.000Z");
    expect(dismissed).toMatchObject({
      status: "dismissed",
      answerText: "First",
      answeredAt: later,
      dismissedAt: "2026-07-21T13:00:00.000Z",
    });
    expect(() => dismissQuestion(dismissed, later)).toThrow(InvalidTransitionError);
    expect(() => reopenQuestion(question(), later)).toThrow(InvalidTransitionError);
  });
});
