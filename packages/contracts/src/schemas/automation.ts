import { z } from "zod";

const prefixedId = (prefix: string, label: string) =>
  z.string().regex(new RegExp(`^${prefix}[0-9A-HJKMNP-TV-Z]{26}$`, "u"), `Invalid ${label} ID.`);

export const connectionIdSchema = prefixedId("con_", "Connection");
export const azureAuthorizationIdSchema = prefixedId("azr_", "Azure authorization");
export const agentProfileIdSchema = prefixedId("agp_", "Agent Profile");
export const runIdSchema = prefixedId("run_", "Run");
export const deliveryIdSchema = prefixedId("del_", "Delivery");
export const registerConnectionSchema = z.strictObject({
  host: z
    .string()
    .url()
    .refine((value) => value.startsWith("https://"), "Must use HTTPS."),
  externalAccountId: z.string().min(1).max(255),
  displayName: z.string().min(1).max(255),
  installationId: z.string().min(1).max(255),
});
export const createAgentProfileSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  runtime: z.literal("codex").default("codex"),
  authMode: z.enum(["api_key", "chatgpt_session"]),
  credentialReference: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]*$/u)
    .max(255),
  model: z.string().trim().min(1).max(120),
  reasoningEffort: z.string().trim().min(1).max(120),
});
export const modelCatalogRequestSchema = z.strictObject({
  authMode: z.enum(["api_key", "chatgpt_session"]),
  credentialReference: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]*$/u)
    .max(255),
});
export const setAgentProfileEnabledSchema = z.strictObject({ enabled: z.boolean() });
export const advanceRunSchema = z.strictObject({
  status: z.enum(["preparing", "running", "verifying", "publishing"]),
  baseSha: z
    .string()
    .regex(/^[0-9a-f]{40,64}$/u)
    .optional(),
  headSha: z
    .string()
    .regex(/^[0-9a-f]{40,64}$/u)
    .optional(),
  logsStorageKey: z.string().max(512).optional(),
  summary: z.string().max(10_000).optional(),
});
export const completeRunSchema = z.strictObject({
  prUrl: z.string().url().max(2048),
  headSha: z.string().regex(/^[0-9a-f]{40,64}$/u),
  summary: z.string().max(10_000),
});
const curatorQuestionSchema = z.strictObject({
  text: z.string().trim().min(1).max(5_000),
  type: z.enum(["text", "single_choice", "multiple_choice"]),
  options: z.array(z.strictObject({ label: z.string().trim().min(1).max(500) })).max(20),
  allowOther: z.boolean(),
});
const curatorTitle = z.string().trim().min(1).max(200).optional();
const curatorSpec = z
  .string()
  .refine(
    (value) => new TextEncoder().encode(value).byteLength <= 1_048_576,
    "Must contain at most 1048576 UTF-8 bytes.",
  );
export const completeCurationRunSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("ready"),
    title: curatorTitle,
    curatorSpec: curatorSpec.refine((value) => value.trim().length > 0, "Must not be blank."),
    summary: z.string().max(10_000),
  }),
  z.strictObject({
    outcome: z.literal("blocked"),
    title: curatorTitle,
    curatorSpec: curatorSpec.optional(),
    questions: z.array(curatorQuestionSchema).min(1).max(10),
    summary: z.string().max(10_000),
  }),
]);
export const failRunSchema = z.strictObject({
  errorCode: z.string().trim().min(1).max(100),
  errorMessage: z.string().trim().min(1).max(5_000),
  summary: z.string().max(10_000).optional(),
});
export const cancelRunSchema = z.strictObject({ reason: z.string().trim().min(1).max(2_000) });
export const retryRunSchema = z.strictObject({
  mode: z.enum(["auto", "full", "publish_only"]).default("auto"),
});
const verificationResultSchema = z.strictObject({
  position: z.number().int().min(0).max(19),
  name: z.string().min(1).max(120),
  executable: z.string().min(1).max(1_024),
  args: z.array(z.string().max(4_096)).max(100),
  required: z.boolean(),
  status: z.enum(["passed", "failed", "timed_out", "spawn_error", "cancelled"]),
  startedAt: z.string().datetime({ offset: true, precision: 3 }),
  finishedAt: z.string().datetime({ offset: true, precision: 3 }),
  durationMs: z.number().int().nonnegative(),
  exitCode: z.number().int().nullable(),
  stdoutExcerpt: z.string().max(16_384),
  stderrExcerpt: z.string().max(16_384),
  imageDigest: z.string().min(1).max(512),
  toolchainIdentity: z.string().min(1).max(1_024),
});
export const recordVerificationResultsSchema = z.strictObject({
  results: z.array(verificationResultSchema).max(20),
});
export const waiveVerificationSchema = z.strictObject({
  reason: z.string().trim().min(1).max(2_000),
});
export const recordRunProvenanceSchema = z.strictObject({
  aiwsVersion: z.string().min(1).max(120),
  codexCliVersion: z.string().max(120).nullable(),
  model: z.string().max(120).nullable(),
  reasoningEffort: z.string().max(120).nullable(),
  agentImage: z.string().min(1).max(512),
  agentImageDigest: z.string().min(1).max(512),
  toolchainIdentity: z.array(z.string().max(1_024)).max(100),
  resourceLimits: z.record(z.string(), z.union([z.string(), z.number()])),
  networkProfile: z.string().max(255),
  baseSha: z
    .string()
    .regex(/^[0-9a-f]{40,64}$/u)
    .nullable(),
  headSha: z
    .string()
    .regex(/^[0-9a-f]{40,64}$/u)
    .nullable(),
  branchName: z.string().max(255).nullable(),
  promptBuilderVersion: z.string().min(1).max(120),
  promptHash: z.string().regex(/^[0-9a-f]{64}$/u),
  specRevision: z.number().int().positive().nullable(),
  attachments: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(64),
        sha256: z.string().regex(/^[0-9a-f]{64}$/u),
      }),
    )
    .max(100),
  verificationContractRevision: z.number().int().positive().nullable(),
  publicationOutcome: z.enum(["not_applicable", "not_attempted", "published", "failed", "waived"]),
});
export const reconcileRunsSchema = z.strictObject({
  before: z.string().datetime({ offset: true, precision: 3 }),
});
export const importRepositorySchema = z.strictObject({
  repositoryId: z.string().trim().min(1).max(255),
  accountScope: z.enum(["personal", "work"]),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(10_000).default(""),
});
export const completeAzureAuthorizationSchema = z.strictObject({
  organizationId: z.string().trim().min(1).max(255),
});
export const createPullRequestSchema = z.strictObject({
  title: z.string().trim().min(1).max(256),
  body: z.string().max(65_536),
  head: z.string().trim().min(1).max(255),
  base: z.string().trim().min(1).max(255),
  draft: z.boolean().default(true),
});
