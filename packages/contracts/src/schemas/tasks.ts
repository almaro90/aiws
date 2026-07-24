import { ACCOUNT_SCOPES, GIT_PROVIDERS, isValidGitBranchName, TASK_STATUSES } from "@aiws/core";
import { z } from "zod";

const characterLength = (value: string) => Array.from(value).length;
const nonBlank = (maximum: number) =>
  z.string().refine((value) => {
    const length = characterLength(value.trim());
    return length >= 1 && length <= maximum;
  }, `Must contain between 1 and ${maximum} characters after trimming.`);
const reason = z
  .string()
  .refine((value) => characterLength(value) <= 2_000, "Must contain at most 2000 characters.")
  .nullable()
  .optional();
const branchName = nonBlank(255).refine(isValidGitBranchName, "Must be a valid Git branch name.");

export const taskIdSchema = z.string().regex(/^tsk_[0-9A-HJKMNP-TV-Z]{26}$/, "Invalid Task ID.");

export const createTaskSchema = z.strictObject({
  projectId: z.string().regex(/^prj_[0-9A-HJKMNP-TV-Z]{26}$/, "Invalid Project ID."),
  title: nonBlank(200).nullable().optional(),
  userRequest: nonBlank(100_000),
  baseBranch: branchName.optional(),
});

export const updateTaskSchema = z
  .strictObject({
    title: nonBlank(200).optional(),
    userRequest: nonBlank(100_000).optional(),
    curatorSpec: z
      .string()
      .refine(
        (value) => new TextEncoder().encode(value).byteLength <= 1_048_576,
        "Must contain at most 1048576 UTF-8 bytes.",
      )
      .optional(),
    prUrl: z
      .string()
      .max(2_048)
      .url()
      .refine((value) => {
        const protocol = new URL(value).protocol;
        return protocol === "http:" || protocol === "https:";
      }, "Must be an absolute HTTP or HTTPS URL.")
      .nullable()
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export const transitionTaskSchema = z.strictObject({
  from: z.enum(TASK_STATUSES),
  to: z.enum(TASK_STATUSES),
  reason,
});

export const reasonSchema = z.strictObject({ reason });

export const listTasksSchema = z.strictObject({
  projectId: z
    .string()
    .regex(/^prj_[0-9A-HJKMNP-TV-Z]{26}$/)
    .optional(),
  status: z.array(z.enum(TASK_STATUSES)).optional(),
  accountScope: z.enum(ACCOUNT_SCOPES).optional(),
  gitProvider: z.enum(GIT_PROVIDERS).optional(),
  archived: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  sort: z.enum(["updatedAt", "createdAt"]).default("updatedAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
});

export const listActivitySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
});
