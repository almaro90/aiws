import { z } from "zod";

const characterLength = (value: string) => Array.from(value).length;
const nonBlank = (maximum: number) =>
  z.string().refine((value) => {
    const length = characterLength(value.trim());
    return length >= 1 && length <= maximum;
  }, `Must contain between 1 and ${maximum} characters after trimming.`);

export const questionIdSchema = z
  .string()
  .regex(/^qst_[0-9A-HJKMNP-TV-Z]{26}$/, "Invalid Question ID.");

export const optionIdSchema = z
  .string()
  .regex(/^opt_[0-9A-HJKMNP-TV-Z]{26}$/, "Invalid Option ID.");

export const questionDefinitionSchema = z
  .strictObject({
    text: nonBlank(5_000),
    type: z.enum(["text", "single_choice", "multiple_choice"]),
    options: z.array(z.strictObject({ label: nonBlank(500) })).max(20),
    allowOther: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.type === "text" && value.options.length !== 0) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "Text Questions cannot have options.",
      });
    }
    if (value.type !== "text" && (value.options.length < 2 || value.options.length > 20)) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "Choice Questions require between 2 and 20 options.",
      });
    }
  });

export const answerQuestionSchema = z.strictObject({
  selectedOptionIds: z
    .array(optionIdSchema)
    .refine((ids) => new Set(ids).size === ids.length, "Option IDs must be unique."),
  answerText: z
    .string()
    .refine((value) => characterLength(value) <= 10_000, "Must contain at most 10000 characters.")
    .nullable(),
});
