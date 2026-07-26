import type { RunId } from "./ids.ts";
import { throwIfIssues } from "./validation.ts";
import type { ValidationIssue } from "../errors/domain-errors.ts";

export const VERIFICATION_RESULT_STATUSES = [
  "passed",
  "failed",
  "timed_out",
  "spawn_error",
  "cancelled",
] as const;
export type VerificationResultStatus = (typeof VERIFICATION_RESULT_STATUSES)[number];

export interface VerificationResult {
  readonly runId: RunId;
  readonly position: number;
  readonly name: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly required: boolean;
  readonly status: VerificationResultStatus;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly exitCode: number | null;
  readonly stdoutExcerpt: string;
  readonly stderrExcerpt: string;
  readonly imageDigest: string;
  readonly toolchainIdentity: string;
}

export interface RunProvenance {
  readonly runId: RunId;
  readonly schemaVersion: 1;
  readonly aiwsVersion: string;
  readonly codexCliVersion: string | null;
  readonly model: string | null;
  readonly reasoningEffort: string | null;
  readonly agentImage: string;
  readonly agentImageDigest: string;
  readonly toolchainIdentity: readonly string[];
  readonly resourceLimits: Readonly<Record<string, string | number>>;
  readonly networkProfile: string;
  readonly baseSha: string | null;
  readonly headSha: string | null;
  readonly branchName: string | null;
  readonly promptBuilderVersion: string;
  readonly promptHash: string;
  readonly specRevision: number | null;
  readonly attachments: readonly { readonly id: string; readonly sha256: string }[];
  readonly verificationContractRevision: number | null;
  readonly publicationOutcome:
    | "not_applicable"
    | "not_attempted"
    | "published"
    | "failed"
    | "waived";
  readonly createdAt: string;
}

export function validateVerificationResults(
  input: readonly VerificationResult[],
): readonly VerificationResult[] {
  const issues: ValidationIssue[] = [];
  if (input.length > 20)
    issues.push({ path: "results", message: "At most 20 results are allowed." });
  for (const [index, result] of input.entries()) {
    if (result.position !== index)
      issues.push({ path: `results.${index}.position`, message: "Positions must be contiguous." });
    if (!Number.isSafeInteger(result.durationMs) || result.durationMs < 0)
      issues.push({ path: `results.${index}.durationMs`, message: "Must be non-negative." });
    if (result.stdoutExcerpt.length > 16_384 || result.stderrExcerpt.length > 16_384)
      issues.push({
        path: `results.${index}`,
        message: "Output excerpts exceed 16384 characters.",
      });
    if (!VERIFICATION_RESULT_STATUSES.includes(result.status))
      issues.push({ path: `results.${index}.status`, message: "Unsupported result status." });
  }
  throwIfIssues(issues);
  return input;
}
