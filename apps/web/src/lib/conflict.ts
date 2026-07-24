import { ApiError } from "./api.ts";

export interface ConflictState<T> {
  readonly draft: T;
  readonly readVersion: number;
  readonly currentVersion: number | null;
}

export function preserveConflict<T>(
  error: unknown,
  draft: T,
  readVersion: number,
): ConflictState<T> | null {
  if (!(error instanceof ApiError) || error.code !== "version_conflict") return null;
  const current = error.details.currentVersion;
  return {
    draft,
    readVersion,
    currentVersion: typeof current === "number" ? current : null,
  };
}
