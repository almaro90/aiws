import { ValidationError, type ValidationIssue } from "../errors/domain-errors.ts";

export function characterLength(value: string): number {
  return Array.from(value).length;
}

export function assertNonBlank(
  value: string,
  path: string,
  maximum: number,
  issues: ValidationIssue[],
): void {
  const length = characterLength(value);
  if (value.trim().length === 0 || length > maximum) {
    issues.push({ path, message: `Must contain between 1 and ${maximum} characters.` });
  }
}

export function assertMaximum(
  value: string,
  path: string,
  maximum: number,
  issues: ValidationIssue[],
): void {
  if (characterLength(value) > maximum) {
    issues.push({ path, message: `Must contain at most ${maximum} characters.` });
  }
}

export function throwIfIssues(issues: ValidationIssue[]): void {
  if (issues.length > 0) throw new ValidationError(issues);
}
