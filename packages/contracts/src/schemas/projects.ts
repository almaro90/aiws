import { ACCOUNT_SCOPES, GIT_PROVIDERS, isValidGitBranchName, READY_POLICIES } from "@aiws/core";
import { z } from "zod";

const nonBlank = (maximum: number) =>
  z.string().refine((value) => {
    const length = Array.from(value.trim()).length;
    return length >= 1 && length <= maximum;
  }, `Must contain between 1 and ${maximum} characters after trimming.`);
const branchName = nonBlank(255).refine(isValidGitBranchName, "Must be a valid Git branch name.");

export const loginSchema = z.strictObject({
  username: z.string().min(1).max(120),
  password: z.string().min(1).max(1024),
});

export const projectIdSchema = z
  .string()
  .regex(/^prj_[0-9A-HJKMNP-TV-Z]{26}$/, "Invalid Project ID.");

const projectFields = {
  name: nonBlank(120),
  description: z.string().max(10_000),
  repositoryPath: z.string().min(1),
  gitProvider: z.enum(GIT_PROVIDERS),
  accountScope: z.enum(ACCOUNT_SCOPES),
};

export const createProjectSchema = z.strictObject({
  ...projectFields,
  description: projectFields.description.default(""),
});

export const updateProjectSchema = z
  .strictObject({
    name: projectFields.name.optional(),
    description: projectFields.description.optional(),
    repositoryPath: projectFields.repositoryPath.optional(),
    gitProvider: projectFields.gitProvider.optional(),
    accountScope: projectFields.accountScope.optional(),
    defaultBranch: branchName.optional(),
    automationEnabled: z.boolean().optional(),
    curationAgentProfileId: z
      .string()
      .regex(/^agp_[0-9A-HJKMNP-TV-Z]{26}$/u)
      .nullable()
      .optional(),
    implementationAgentProfileId: z
      .string()
      .regex(/^agp_[0-9A-HJKMNP-TV-Z]{26}$/u)
      .nullable()
      .optional(),
    scheduleCron: z
      .string()
      .regex(/^\S+(?:\s+\S+){4}$/u)
      .nullable()
      .optional(),
    scheduleTimezone: z.string().min(1).max(255).optional(),
    maxConcurrency: z.number().int().min(1).max(16).optional(),
    readyPolicy: z.enum(READY_POLICIES).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export const listProjectsSchema = z.strictObject({
  archived: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  gitProvider: projectFields.gitProvider.optional(),
  accountScope: projectFields.accountScope.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
});

export const projectReadinessRequestSchema = z.strictObject({
  depth: z.enum(["standard", "deep"]).default("standard"),
});

const verificationCommandSchema = z.strictObject({
  name: nonBlank(120),
  executable: nonBlank(1_024).refine(
    (value) => !value.includes("\0") && !/[\r\n]/u.test(value),
    "Must not contain NUL or line breaks.",
  ),
  args: z
    .array(
      z
        .string()
        .max(4_096)
        .refine((value) => !value.includes("\0"), "Must not contain NUL."),
    )
    .max(100),
  required: z.boolean(),
  timeoutSeconds: z.number().int().min(1).max(3_600),
});

export const replaceVerificationContractSchema = z.strictObject({
  expectedRevision: z.number().int().min(1).nullable(),
  commands: z.array(verificationCommandSchema).min(1).max(20),
});

export const disableVerificationContractSchema = z.strictObject({
  expectedRevision: z.number().int().min(1),
});

export function validationDetails(error: z.ZodError): {
  fields: { path: string; message: string }[];
} {
  return {
    fields: error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    })),
  };
}
