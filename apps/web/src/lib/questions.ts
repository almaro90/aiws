import { z } from "zod";
import type { Question, QuestionType } from "./types.ts";

export interface QuestionDraft {
  readonly type: QuestionType;
  readonly text: string;
  readonly options: readonly string[];
  readonly allowOther: boolean;
}

export const questionDraftSchema = z
  .object({
    text: z.string().trim().min(1).max(5000),
    type: z.enum(["text", "single_choice", "multiple_choice"]),
    options: z.array(z.string().trim().min(1).max(500)).max(20),
    allowOther: z.boolean(),
  })
  .superRefine((value, context) => {
    const required = value.type === "text" ? 0 : 2;
    if (value.options.length < required || (value.type === "text" && value.options.length !== 0)) {
      context.addIssue({ code: "custom", path: ["options"], message: "Opciones inválidas." });
    }
  });

export function questionPayload(draft: QuestionDraft) {
  return questionDraftSchema.parse({
    ...draft,
    options: draft.type === "text" ? [] : draft.options,
  });
}

export function answerPayload(
  question: Question,
  selectedOptionIds: readonly string[],
  answerText: string,
) {
  const text = answerText.trim();
  if (question.type === "text" && text.length === 0)
    throw new Error("La respuesta es obligatoria.");
  if (question.type === "single_choice" && selectedOptionIds.length > 1) {
    throw new Error("Selecciona una sola opción.");
  }
  if (
    question.type !== "text" &&
    selectedOptionIds.length === 0 &&
    !(question.allowOther && text.length > 0)
  ) {
    throw new Error("Selecciona una opción o utiliza Otro.");
  }
  return { selectedOptionIds: [...selectedOptionIds], answerText: text.length === 0 ? null : text };
}
