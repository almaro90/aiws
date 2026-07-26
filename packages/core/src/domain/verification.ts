import type { ProjectId } from "./ids.ts";
import { assertNonBlank, characterLength, throwIfIssues } from "./validation.ts";
import type { ValidationIssue } from "../errors/domain-errors.ts";

export interface VerificationCommand {
  readonly name: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly required: boolean;
  readonly timeoutSeconds: number;
}

export interface VerificationContractRevision {
  readonly projectId: ProjectId;
  readonly revision: number;
  readonly enabled: boolean;
  readonly commands: readonly VerificationCommand[];
  readonly createdAt: string;
}

export interface VerificationContractState {
  readonly projectId: ProjectId;
  readonly latestRevision: number | null;
  readonly active: VerificationContractRevision | null;
}

export function createVerificationContractRevision(input: {
  readonly projectId: ProjectId;
  readonly revision: number;
  readonly enabled: boolean;
  readonly commands: readonly VerificationCommand[];
  readonly now: string;
}): VerificationContractRevision {
  const issues: ValidationIssue[] = [];
  if (!Number.isInteger(input.revision) || input.revision < 1) {
    issues.push({ path: "revision", message: "Revision must be a positive integer." });
  }
  if (input.enabled && (input.commands.length < 1 || input.commands.length > 20)) {
    issues.push({
      path: "commands",
      message: "An active contract requires between 1 and 20 commands.",
    });
  }
  if (!input.enabled && input.commands.length !== 0) {
    issues.push({ path: "commands", message: "A disabled contract cannot contain commands." });
  }
  const names = new Set<string>();
  const commands = input.commands.map((command, index) => {
    const path = `commands.${index}`;
    assertNonBlank(command.name, `${path}.name`, 120, issues);
    assertNonBlank(command.executable, `${path}.executable`, 1_024, issues);
    if (command.executable.includes("\0") || /[\r\n]/u.test(command.executable)) {
      issues.push({
        path: `${path}.executable`,
        message: "Executable cannot contain NUL or line breaks.",
      });
    }
    const normalizedName = command.name.trim();
    if (names.has(normalizedName)) {
      issues.push({ path: `${path}.name`, message: "Command names must be unique." });
    }
    names.add(normalizedName);
    if (command.args.length > 100) {
      issues.push({ path: `${path}.args`, message: "A command accepts at most 100 arguments." });
    }
    for (const [argumentIndex, argument] of command.args.entries()) {
      if (characterLength(argument) > 4_096 || argument.includes("\0")) {
        issues.push({
          path: `${path}.args.${argumentIndex}`,
          message: "Arguments must contain at most 4096 characters and no NUL.",
        });
      }
    }
    if (
      !Number.isInteger(command.timeoutSeconds) ||
      command.timeoutSeconds < 1 ||
      command.timeoutSeconds > 3_600
    ) {
      issues.push({
        path: `${path}.timeoutSeconds`,
        message: "Timeout must be an integer between 1 and 3600 seconds.",
      });
    }
    return { ...command, name: normalizedName };
  });
  throwIfIssues(issues);
  return {
    projectId: input.projectId,
    revision: input.revision,
    enabled: input.enabled,
    commands,
    createdAt: input.now,
  };
}

export function verificationContractState(
  projectId: ProjectId,
  latest: VerificationContractRevision | null,
): VerificationContractState {
  return {
    projectId,
    latestRevision: latest?.revision ?? null,
    active: latest?.enabled ? latest : null,
  };
}
